import prisma from '../config/prisma'
import { createAuditLog } from './audit'
import { AuditInfo } from '../utils/audit'
import { AppError } from '../middlewares/errorHandler'

const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/

// Mesma normalização usada em frontend/src/utils/domainValidation.ts —
// duplicada aqui porque o backend nunca deve confiar apenas na validação
// client-side desta regra de segurança (ver spec, seção "Segurança").
function normalizeDomain(value: string): string {
  let d = String(value ?? '').trim().toLowerCase()
  if (d.includes('@')) d = d.split('@').pop() || ''
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/[/?#].*$/, '')
  d = d.replace(/^[./\\]+|[./\\]+$/g, '')
  return d.trim()
}

function assertValidDomain(domain: string): string {
  const normalized = normalizeDomain(domain)
  if (!normalized || !DOMAIN_REGEX.test(normalized)) {
    throw new AppError(400, `Domínio de e-mail inválido: "${domain}"`, 'INVALID_DOMAIN')
  }
  return normalized
}

export class AuthorizedDomainService {
  /** Mesmo critério do auto-provisionamento SSO (authSso.ts): domínio ativo + organização ativa. */
  static async isSsoEmail(email: string): Promise<boolean> {
    const domain = normalizeDomain(email)
    if (!domain) return false
    const found = await prisma.authorizedDomain.findFirst({
      where: { domain, active: true, org: { active: true, deleted_at: null } },
      select: { id: true },
    })
    return !!found
  }

  static async listByOrg(orgId: string) {
    return prisma.authorizedDomain.findMany({
      where: { org_id: orgId },
      orderBy: { created_at: 'asc' },
    })
  }

  static async create(orgId: string, domain: string, audit?: AuditInfo) {
    const normalized = assertValidDomain(domain)

    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) {
      throw new AppError(404, 'Organização não encontrada', 'NOT_FOUND')
    }

    const existing = await prisma.authorizedDomain.findUnique({ where: { domain: normalized } })
    if (existing) {
      throw new AppError(409, `O domínio "${normalized}" já está cadastrado`, 'DOMAIN_ALREADY_REGISTERED')
    }

    // Domínio autorizado é sempre domínio da empresa: grava nos dois lugares
    // para o campo "Domínios de e-mail" da organização já mostrá-lo.
    const orgDomains = org.domains.includes(normalized) ? org.domains : [...org.domains, normalized]
    const [created] = await prisma.$transaction([
      prisma.authorizedDomain.create({ data: { domain: normalized, org_id: orgId } }),
      prisma.organization.update({ where: { id: orgId }, data: { domains: orgDomains } }),
    ])

    if (audit?.actorId) {
      createAuditLog({
        userId: audit.actorId,
        action: 'CREATE_AUTHORIZED_DOMAIN',
        resource: 'AUTHORIZED_DOMAIN',
        details: { domainId: created.id, domain: created.domain, orgId },
        ip: audit.ip,
        userAgent: audit.userAgent,
      })
    }

    return created
  }

  /** orgId é sempre exigido para impedir que alguém altere um domínio de outra organização só adivinhando o id (IDOR). */
  static async setActive(orgId: string, id: string, active: boolean, audit?: AuditInfo) {
    const existing = await prisma.authorizedDomain.findUnique({ where: { id } })
    if (!existing || existing.org_id !== orgId) {
      throw new AppError(404, 'Domínio autorizado não encontrado', 'NOT_FOUND')
    }

    const updated = await prisma.authorizedDomain.update({
      where: { id },
      data: { active },
    })

    if (audit?.actorId) {
      createAuditLog({
        userId: audit.actorId,
        action: 'UPDATE_AUTHORIZED_DOMAIN',
        resource: 'AUTHORIZED_DOMAIN',
        details: { domainId: id, domain: updated.domain, active },
        ip: audit.ip,
        userAgent: audit.userAgent,
      })
    }

    return updated
  }

  /** orgId é sempre exigido pelo mesmo motivo de setActive (evitar IDOR entre organizações). */
  static async delete(orgId: string, id: string, audit?: AuditInfo) {
    const existing = await prisma.authorizedDomain.findUnique({ where: { id } })
    if (!existing || existing.org_id !== orgId) {
      throw new AppError(404, 'Domínio autorizado não encontrado', 'NOT_FOUND')
    }

    const deleted = await prisma.authorizedDomain.delete({ where: { id } })

    if (audit?.actorId) {
      createAuditLog({
        userId: audit.actorId,
        action: 'DELETE_AUTHORIZED_DOMAIN',
        resource: 'AUTHORIZED_DOMAIN',
        details: { domainId: id, domain: deleted.domain },
        ip: audit.ip,
        userAgent: audit.userAgent,
      })
    }

    return deleted
  }
}
