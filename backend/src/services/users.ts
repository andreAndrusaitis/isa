import { revokeUserSockets } from '../config/socket'
import bcrypt from 'bcryptjs'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { z } from 'zod'
import { createAuditLog } from './audit'
import { AuditInfo } from '../utils/audit'
import { sendWelcomeEmail } from './email/mailer'
import { emitWebhookEvent, buildUserPayload } from './webhookEvents'
import { getIo, syncUserQueueRooms } from '../config/socket'
import { logger } from '../utils/logger'
import { getOrgServedBy } from './scope'
import { deactivateMcpTokens } from './mcpTokens'

function sanitizeId(id: any): string | null {
  if (typeof id !== 'string' || id.trim() === '' || id === 'null' || id === 'undefined') return null
  return id
}

function buildDeletedEmail(email: string, userId: string): string {
  const atIndex = email.lastIndexOf('@')
  if (atIndex <= 0) return `${email}+deleted-${userId}`

  const localPart = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1)
  return `${localPart}+deleted-${userId}@${domain}`
}

type UserRole = 'admin' | 'manager' | 'supervisor' | 'agent' | 'user'

// O que o painel de usuários usa da ficha. Lista fechada: coluna nova não vaza por padrão.
const USER_EVENT_FIELDS = [
  'id', 'name', 'email', 'role', 'active', 'avatar', 'phone', 'position', 'department', 'location',
  'queues', 'permissions', 'manager_global', 'module_tickets', 'module_projects', 'module_documents',
  'org_id', 'orgId', 'org', 'manager_id', 'managerId', 'orgScopeIds', 'auth_provider', 'authProvider',
  'must_change_password', 'welcome_email_status', 'welcome_email_sent_at', 'created_at', 'updated_at',
] as const

function userEventPayload(user: Record<string, any>) {
  return Object.fromEntries(USER_EVENT_FIELDS.filter(f => f in user).map(f => [f, user[f]]))
}

/**
 * Quem recebe os eventos da ficha, com a regra do GET /users: administrador só para
 * administradores; cliente só para quem tem a empresa na carteira (o resto da equipe
 * sai da sala); demais perfis para toda a equipe.
 */
async function userEventAudience(io: NonNullable<ReturnType<typeof getIo>>, user: { role: string; org_id: string | null }) {
  if (user.role === 'admin') return io.to('role:admin')
  if (user.role !== 'user') return io.to('users:staff')
  const [served, staff] = await Promise.all([
    getOrgServedBy(user.org_id ?? ''),
    prisma.user.findMany({ where: { role: { in: ['agent', 'supervisor', 'manager'] }, deleted_at: null }, select: { id: true } }),
  ])
  const allowed = new Set([...served.managers, ...served.team].map(s => s.id))
  return io.to('users:staff').except(staff.filter(s => !allowed.has(s.id)).map(s => `user:${s.id}`))
}

interface ListUsersFilters {
  orgId?: string
  roles?: UserRole[]
  userId?: string
  /** Restringe à sub-árvore do organograma (descendentes via manager_id + o próprio). */
  managerScopeRootId?: string
  /** Carteira de quem lista: clientes (role user) só destas empresas; staff não é filtrado. */
  clientOrgIds?: string[]
}

/** Coleta recursivamente os ids da sub-árvore de gestão (root + todos os descendentes). */
async function collectSubtreeIds(rootId: string): Promise<string[]> {
  const ids = new Set<string>([rootId])
  let frontier = [rootId]
  while (frontier.length) {
    const children = await prisma.user.findMany({
      where: { manager_id: { in: frontier }, deleted_at: null },
      select: { id: true },
    })
    frontier = children.map(c => c.id).filter(id => !ids.has(id))
    frontier.forEach(id => ids.add(id))
  }
  return [...ids]
}

export const createUserSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(50, 'Nome deve ter no máximo 50 caracteres'),
  email: z.string().email(),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(72).or(z.literal('')).optional(),
  authProvider: z.enum(['local', 'microsoft']).default('local'),
  role: z.enum(['user', 'agent', 'supervisor', 'manager', 'admin']),
  orgId: z.string().nullable().optional(),
  org_id: z.string().nullable().optional(),
  queues: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  org_scope_ids: z.array(z.string()).optional(), // empresas que a pessoa atende (UserOrgScope)
  manager_global: z.boolean().optional(), // carteira "Todas as empresas (inclusive novas)" — só admin define
  position: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  manager_id: z.string().nullable().optional(),
  active: z.boolean().optional(),
}).refine(
  (data) => data.authProvider === 'microsoft' || (data.password && data.password.length >= 6),
  { message: 'Senha é obrigatória para contas de login local', path: ['password'] },
)

export const updateUserSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(50, 'Nome deve ter no máximo 50 caracteres').optional(),
  email: z.string().email().optional(),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(72).or(z.literal('')).optional(),
  authProvider: z.enum(['local', 'microsoft']).optional(),
  role: z.enum(['user', 'agent', 'supervisor', 'manager', 'admin']).optional(),
  orgId: z.string().nullable().optional(),
  org_id: z.string().nullable().optional(),
  queues: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  org_scope_ids: z.array(z.string()).optional(),
  manager_global: z.boolean().optional(),
  position: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  manager_id: z.string().nullable().optional(),
  active: z.boolean().optional(),
  // Módulos: null = herda do gerente (carteira); true/false = exceção.
  module_tickets: z.boolean().nullable().optional(),
  module_projects: z.boolean().nullable().optional(),
  module_documents: z.boolean().nullable().optional(),
})

export async function listUsers(filters: ListUsersFilters = {}) {
  if (filters.roles && filters.roles.length === 0) return []

  let idFilter: any = filters.userId || undefined
  if (filters.managerScopeRootId) {
    idFilter = { in: await collectSubtreeIds(filters.managerScopeRootId) }
  }

  const users = await prisma.user.findMany({
    where: {
      deleted_at: null,
      is_service_account: false,
      id: idFilter,
      org_id: filters.orgId || undefined,
      role: filters.roles ? { in: filters.roles } : undefined,
      ...(filters.clientOrgIds && { OR: [{ role: { not: 'user' } }, { org_id: { in: filters.clientOrgIds } }] }),
    },
    include: { org: true, manager: { select: { id: true, name: true } }, org_scopes: { select: { org_id: true } } },
    orderBy: { name: 'asc' },
  })
  return users.map(u => ({ ...u, authProvider: u.auth_provider, orgId: u.org_id, managerId: u.manager_id, orgScopeIds: u.org_scopes.map(s => s.org_id) }))
}

// Retorna o próprio usuário e toda a cadeia de responsáveis acima dele
// (manager_id → manager_id → ...). Usado pelo organograma para que um supervisor
// (Ticket Manager) ou analista enxergue o gerente padrão que está acima de si,
// que normalmente fica fora do escopo de visibilidade de usuários.
export async function getSelfAndAncestors(userId: string) {
  const chain: any[] = []
  const seen = new Set<string>()
  let currentId: string | null = userId
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const u: any = await prisma.user.findFirst({
      where: { id: currentId, deleted_at: null },
      include: { org: true, manager: { select: { id: true, name: true } }, org_scopes: { select: { org_id: true } } },
    })
    if (!u) break
    chain.push({ ...u, authProvider: u.auth_provider, orgId: u.org_id, managerId: u.manager_id, orgScopeIds: u.org_scopes.map((s: any) => s.org_id) })
    currentId = u.manager_id
  }
  return chain
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { org: true, manager: { select: { id: true, name: true } }, org_scopes: { select: { org_id: true } } },
  })
  if (!user || user.deleted_at) throw new AppError(404, 'Usuário não encontrado', 'USER_NOT_FOUND')
  return { ...user, authProvider: user.auth_provider, orgId: user.org_id, managerId: user.manager_id, orgScopeIds: user.org_scopes.map(s => s.org_id) }
}

export async function createUser(data: z.infer<typeof createUserSchema>, audit?: AuditInfo) {
  // Sem diferenciar maiúsculas: A@x.com e a@x.com são a mesma pessoa.
  const existing = await prisma.user.findFirst({ where: { email: { equals: data.email.trim(), mode: 'insensitive' as const } } })
  if (existing && !existing.deleted_at) throw new AppError(400, 'E-mail já cadastrado', 'EMAIL_ALREADY_EXISTS')

  const resolvedOrgId = data.orgId !== undefined ? data.orgId : data.org_id
  if (data.role !== 'admin' && !resolvedOrgId) {
    throw new AppError(400, 'Empresa é obrigatória para este perfil', 'ORG_REQUIRED')
  }

  const hashedPassword = data.authProvider === 'microsoft'
    ? null
    : await bcrypt.hash(data.password!, 10)

  const { orgId, org_id, org_scope_ids, authProvider, ...rest } = data
  const finalOrgId = sanitizeId(orgId !== undefined ? orgId : org_id)

  const user = await prisma.$transaction(async (tx) => {
    if (existing?.deleted_at) {
      await tx.user.update({
        where: { id: existing.id },
        data: { email: buildDeletedEmail(existing.email, existing.id) },
      })
    }

    return tx.user.create({
      data: {
        ...rest,
        password: hashedPassword,
        auth_provider: authProvider,
        // Conta local recém-criada recebe senha provisória por e-mail — força
        // a troca no primeiro login. Contas SSO não têm senha, não se aplica.
        must_change_password: authProvider !== 'microsoft',
        org_id: finalOrgId,
        manager_id: sanitizeId(data.manager_id),
        queues: data.queues || [],
        permissions: data.permissions || [],
      },
      include: { org: { select: { name: true } } },
    })
  })

  // Carteira de empresas (UserOrgScope) — só Analista/TM usam escopo por empresa.
  if (org_scope_ids && org_scope_ids.length > 0) {
    await prisma.userOrgScope.createMany({
      data: org_scope_ids.map((oid) => ({ user_id: user.id, org_id: oid })),
      skipDuplicates: true,
    })
  }

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'CREATE_USER',
      resource: 'USER',
      details: { createdUserId: user.id, email: user.email, role: user.role, orgId: user.org_id, authProvider: user.auth_provider },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }

  let welcomeUpdate: Partial<typeof user> = {}

  if (data.authProvider !== 'microsoft') {
    const emailResult = await sendWelcomeEmail({
      to: user.email,
      name: user.name,
      initialPassword: data.password,
      organizationName: user.org?.name ?? null,
    })

    welcomeUpdate = await prisma.user.update({
      where: { id: user.id },
      data: {
        welcome_email_sent_at: emailResult.status === 'SUCCESS' ? new Date() : null,
        welcome_email_status: emailResult.status,
        welcome_email_error: emailResult.error?.slice(0, 1000) ?? null,
      },
    })

    await createAuditLog({
      userId: audit?.actorId,
      action: 'WELCOME_EMAIL',
      resource: 'USER',
      details: {
        createdUserId: user.id,
        email: user.email,
        status: emailResult.status,
        error: emailResult.error,
      },
      ip: audit?.ip,
      userAgent: audit?.userAgent
    })
  }

  emitWebhookEvent('user.created', { user: buildUserPayload({ ...user, ...welcomeUpdate }) })

  const resultUser = {
    ...user,
    ...welcomeUpdate,
    authProvider: user.auth_provider,
    orgId: user.org_id,
    managerId: user.manager_id,
    orgScopeIds: org_scope_ids || [],
  }

  try {
    const io = getIo()
    if (io) {
      const audience = await userEventAudience(io, resultUser)
      audience.emit('user:created', { user: userEventPayload(resultUser), actorId: audit?.actorId ?? null })
    }
  } catch (err: any) {
    logger.warn('[UserService] Falha ao emitir socket user:created:', { error: err?.message })
  }

  return resultUser
}

export async function updateUser(id: string, data: z.infer<typeof updateUserSchema>, audit?: AuditInfo) {
  const user = await getUserById(id)

  const targetRole = data.role ?? user.role
  const hasOrgChange = data.orgId !== undefined || data.org_id !== undefined
  const resolvedOrgId = hasOrgChange
    ? (data.orgId !== undefined ? data.orgId : data.org_id)
    : user.org_id
  // Só exige empresa quando o PATCH mexe em empresa ou papel: staff legado sem
  // empresa precisa poder ser desativado/editado no resto.
  if ((hasOrgChange || data.role !== undefined) && targetRole !== 'admin' && !resolvedOrgId) {
    throw new AppError(400, 'Empresa é obrigatória para este perfil', 'ORG_REQUIRED')
  }

  const targetAuthProvider = data.authProvider ?? user.auth_provider
  let password = user.password
  let mustChangePassword = user.must_change_password
  // Troca da própria senha pela ficha (admin) não derruba a sessão de quem está salvando.
  let resetByOther = false

  if (targetAuthProvider === 'local') {
    const isSwitchingToLocal = user.auth_provider !== 'local'
    const hasExistingPassword = !!user.password
    const hasNewPassword = typeof data.password === 'string' && data.password.trim().length >= 6

    if (isSwitchingToLocal && !hasNewPassword) {
      throw new AppError(400, 'Senha de no mínimo 6 caracteres é obrigatória ao alterar para autenticação local.', 'PASSWORD_REQUIRED')
    }

    if (!hasExistingPassword && !hasNewPassword) {
      throw new AppError(400, 'Senha é obrigatória para conta com autenticação local.', 'PASSWORD_REQUIRED')
    }

    if (hasNewPassword) {
      password = await bcrypt.hash(data.password!.trim(), 10)
      resetByOther = audit?.actorId !== id
      if (isSwitchingToLocal) {
        mustChangePassword = true
      }
    }
  } else if (targetAuthProvider === 'microsoft') {
    password = null
    mustChangePassword = false
    if (user.auth_provider !== 'microsoft') {
      await prisma.refreshToken.deleteMany({ where: { user_id: id } })
      await deactivateMcpTokens(id)
    }
  }

  const { orgId, org_id, org_scope_ids, password: _pw, authProvider, ...rest } = data
  const hasOrgIdChange = orgId !== undefined || org_id !== undefined
  const finalOrgId = hasOrgIdChange ? sanitizeId(orgId !== undefined ? orgId : org_id) : undefined

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...rest,
      password,
      auth_provider: targetAuthProvider,
      must_change_password: mustChangePassword,
      session_invalidated_at: resetByOther || (targetAuthProvider === 'microsoft' && user.auth_provider !== 'microsoft') ? new Date() : undefined,
      org_id: hasOrgIdChange ? finalOrgId : undefined,
      manager_id: data.manager_id !== undefined ? sanitizeId(data.manager_id) : undefined,
    },
    include: { org: { select: { name: true } } },
  })

  if (data.queues !== undefined) syncUserQueueRooms(id, user.queues, updated.queues)

  // Senha redefinida por outra pessoa costuma ser resposta a conta comprometida:
  // nada do que estava logado sobrevive, como em /me/password.
  if (resetByOther) {
    await prisma.refreshToken.deleteMany({ where: { user_id: id } })
    await deactivateMcpTokens(id)
    const io = getIo()
    if (io) {
      io.to(`user:${id}`).emit('session:terminated', { reason: 'password_reset' })
      io.in(`user:${id}`).disconnectSockets(true)
    }
  }

  // Desativado: derruba sessões e sockets na hora (senão seguia recebendo eventos).
  if (data.active === false && user.active) {
    await prisma.refreshToken.deleteMany({ where: { user_id: id } })
    const io = getIo()
    if (io) {
      io.to(`user:${id}`).emit('session:terminated', { reason: 'user_deactivated' })
      io.in(`user:${id}`).disconnectSockets(true)
    }
  }

  // As salas por cargo são montadas na conexão: só uma conexão nova reflete o cargo novo.
  const moduleChanged = (['module_tickets', 'module_projects', 'module_documents'] as const)
    .some((m) => data[m] !== undefined && data[m] !== user[m])
  if ((data.role !== undefined && data.role !== user.role) || moduleChanged) revokeUserSockets(id)

  // Sincroniza a carteira de empresas (UserOrgScope) quando enviada.
  if (org_scope_ids !== undefined) {
    await prisma.userOrgScope.deleteMany({ where: { user_id: id } })
    if (org_scope_ids.length > 0) {
      await prisma.userOrgScope.createMany({
        data: org_scope_ids.map((oid) => ({ user_id: id, org_id: oid })),
        skipDuplicates: true,
      })
    }
  }

  if (audit?.actorId) {
    const auditDetails: Record<string, any> = { updatedUserId: id, changes: rest }
    if (data.authProvider && data.authProvider !== user.auth_provider) {
      auditDetails.authProviderChanged = { from: user.auth_provider, to: data.authProvider }
    }

    await createAuditLog({
      userId: audit.actorId,
      action: data.authProvider && data.authProvider !== user.auth_provider ? 'AUTH_PROVIDER_CHANGED' : 'UPDATE_USER',
      resource: 'USER',
      details: auditDetails,
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }

  emitWebhookEvent('user.updated', { user: buildUserPayload(updated) })

  const resultUser = {
    ...updated,
    authProvider: updated.auth_provider,
    orgId: updated.org_id,
    managerId: updated.manager_id,
    orgScopeIds: org_scope_ids !== undefined ? org_scope_ids : (user.orgScopeIds || []),
  }

  try {
    const io = getIo()
    if (io) {
      const audience = await userEventAudience(io, resultUser)
      audience.emit('user:updated', { user: userEventPayload(resultUser), actorId: audit?.actorId ?? null })
    }
  } catch (err: any) {
    logger.warn('[UserService] Falha ao emitir socket user:updated:', { error: err?.message })
  }

  return resultUser
}

export async function deleteUser(id: string, audit?: AuditInfo) {
  const user = await getUserById(id)

  const deletedAt = new Date()
  const deleted = await prisma.user.update({
    where: { id },
    data: {
      deleted_at: deletedAt,
      active: false,
      session_invalidated_at: deletedAt,
      email: buildDeletedEmail(user.email, user.id),
    },
    include: { org: true },
  })

  // Invalida e revoga sessões ativas (refresh tokens no banco)
  try {
    await prisma.refreshToken.deleteMany({ where: { user_id: id } })
  } catch (err: any) {
    logger.warn(`[UserService] Falha ao revogar refresh tokens do usuário ${id}:`, { error: err?.message })
  }

  // Notifica e desconecta sockets ativos do usuário excluído
  try {
    const io = getIo()
    if (io) {
      io.to(`user:${id}`).emit('session:terminated', { reason: 'user_deleted' })
      io.in(`user:${id}`).disconnectSockets(true)
      const audience = await userEventAudience(io, user)
      audience.emit('user:deleted', {
        userId: id,
        name: user.name,
        email: user.email,
        role: user.role,
        deletedAt: deletedAt.toISOString(),
        actorId: audit?.actorId ?? null,
      })
    }
  } catch (err: any) {
    logger.warn(`[UserService] Falha ao encerrar sockets do usuário ${id}:`, { error: err?.message })
  }

  // Identifica os dados do responsável pela exclusão para persistência imutável
  let actor: { id: string; name: string; email: string; role: string } | null = null
  if (audit?.actorId) {
    try {
      actor = await prisma.user.findUnique({
        where: { id: audit.actorId },
        select: { id: true, name: true, email: true, role: true },
      })
    } catch {
      // Falha não impeditiva
    }

    await createAuditLog({
      userId: audit.actorId,
      action: 'DELETE_USER',
      resource: 'USER',
      details: {
        deletedUserId: user.id,
        deletedUserName: user.name,
        deletedUserEmail: user.email,
        deletedUserRole: user.role,
        deletedUserOrgId: user.org_id,
        deletedUserOrgName: (user as any).org?.name ?? null,
        deletedAt: deletedAt.toISOString(),
        actorId: audit.actorId,
        actorName: actor?.name ?? null,
        actorEmail: actor?.email ?? null,
        actorRole: actor?.role ?? null,
      },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }

  // Dispara evento de webhook com snapshot completo e ator
  emitWebhookEvent('user.deleted', {
    user: buildUserPayload({
      ...user,
      deleted_at: deletedAt,
      active: false,
    }),
    actor: {
      id: audit?.actorId ?? null,
      name: actor?.name ?? null,
      email: actor?.email ?? null,
      role: actor?.role ?? null,
    },
  })

  logger.info(`[UserService] Usuário excluído com sucesso: ${user.name} (${user.email}) por ${actor?.email ?? audit?.actorId ?? 'Sistema'}`)

  return deleted
}
