/**
 * Chaves da API pública de Projetos (/api/integrations/v1/projects).
 *
 * Mesmo formato das chaves da API de chamados (gerada na criação, guardada só
 * como SHA-256, escopos por recurso), com duas diferenças que o módulo exige:
 * - toda ação precisa de um usuário real (histórico, criador da task), então
 *   cada chave tem um usuário de serviço próprio ("API · <nome>") que não faz
 *   login nem aparece na gestão de usuários;
 * - o alcance segue a regra dos webhooks do módulo: sem projetos = todos (só
 *   admin), senão só projetos em que o dono da chave participa como dono,
 *   gerente ou membro — conferido a cada requisição, não só na criação. O
 *   poder em cada projeto é o papel dele ali (membro não configura o projeto).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { hashApiKey } from './apiKeys'
import { getEffectiveModules } from './moduleAccess'
import { can } from '../access/can'

export const PROJECT_API_SCOPES = [
  'read_projects', 'write_projects',
  'read_tasks', 'write_tasks',
  'read_comments', 'write_comments',
  'read_members', 'write_members',
  'read_structure', 'write_structure',
  'read_documents', 'write_documents',
  'read_attachments', 'write_attachments',
  'read_time',
  'read_tickets', 'write_tickets',
] as const

export type ProjectApiScope = (typeof PROJECT_API_SCOPES)[number]

export const projectApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  scopes: z.array(z.enum(PROJECT_API_SCOPES)).min(1, 'Escolha ao menos um escopo'),
  active: z.boolean().default(true),
  // Vazio = todos os projetos, presentes e futuros (só admin).
  projectIds: z.array(z.string().uuid()).default([]),
})

const KEY_PREFIX = 'isaproj_'

export const SAFE_SELECT = {
  id: true, name: true, description: true, key_prefix: true, scopes: true, active: true,
  created_by: true, service_user_id: true, last_used_at: true, created_at: true, updated_at: true,
  projects: { select: { project_id: true } },
} as const

/** Contexto da requisição autenticada: quem age e onde pode agir. */
export interface ProjectApiKeyContext {
  id: string
  scopes: string[]
  serviceUserId: string
  /** null = todos os projetos ativos. */
  projectIds: string[] | null
  /** Poder da chave por projeto = papel de quem a criou (admin/dono/gerente → manager). */
  roles: Record<string, 'manager' | 'member'>
}

/** Chave global (admin) é gerente em tudo; as demais seguem o papel do criador no projeto. */
export function keyRoleIn(ctx: ProjectApiKeyContext, projectId: string): 'manager' | 'member' {
  return ctx.projectIds === null ? 'manager' : ctx.roles[projectId] ?? 'member'
}

/** Cria o usuário técnico que assina as ações da chave. */
async function createServiceUser(tx: Prisma.TransactionClient, keyName: string) {
  return tx.user.create({
    data: {
      name: `API · ${keyName}`,
      // Domínio .invalid (RFC 2606): nunca casa com conta real nem com SSO.
      email: `api-${randomUUID()}@projetos-api.invalid`,
      password: null,
      role: 'agent',
      module_projects: true,
      is_service_account: true,
      queues: [],
    },
    select: { id: true },
  })
}

export async function createProjectApiKey(creatorId: string, data: z.infer<typeof projectApiKeySchema>) {
  const token = `${KEY_PREFIX}${randomBytes(32).toString('hex')}`
  const key = await prisma.$transaction(async (tx) => {
    const serviceUser = await createServiceUser(tx, data.name)
    return tx.projectApiKey.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        scopes: data.scopes,
        active: data.active,
        key_hash: hashApiKey(token),
        key_prefix: token.slice(0, KEY_PREFIX.length + 4),
        created_by: creatorId,
        service_user_id: serviceUser.id,
        projects: { create: data.projectIds.map((project_id) => ({ project_id })) },
      },
      select: SAFE_SELECT,
    })
  })
  // Única resposta que carrega a chave em texto.
  return { ...key, key: token }
}

export async function updateProjectApiKey(id: string, data: Partial<z.infer<typeof projectApiKeySchema>>) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.projectApiKey.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.scopes !== undefined ? { scopes: data.scopes } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.projectIds !== undefined
          ? { projects: { deleteMany: {}, create: data.projectIds.map((project_id) => ({ project_id })) } }
          : {}),
      },
      select: SAFE_SELECT,
    })
    if (data.name !== undefined) await tx.user.update({ where: { id: key.service_user_id }, data: { name: `API · ${data.name}` } })
    return key
  })
}

export async function regenerateProjectApiKey(id: string) {
  const token = `${KEY_PREFIX}${randomBytes(32).toString('hex')}`
  const key = await prisma.projectApiKey.update({
    where: { id },
    data: { key_hash: hashApiKey(token), key_prefix: token.slice(0, KEY_PREFIX.length + 4) },
    select: SAFE_SELECT,
  })
  return { ...key, key: token }
}

/**
 * Remove a chave e o log de requisições dela. O usuário de serviço fica
 * (assina tasks e históricos), só é desativado.
 */
export async function deleteProjectApiKey(id: string) {
  await prisma.$transaction(async (tx) => {
    const key = await tx.projectApiKey.delete({ where: { id }, select: { service_user_id: true } })
    await tx.user.update({ where: { id: key.service_user_id }, data: { active: false } })
  })
}

const REQUESTS_PAGE_SIZE = 20

export async function listProjectApiKeyRequests(id: string, page = 1) {
  const where = { project_api_key_id: id }
  const [total, requests] = await Promise.all([
    prisma.apiRequestLog.count({ where }),
    prisma.apiRequestLog.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * REQUESTS_PAGE_SIZE, take: REQUESTS_PAGE_SIZE }),
  ])
  return { data: requests, meta: { total, page, pages: Math.max(1, Math.ceil(total / REQUESTS_PAGE_SIZE)) } }
}

/**
 * Resolve o token da requisição. Chave sem alcance (dono desativado, deixou de
 * ser admin, de gerir os projetos, ou perdeu o módulo ou a liberação que a tela
 * de chaves exige) é recusada como inválida.
 */
export async function authenticateProjectApiToken(token: string): Promise<ProjectApiKeyContext> {
  const key = await prisma.projectApiKey.findUnique({
    where: { key_hash: hashApiKey(token) },
    include: {
      creator: { select: { role: true, permissions: true, active: true, deleted_at: true } },
      projects: { select: { project_id: true } },
    },
  })
  if (!key || !key.active || !key.creator.active || key.creator.deleted_at) {
    throw new AppError(401, 'API key inválida', 'API_KEY_INVALID')
  }

  const creatorIsAdmin = key.creator.role === 'admin'
  if (!creatorIsAdmin) {
    const { role, permissions } = key.creator
    const modules = await getEffectiveModules(key.created_by, role)
    // Só o módulo: a liberação de integrações vale para criar a chave. Em produção há chave
    // em uso de analista que nunca teve a liberação, e exigi-la aqui derrubaria a integração.
    if (!can({ sub: key.created_by, role, permissions, modules }, 'projects.use')) {
      throw new AppError(401, 'API key inválida', 'API_KEY_INVALID')
    }
  }
  let projectIds: string[] | null
  const roles: ProjectApiKeyContext['roles'] = {}
  if (key.projects.length === 0) {
    if (!creatorIsAdmin) throw new AppError(401, 'API key inválida', 'API_KEY_INVALID')
    projectIds = null
  } else if (creatorIsAdmin) {
    projectIds = key.projects.map((p) => p.project_id)
    for (const id of projectIds) roles[id] = 'manager'
  } else {
    // Leitor (viewer) ou quem saiu do projeto: a chave perde aquele projeto.
    const memberships = await prisma.projectMember.findMany({
      where: { user_id: key.created_by, project_id: { in: key.projects.map((p) => p.project_id) }, role: { in: ['owner', 'manager', 'member'] } },
      select: { project_id: true, role: true },
    })
    projectIds = memberships.map((m) => m.project_id)
    for (const m of memberships) roles[m.project_id] = m.role === 'member' ? 'member' : 'manager'
  }

  prisma.projectApiKey.update({ where: { id: key.id }, data: { last_used_at: new Date() } }).catch(() => undefined)
  return { id: key.id, scopes: key.scopes, serviceUserId: key.service_user_id, projectIds, roles }
}

/** Filtro de projetos ao alcance da chave (arquivados ficam de fora). */
export function keyProjectsWhere(ctx: ProjectApiKeyContext): Prisma.ProjectWhereInput {
  return { archived_at: null, ...(ctx.projectIds ? { id: { in: ctx.projectIds } } : {}) }
}

export async function assertKeyProject(ctx: ProjectApiKeyContext, projectId: string) {
  // AND: o filtro da chave também tem `id` e, num spread, apagaria o id pedido.
  const project = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, keyProjectsWhere(ctx)] }, select: { id: true } })
  // 404 e não 403: a chave não deve descobrir projetos fora do alcance dela.
  if (!project) throw new AppError(404, 'Projeto não encontrado', 'NOT_FOUND')
}
