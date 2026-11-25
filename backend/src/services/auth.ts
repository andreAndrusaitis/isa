/**
 * Serviço de Autenticação
 * 
 * Gerencia a lógica de negócio relacionada à segurança: login, geração de tokens JWT,
 * renovação de tokens (refresh) e logout.
 */

import { revokeUserSockets } from '../config/socket'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from './audit'
import { getEffectiveScope } from './scope'
import { presentAttachment } from './uploads'
import { getEffectiveModules } from './moduleAccess'
import { capabilitiesOf } from '../access/can'
import { homeFor } from '../access/session'

// Refresh tokens nunca são guardados em texto puro no banco. Persistimos apenas
// o hash SHA-256 — assim um vazamento da tabela não entrega sessões válidas.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const REMEMBER_ME_DURATION = '30d'

// Janela em que um refresh token recém-rotacionado ainda é aceito. Várias abas
// (ou o despertar do notebook) disparam refreshes simultâneos com o MESMO cookie;
// sem essa tolerância o segundo seria tratado como roubo e derrubaria todas as sessões.
const ROTATION_GRACE_MS = 60_000

// Hash descartável: e-mail desconhecido paga o mesmo bcrypt de uma conta local,
// senão o tempo de resposta revela quem tem conta.
let decoyHash: Promise<string> | undefined
const decoyPasswordHash = () => (decoyHash ??= bcrypt.hash(randomUUID(), 10))

type TokenUser = { id: string; role: string; org_id: string | null; permissions?: string[] }

/**
 * Gera access+refresh token para um usuário já autenticado por qualquer meio
 * (senha local ou SSO) e persiste o refresh token. Compartilhado entre o
 * login local e o SSO.
 */
export async function issueTokens(user: TokenUser, rememberMe = false) {
  const payload = { sub: user.id, role: user.role, orgId: user.org_id, permissions: user.permissions || [] }

  // iat_ms: revogação de sessão em milissegundos (ver issuedBeforeInvalidation).
  const accessToken = jwt.sign({ ...payload, iat_ms: Date.now() }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions)

  const refreshExpiry = rememberMe ? REMEMBER_ME_DURATION : env.JWT_REFRESH_EXPIRES_IN
  // rm: a rotação preserva a duração de "Lembrar de mim" (SSO sempre usa).
  // jwtid: dois refreshes no mesmo segundo gerariam JWTs idênticos (hash único colide).
  const refreshToken = jwt.sign({ ...payload, rm: rememberMe }, env.JWT_REFRESH_SECRET, {
    expiresIn: refreshExpiry,
    jwtid: randomUUID(),
  } as jwt.SignOptions)

  const expiresAt = new Date(Date.now() + parseDurationMs(refreshExpiry))
  await prisma.refreshToken.create({
    data: { token: hashToken(refreshToken), user_id: user.id, expires_at: expiresAt },
  })

  return { accessToken, refreshToken }
}

// Converte strings de duração JWT ('15m', '7d', '1h') em milissegundos.
export function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000 // fallback: 7 dias
  const value = parseInt(match[1], 10)
  const unit: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return value * (unit[match[2]] ?? 86_400_000)
}

/**
 * Esquema de validação para o corpo do login.
 * Garante que o e-mail seja válido e a senha não esteja vazia.
 */
export const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

/**
 * Realiza a autenticação do usuário.
 * 
 * @param email - E-mail do usuário
 * @param password - Senha em texto puro
 * @returns Tokens JWT e dados públicos do usuário
 * @throws AppError se as credenciais forem inválidas
 */
export async function loginService(email: string, password: string, rememberMe = false) {
  // 1. Busca o usuário no banco de dados.
  // Filtramos por deletado_at nulo e usuário ativo.
  const user = await prisma.user.findFirst({
    // Usuário de serviço (chave da API de Projetos) não tem login: conta como inexistente.
    where: { email: { equals: email, mode: 'insensitive' as const }, deleted_at: null, active: true, is_service_account: false },
  })

  // Se o usuário não existir, retornamos um erro genérico por segurança (evita enumeração).
  if (!user) {
    await bcrypt.compare(password, await decoyPasswordHash())
    await createAuditLog({
      action: 'LOGIN_FAILED',
      resource: 'AUTH',
      details: { email, reason: 'USER_NOT_FOUND' }
    })
    throw new AppError(401, 'Credenciais inválidas', 'INVALID_CREDENTIALS')
  }

  // 1a. Contas SSO (Microsoft) não têm senha local — bloqueia antes do bcrypt,
  // que quebraria com user.password=null.
  if (user.auth_provider === 'microsoft') {
    await bcrypt.compare(password, await decoyPasswordHash())
    await createAuditLog({
      userId: user.id,
      action: 'LOGIN_FAILED',
      resource: 'AUTH',
      details: { email, reason: 'SSO_ONLY_ACCOUNT' }
    })
    throw new AppError(401, 'Credenciais inválidas', 'INVALID_CREDENTIALS')
  }

  // 2. Compara a senha enviada com o hash salvo no banco usando Bcrypt.
  const valid = await bcrypt.compare(password, user.password!)
  if (!valid) {
    await createAuditLog({
      userId: user.id,
      action: 'LOGIN_FAILED',
      resource: 'AUTH',
      details: { email, reason: 'WRONG_PASSWORD' }
    })
    throw new AppError(401, 'Credenciais inválidas', 'INVALID_CREDENTIALS')
  }

  // 3-6. Gera e persiste access+refresh token (extraído em issueTokens para reuso no SSO).
  const { accessToken, refreshToken } = await issueTokens(user, rememberMe)

  // 7. Log da auditoria de login
  await createAuditLog({
    userId: user.id,
    action: 'LOGIN',
    resource: 'AUTH',
    details: { email: user.email },
  })

  // 8. Retorna os tokens e o perfil do usuário (exceto a senha).
  return { accessToken, refreshToken, user: await buildSessionUser(user) }
}

/**
 * Token rotacionado que reaparece indica roubo: derruba refresh e access tokens da
 * pessoa. Assinatura inválida ou token vencido de verdade só seguem para a recusa.
 */
async function revokeSessionsOnReuse(token: string) {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as { sub?: string }
    if (!payload.sub) return
    await prisma.refreshToken.deleteMany({ where: { user_id: payload.sub } })
    await prisma.user.updateMany({ where: { id: payload.sub }, data: { session_invalidated_at: new Date() } })
    revokeUserSockets(payload.sub)
    await createAuditLog({
      userId: payload.sub,
      action: 'REFRESH_TOKEN_REUSE',
      resource: 'AUTH',
      details: { reason: 'Token rotacionado reutilizado — todas as sessões revogadas' },
    })
  } catch { /* assinatura inválida ou expirada: apenas rejeita */ }
}

/**
 * Gera um novo Access Token a partir de um Refresh Token válido.
 * 
 * @param token - O Refresh Token enviado pelo cliente
 * @returns Um novo Access Token
 */
export async function refreshService(token: string) {
  const tokenHash = hashToken(token)

  // 1. Verifica se o token existe no banco (guardamos apenas o hash).
  const stored = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
    include: { user: true },
  })

  // 1a. Detecção de reuso/roubo: se a assinatura é válida mas o token não está
  // mais no banco, ele já foi rotacionado (usado uma vez). Reuso indica que o
  // token foi comprometido — revogamos TODAS as sessões do usuário por segurança.
  if (!stored) {
    await revokeSessionsOnReuse(token)
    throw new AppError(401, 'Refresh token inválido ou expirado', 'UNAUTHORIZED')
  }

  // Linha vencida com JWT ainda válido: a rotação encurtou a linha e a tolerância
  // passou, então é reuso. Vencimento natural tem o JWT vencido junto e não revoga.
  if (stored.expires_at < new Date()) {
    await prisma.refreshToken.delete({ where: { id: stored.id } }).catch(() => {})
    await revokeSessionsOnReuse(token)
    throw new AppError(401, 'Refresh token inválido ou expirado', 'UNAUTHORIZED')
  }

  if (!stored.user.active || stored.user.deleted_at) {
    await prisma.refreshToken.deleteMany({ where: { user_id: stored.user.id } })
    throw new AppError(401, 'Conta desativada', 'UNAUTHORIZED')
  }

  // 2. Valida a assinatura do token (integridade criptográfica).
  let verified: { rm?: boolean }
  try {
    verified = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as { rm?: boolean }
  } catch {
    throw new AppError(401, 'Refresh token inválido', 'UNAUTHORIZED')
  }
  // Tokens emitidos antes do claim `rm` existir: deduz pela duração original.
  const rememberMe = verified.rm
    ?? stored.expires_at.getTime() - stored.created_at.getTime() > parseDurationMs(env.JWT_REFRESH_EXPIRES_IN)
  const refreshExpiry = rememberMe ? REMEMBER_ME_DURATION : env.JWT_REFRESH_EXPIRES_IN

  // 3. Gera um novo Access Token com o perfil ATUAL do usuário no banco.
  // Usar stored.user garante que mudanças de role/org refletem imediatamente no próximo refresh.
  const { user } = stored
  const accessToken = jwt.sign(
    { sub: user.id, role: user.role, orgId: user.org_id, permissions: user.permissions || [], iat_ms: Date.now() },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions,
  )

  // 4. ROTAÇÃO: emite um novo refresh token (mesma duração do original — sessão
  // deslizante) e encurta o atual para ROTATION_GRACE_MS. Passada a tolerância,
  // o antigo expira e sai do banco; se reaparecer depois, a detecção de reuso (1a) dispara.
  const newRefreshToken = jwt.sign(
    { sub: user.id, role: user.role, orgId: user.org_id, permissions: user.permissions || [], rm: rememberMe },
    env.JWT_REFRESH_SECRET,
    { expiresIn: refreshExpiry, jwtid: randomUUID() } as jwt.SignOptions,
  )
  const newExpiresAt = new Date(Date.now() + parseDurationMs(refreshExpiry))
  const graceUntil = new Date(Math.min(stored.expires_at.getTime(), Date.now() + ROTATION_GRACE_MS))
  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: stored.id }, data: { expires_at: graceUntil } }),
    prisma.refreshToken.create({
      data: { token: hashToken(newRefreshToken), user_id: user.id, expires_at: newExpiresAt },
    }),
  ])

  return { accessToken, refreshToken: newRefreshToken, rememberMe, user: await buildSessionUser(user) }
}

interface SessionSource {
  id: string
  name: string
  email: string
  role: string
  org_id: string | null
  queues: string[]
  permissions: string[] | null
  avatar: string | null
  auth_provider: string | null
  must_change_password: boolean
}

/**
 * Dados da sessão (login, refresh e GET /api/auth/me): perfil, módulos,
 * capacidades do catálogo e tela inicial. Uma função só: antes o mesmo bloco
 * vivia copiado no login e no refresh.
 */
export async function buildSessionUser(user: SessionSource) {
  const [modules, { expiredQueues, queueAccessWarnings }] = await Promise.all([
    getEffectiveModules(user.id, user.role),
    collectExpirationAlerts(user),
  ])
  const permissions = user.permissions || []
  const capabilities = capabilitiesOf({ sub: user.id, role: user.role, permissions, modules })
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    orgId: user.org_id,
    queues: user.queues,
    permissions,
    modules,
    capabilities,
    home: homeFor(user.role, modules, capabilities),
    expiredQueues,
    queueAccessWarnings,
    // Se não tiver avatar, gera as iniciais a partir do nome.
    avatar: presentAttachment(user.avatar) ?? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase(),
    authProvider: user.auth_provider,
    mustChangePassword: user.must_change_password,
  }
}

/** Sessão atual lida do banco (cargo, liberações e módulos de agora, não os do token). */
export async function getSessionUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.active || user.deleted_at) throw new AppError(401, 'Não autenticado', 'UNAUTHORIZED')
  return buildSessionUser(user)
}

export async function logoutService(token: string) {
  // Invalida um Refresh Token no banco de dados (logout). Buscamos pelo hash.
  const tokenHash = hashToken(token)
  const stored = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
    select: { user_id: true }
  })

  if (stored) {
    // CWE-613: o access token é stateless e continuaria válido até expirar.
    // Marcamos o instante do logout no usuário; authenticate() rejeita qualquer
    // token emitido (iat) antes ou no mesmo instante desta marca.
    await prisma.user.update({
      where: { id: stored.user_id },
      data: { session_invalidated_at: new Date() },
    })
    // A marca derruba a sessão em todos os aparelhos; os sockets abertos iam junto só no próximo evento.
    revokeUserSockets(stored.user_id)

    await createAuditLog({
      userId: stored.user_id,
      action: 'LOGOUT',
      resource: 'AUTH'
    })
  }

  // Remove o registro do banco, impedindo novos refreshes com este token.
  await prisma.refreshToken.deleteMany({ where: { token: tokenHash } })
}

/**
 * Alertas de expiração de contrato: a empresa do próprio usuário + as da carteira
 * efetiva (antes vinham dos vínculos OrgManagerLink). Carteira "Todas" = todas as empresas.
 */
async function collectExpirationAlerts(user: { id: string; role: string; org_id: string | null }) {
  const expiredQueues: any[] = []
  const queueAccessWarnings: any[] = []

  let orgFilter: { id?: { in: string[] } } | null
  if (['agent', 'supervisor', 'manager', 'admin'].includes(user.role)) {
    const scope = await getEffectiveScope(user.id, user.role)
    const ids = [...new Set([...(user.org_id ? [user.org_id] : []), ...scope.orgIds])]
    orgFilter = scope.scopeAll ? {} : ids.length ? { id: { in: ids } } : null
  } else {
    orgFilter = user.org_id ? { id: { in: [user.org_id] } } : null
  }
  if (!orgFilter) return { expiredQueues, queueAccessWarnings }

  const orgs = await prisma.organization.findMany({
    where: { ...orgFilter, expires_at: { not: null }, warning_active: true },
  })

  const now = new Date()
  const ninetyDaysFromNow = new Date()
  ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90)

  for (const org of orgs) {
    if (!org.expires_at) continue
    const expiresAt = org.expires_at
    const queueName = `Plano SLA (${org.tier.toUpperCase()})`
    // Já vencido
    if (expiresAt < now) {
      expiredQueues.push({ orgId: org.id, orgName: org.name, queueId: org.tier, queueName, expiresAt, message: org.expiry_message })
    }
    // Vence em 90 dias ou menos (incluindo já vencido)
    if (expiresAt <= ninetyDaysFromNow) {
      const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      queueAccessWarnings.push({ orgId: org.id, orgName: org.name, queueId: org.tier, queueName, expiresAt: expiresAt.toISOString(), daysRemaining, message: org.expiry_message })
    }
  }
  return { expiredQueues, queueAccessWarnings }
}
