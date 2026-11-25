import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { z } from 'zod'
import { createAuditLog } from './audit'
import { AuditInfo } from '../utils/audit'
import { EffectiveScope, scopeOrgWhere, addOrgToCreatorChain } from './scope'
import { emitWebhookEvent } from './webhookEvents'
import { DOMAIN_REGEX, sanitizeDomain } from '../utils/domainValidation'

export const orgSchema = z.object({
  name: z.string().min(1, 'Nome da organização é obrigatório'),
  domains: z.array(
    z.string()
      .transform(sanitizeDomain)
      .refine(val => DOMAIN_REGEX.test(val), {
        message: 'Domínio de e-mail inválido. Informe apenas o domínio com ponto e TLD válido (ex: empresa.com ou empresa.com.br).'
      })
  ).min(1, 'Pelo menos um domínio de e-mail é obrigatório')
   .transform(domains => Array.from(new Set(domains.filter(Boolean)))),
  tier: z.string().optional(),
  active: z.boolean().default(true),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  zip_code: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  queue_ids: z.array(z.string()).optional(),
  expires_at: z.string().nullable().optional(),
  expiry_message: z.string().nullable().optional(),
  warning_active: z.boolean().optional(),
  // Cliente pode responder por e-mail os e-mails de chamado (a resposta entra no chamado).
  email_reply_enabled: z.boolean().optional(),
})

export async function listOrganizations(scope?: EffectiveScope) {
  const where: any = { deleted_at: null }
  // Carteira efetiva: lista vazia = nenhuma empresa (fail-closed).
  if (scope) Object.assign(where, scopeOrgWhere(scope))
  return prisma.organization.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { queues: true, queue_access: { include: { queue: true } }, sla_config: true }
  })
}

export async function getOrganizationById(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    include: { queues: true, queue_access: { include: { queue: true } }, sla_config: true }
  })
  if (!org || org.deleted_at) throw new AppError(404, 'Organização não encontrada', 'ORG_NOT_FOUND')
  return org
}

export async function createOrganization(data: any, audit?: AuditInfo) {
  const { queue_ids, ...rest } = data
  const { tier = 'bronze' } = rest

  rest.tier = tier

  if (rest.expires_at) {
    rest.expires_at = new Date(rest.expires_at)
  } else if (rest.expires_at === '') {
    rest.expires_at = null
  }

  const org = await prisma.organization.create({
    data: {
      ...rest,
      queues: queue_ids ? { connect: queue_ids.map((id: string) => ({ id })) } : undefined
    },
    include: { queues: true, queue_access: { include: { queue: true } }, sla_config: true }
  })
  
  // Quem cria (não-admin) não pode perder a empresa que acabou de criar (carteira fail-closed).
  if (audit?.actorId) await addOrgToCreatorChain(audit.actorId, org.id)

  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'CREATE_ORG',
      resource: 'ORG',
      details: { orgId: org.id, name: org.name },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }

  emitWebhookEvent('organization.created', {
    organization: { id: org.id, name: org.name, tier: org.tier, created_at: org.created_at },
  })

  return org
}

export async function updateOrganization(id: string, data: any, audit?: AuditInfo) {
  await getOrganizationById(id)
  const { queue_ids, ...rest } = data

  if (rest.expires_at) {
    rest.expires_at = new Date(rest.expires_at)
  } else if (rest.expires_at === '') {
    rest.expires_at = null
  }

  const org = await prisma.organization.update({
    where: { id },
    data: {
      ...rest,
      queues: queue_ids ? { set: queue_ids.map((id: string) => ({ id })) } : undefined
    },
    include: { queues: true, queue_access: { include: { queue: true } }, sla_config: true }
  })

  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'UPDATE_ORG',
      resource: 'ORG',
      details: { orgId: id, changes: rest },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }

  return org
}

export async function deleteOrganization(id: string, audit?: AuditInfo) {
  const org = await getOrganizationById(id)
  const result = await prisma.organization.update({
    where: { id },
    data: { deleted_at: new Date(), active: false },
  })

  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'DELETE_ORG',
      resource: 'ORG',
      details: { orgId: id, name: org.name },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }

  return result
}
