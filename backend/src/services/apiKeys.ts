/**
 * CRUD administrativo das API keys da API externa de integração
 * (/api/integrations/v1/*).
 *
 * Segurança: a key é armazenada como hash SHA-256; o valor pleno só é
 * retornado uma única vez, na criação/regeneração.
 */
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from './audit'
import { AuditInfo } from '../utils/audit'

export const API_KEY_SCOPES = [
  'create_ticket',
  'update_ticket',
  'close_ticket',
  'create_user',
  'update_user',
  'read_categories',
  'read_subcategories',
  'read_queues',
  'read_organizations',
  'read_tickets',
  'read_messages',
  'create_message',
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

// ------------------------------------------------------------------
// Schemas
// ------------------------------------------------------------------

const scopesList = z.array(z.enum(API_KEY_SCOPES)).min(1, 'Selecione pelo menos um escopo')

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: scopesList,
  org_id: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
})

export const updateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  scopes: scopesList.optional(),
  org_id: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
})

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const SAFE_SELECT = {
  id: true,
  name: true,
  key_prefix: true,
  scopes: true,
  org_id: true,
  active: true,
  created_by_id: true,
  created_at: true,
  updated_at: true,
  last_used_at: true,
} as const

function newApiKeyToken(): string {
  return `isakey_${randomBytes(32).toString('hex')}`
}

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function getApiKeyOr404(id: string) {
  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key) throw new AppError(404, 'API key não encontrada', 'API_KEY_NOT_FOUND')
  return key
}

async function validateOrgId(orgId: string | null | undefined): Promise<void> {
  if (!orgId) return
  const org = await prisma.organization.findFirst({ where: { id: orgId, active: true, deleted_at: null } })
  if (!org) {
    throw new AppError(400, 'Organização informada não existe ou está inativa', 'API_KEY_ORG_INVALID')
  }
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export function listScopes() {
  return API_KEY_SCOPES
}

export async function listApiKeys() {
  return prisma.apiKey.findMany({
    select: { ...SAFE_SELECT, _count: { select: { requests: true } } },
    orderBy: { created_at: 'asc' },
  }).then((keys) => keys.map(({ _count, ...k }) => ({ ...k, requests_count: _count.requests })))
}

export async function createApiKey(input: unknown, audit?: AuditInfo) {
  const data = createApiKeySchema.parse(input)
  await validateOrgId(data.org_id)

  const token = newApiKeyToken()
  const key = await prisma.apiKey.create({
    data: {
      name: data.name,
      scopes: data.scopes,
      org_id: data.org_id ?? null,
      active: data.active,
      key_hash: hashApiKey(token),
      key_prefix: token.slice(0, 11),
      created_by_id: audit?.actorId ?? null,
    },
    select: SAFE_SELECT,
  })

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'CREATE_API_KEY',
      resource: 'API_KEY',
      details: { apiKeyId: key.id, name: key.name, scopes: key.scopes, orgId: key.org_id },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }

  // A key só é exposta aqui, uma única vez.
  return { ...key, key: token }
}

export async function updateApiKey(id: string, input: unknown, audit?: AuditInfo) {
  await getApiKeyOr404(id)
  const data = updateApiKeySchema.parse(input)
  if (data.org_id !== undefined) await validateOrgId(data.org_id)

  const key = await prisma.apiKey.update({
    where: { id },
    data,
    select: SAFE_SELECT,
  })

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'UPDATE_API_KEY',
      resource: 'API_KEY',
      details: { apiKeyId: id, changes: data },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }

  return key
}

export async function deleteApiKey(id: string, audit?: AuditInfo) {
  const key = await getApiKeyOr404(id)
  await prisma.apiKey.delete({ where: { id } })

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'DELETE_API_KEY',
      resource: 'API_KEY',
      details: { apiKeyId: id, name: key.name },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }
}

export async function regenerateApiKey(id: string, audit?: AuditInfo) {
  await getApiKeyOr404(id)

  const token = newApiKeyToken()
  const key = await prisma.apiKey.update({
    where: { id },
    data: { key_hash: hashApiKey(token), key_prefix: token.slice(0, 11) },
    select: SAFE_SELECT,
  })

  if (audit?.actorId) {
    await createAuditLog({
      userId: audit.actorId,
      action: 'REGENERATE_API_KEY',
      resource: 'API_KEY',
      details: { apiKeyId: id },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }

  return { ...key, key: token }
}

const REQUESTS_PAGE_SIZE = 20

export async function listApiKeyRequests(id: string, page = 1) {
  await getApiKeyOr404(id)

  const [total, requests] = await Promise.all([
    prisma.apiRequestLog.count({ where: { api_key_id: id } }),
    prisma.apiRequestLog.findMany({
      where: { api_key_id: id },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * REQUESTS_PAGE_SIZE,
      take: REQUESTS_PAGE_SIZE,
    }),
  ])

  return {
    data: requests,
    meta: { total, page, pages: Math.max(1, Math.ceil(total / REQUESTS_PAGE_SIZE)) },
  }
}
