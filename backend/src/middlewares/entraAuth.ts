// backend/src/middlewares/entraAuth.ts
import { createPublicKey } from 'node:crypto'
import { NextFunction, Request, Response } from 'express'
import jwt, { type JwtPayload } from 'jsonwebtoken'
import { z } from 'zod'
import prisma from '../config/prisma'
import { tenantAllowed } from '../services/ssoSettings'
import { AppError } from './errorHandler'
import { selectMicrosoftSigningKey } from '../services/teamsSso'
import { resolveUserIdFromToken } from '../services/mcpTokens'
import type { AssistantChannel } from '../ai/assistant/types'

declare module 'express-serve-static-core' {
  interface Request {
    mcpUserId?: string
    mcpVia?: AssistantChannel
  }
}

/**
 * Token de acesso do Entra ID para o MCP de chamados (Copilot / agente do M365).
 * Mesmo app do SSO do Teams por padrão; MCP_ENTRA_AUDIENCE troca ou soma
 * audiences (lista separada por vírgula), MCP_ENTRA_SCOPE o escopo exigido e
 * MCP_ENTRA_TENANTS restringe os tenants aceitos (vazio = qualquer tenant; quem
 * entra é decidido pela conta Microsoft já existente no ISA).
 */
const DEFAULT_SCOPE = 'access_as_user'
const MICROSOFT_JWKS_URL = 'https://login.microsoftonline.com/organizations/discovery/v2.0/keys'
const JWKS_CACHE_MS = 60 * 60 * 1000

type MicrosoftJwk = Parameters<typeof selectMicrosoftSigningKey>[0][number]

let cachedJwks: { expiresAt: number; keys: MicrosoftJwk[] } | null = null

export interface EntraPolicy {
  audiences: string[]
  scope: string
  tenants: string[]
}

const list = (value: string | undefined) => (value ?? '').split(',').map(v => v.trim()).filter(Boolean)

export function entraPolicy(env: NodeJS.ProcessEnv = process.env): EntraPolicy {
  const audiences = list(env.MCP_ENTRA_AUDIENCE)
  return {
    audiences: audiences.length ? audiences : list(env.TEAMS_SSO_CLIENT_ID),
    scope: env.MCP_ENTRA_SCOPE?.trim() || DEFAULT_SCOPE,
    tenants: list(env.MCP_ENTRA_TENANTS).map(t => t.toLowerCase()),
  }
}

function invalidToken() {
  return new AppError(401, 'Token Microsoft inválido', 'ENTRA_TOKEN_INVALID')
}

const issuerForTenant = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/v2.0`
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Regras dos claims depois da assinatura conferida; devolve o e-mail (UPN) da pessoa. */
export function validateEntraClaims(claims: JwtPayload, policy: EntraPolicy): { email: string; tenantId: string } {
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.some(a => typeof a === 'string' && policy.audiences.includes(a))) throw invalidToken()
  if (typeof claims.scp !== 'string' || !claims.scp.split(' ').includes(policy.scope)) throw invalidToken()

  const tid = claims.tid
  if (typeof tid !== 'string' || !TENANT_ID.test(tid) || claims.iss !== issuerForTenant(tid)) throw invalidToken()
  if (policy.tenants.length && !policy.tenants.includes(tid.toLowerCase())) throw invalidToken()

  const email = z.string().trim().email().safeParse(claims.preferred_username ?? claims.upn)
  if (!email.success) throw invalidToken()
  return { email: email.data, tenantId: tid }
}

async function signingKey(keyId: string): Promise<MicrosoftJwk> {
  if (!cachedJwks || cachedJwks.expiresAt <= Date.now()) {
    const response = await fetch(MICROSOFT_JWKS_URL, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw invalidToken()
    const body = await response.json() as { keys?: unknown }
    if (!Array.isArray(body.keys)) throw invalidToken()
    cachedJwks = { expiresAt: Date.now() + JWKS_CACHE_MS, keys: body.keys as MicrosoftJwk[] }
  }
  const key = selectMicrosoftSigningKey(cachedJwks.keys, keyId)
  if (!key) throw invalidToken()
  return key
}

/** Assinatura (JWKS da Microsoft, RS256) + claims + issuer da chave para o tenant do token. */
export async function verifyEntraToken(token: string, policy: EntraPolicy = entraPolicy()) {
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded === 'string' || decoded.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string') {
    throw invalidToken()
  }
  const key = await signingKey(decoded.header.kid)
  let claims: JwtPayload
  try {
    claims = jwt.verify(token, createPublicKey({ key, format: 'jwk' }), { algorithms: ['RS256'] }) as JwtPayload
  } catch {
    throw invalidToken()
  }
  const identity = validateEntraClaims(claims, policy)
  if (key.issuer?.replace('{tenantid}', identity.tenantId) !== issuerForTenant(identity.tenantId)) throw invalidToken()
  if (!await tenantAllowed(identity.tenantId)) throw invalidToken()
  return identity
}

/**
 * Só consulta (não cria conta): mesma regra do login Microsoft — e-mail de uma
 * conta ativa com auth_provider 'microsoft'. Quem nunca entrou no ISA entra
 * uma vez pelo portal ou pelo Teams (lá o domínio autorizado cria a conta).
 */
export async function findEntraUser(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, deleted_at: null, active: true, auth_provider: 'microsoft' },
    select: { id: true },
  })
}

function bearer(req: Request) {
  const header = req.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/**
 * /mcp/chamados: aceita token pessoal isamcp_ (via 'mcp') ou token do Entra ID
 * (via 'copilot'). Sem trava de módulo: as tools só enxergam os chamados que a
 * própria pessoa abriu.
 */
export async function authenticateMcpChamados(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearer(req)
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="isa"')
      throw new AppError(401, 'Informe o token no header Authorization', 'MCP_TOKEN_MISSING')
    }

    let userId: string | null = null
    let via: AssistantChannel = 'mcp'
    if (token.startsWith('isamcp_')) {
      userId = await resolveUserIdFromToken(token)
      if (!userId) throw new AppError(401, 'Token MCP inválido ou revogado', 'MCP_TOKEN_INVALID')
    } else {
      const identity = await verifyEntraToken(token)
      userId = (await findEntraUser(identity.email))?.id ?? null
      if (!userId) throw new AppError(403, 'Conta Microsoft sem acesso ao ISA. Entre uma vez pelo portal ou pelo Teams.', 'ENTRA_USER_NOT_FOUND')
      via = 'copilot'
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { active: true, deleted_at: true } })
    if (!user || !user.active || user.deleted_at) throw new AppError(401, 'Token MCP inválido ou revogado', 'MCP_TOKEN_INVALID')

    req.mcpUserId = userId
    req.mcpVia = via
    next()
  } catch (error) {
    next(error)
  }
}
