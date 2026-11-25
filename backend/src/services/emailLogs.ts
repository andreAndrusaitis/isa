import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { multi } from '../utils/multiFilter'
import { env } from '../config/env'
import { certificateInfo, getInboxSummary, isGraphConfigured } from './email/graph'

export interface EmailLogQuery {
  page?: number
  limit?: number
  kind?: string
  status?: string
  ticketId?: string
  search?: string
  startDate?: string
  endDate?: string
}

function buildWhere(q: EmailLogQuery): Prisma.EmailLogWhereInput {
  const where: Prisma.EmailLogWhereInput = { kind: multi(q.kind), status: multi(q.status) }
  if (q.ticketId) where.ticket_id = q.ticketId
  if (q.startDate || q.endDate) {
    const end = q.endDate ? new Date(q.endDate) : undefined
    end?.setHours(23, 59, 59, 999)
    where.created_at = { gte: q.startDate ? new Date(q.startDate) : undefined, lte: end }
  }
  if (q.search) {
    where.OR = [
      { recipient: { contains: q.search, mode: 'insensitive' } },
      { subject: { contains: q.search, mode: 'insensitive' } },
      { ticket: { display_number: { contains: q.search, mode: 'insensitive' } } },
      { ticket: { title: { contains: q.search, mode: 'insensitive' } } },
    ]
  }
  return where
}

const pageOf = (q: EmailLogQuery) => {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 1000)
  return { take: limit, skip: (Math.max(q.page ?? 1, 1) - 1) * limit }
}

const TICKET_FIELDS = { id: true, display_number: true, title: true } as const
const LIST_FIELDS = { id: true, kind: true, recipient: true, subject: true, status: true, error: true, ticket_id: true, created_at: true, provider: true, replyable: true } as const

/** Um envio por linha, mais recente primeiro. */
export async function listEmailLogs(q: EmailLogQuery) {
  const where = buildWhere(q)
  const [items, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      ...pageOf(q),
      select: { ...LIST_FIELDS, ticket: { select: TICKET_FIELDS } },
    }),
    prisma.emailLog.count({ where }),
  ])
  return { items, total }
}

/** Um envio com o corpo do e-mail (a lista não traz o HTML). */
export function getEmailLog(id: string) {
  return prisma.emailLog.findUnique({ where: { id }, include: { ticket: { select: TICKET_FIELDS } } })
}

/** Um chamado por linha: total de envios, falhas, tipos e último envio. E-mails sem chamado (boas-vindas) ficam de fora. */
export async function listEmailLogsByTicket(q: EmailLogQuery) {
  const where: Prisma.EmailLogWhereInput = { AND: [buildWhere(q), { ticket_id: { not: null } }] }
  // Total = groupBy completo só para contar grupos; trocar por COUNT(DISTINCT) em SQL se a tabela crescer muito
  const [groups, all] = await Promise.all([
    prisma.emailLog.groupBy({
      by: ['ticket_id'],
      where,
      _count: { _all: true },
      _max: { created_at: true },
      orderBy: { _max: { created_at: 'desc' } },
      ...pageOf(q),
    }),
    prisma.emailLog.groupBy({ by: ['ticket_id'], where }),
  ])
  const ids = groups.map(g => g.ticket_id!)
  const [tickets, breakdown] = await Promise.all([
    prisma.ticket.findMany({ where: { id: { in: ids } }, select: { id: true, display_number: true, title: true } }),
    prisma.emailLog.groupBy({
      by: ['ticket_id', 'kind', 'status'],
      where: { AND: [where, { ticket_id: { in: ids } }] },
      _count: { _all: true },
    }),
  ])
  const items = groups.map(g => {
    const rows = breakdown.filter(b => b.ticket_id === g.ticket_id)
    const kinds: Record<string, number> = {}
    for (const r of rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + r._count._all
    return {
      ticket: tickets.find(t => t.id === g.ticket_id) ?? null,
      ticket_id: g.ticket_id,
      total: g._count._all,
      failed: rows.filter(r => r.status === 'FAILED').reduce((n, r) => n + r._count._all, 0),
      kinds,
      last_sent_at: g._max.created_at,
    }
  })
  return { items, total: all.length }
}

// ── Recebidos (caixa de atendimento) ──────────────────────────────────────────

export interface InboundEmailQuery {
  page?: number
  limit?: number
  status?: string
  search?: string
  startDate?: string
  endDate?: string
}

/** Um e-mail recebido por linha, mais recente primeiro, com o desfecho e o chamado. */
export async function listInboundEmails(q: InboundEmailQuery) {
  const where: Prisma.InboundEmailWhereInput = { status: multi(q.status) }
  if (q.startDate || q.endDate) {
    const end = q.endDate ? new Date(q.endDate) : undefined
    end?.setHours(23, 59, 59, 999)
    where.received_at = { gte: q.startDate ? new Date(q.startDate) : undefined, lte: end }
  }
  if (q.search) {
    where.OR = [
      { from_email: { contains: q.search, mode: 'insensitive' } },
      { from_name: { contains: q.search, mode: 'insensitive' } },
      { subject: { contains: q.search, mode: 'insensitive' } },
      { ticket: { display_number: { contains: q.search, mode: 'insensitive' } } },
    ]
  }
  const [items, total] = await Promise.all([
    prisma.inboundEmail.findMany({
      where,
      orderBy: { received_at: 'desc' },
      ...pageOf(q),
      select: {
        id: true, from_email: true, from_name: true, subject: true, received_at: true, status: true,
        detail: true, attempts: true, processed_at: true, ticket: { select: TICKET_FIELDS },
      },
    }),
    prisma.inboundEmail.count({ where }),
  ])
  return { items, total }
}

// ── Configuração (só leitura; nenhum segredo sai daqui) ───────────────────────

export async function getEmailSettings() {
  const graph = isGraphConfigured()
  const acs = Boolean(env.AZURE_COMMUNICATION_CONNECTION_STRING)
  const since = env.MAIL_INBOUND_SINCE ? new Date(env.MAIL_INBOUND_SINCE).toISOString() : null
  const [orgs, last24h] = await Promise.all([
    prisma.organization.findMany({
      where: { email_reply_enabled: true, deleted_at: null },
      select: { id: true, name: true, active: true },
      orderBy: { name: 'asc' },
    }),
    prisma.emailLog.groupBy({
      by: ['status'],
      where: { created_at: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      _count: { _all: true },
    }),
  ])
  return {
    provider: graph ? 'graph' : acs ? 'acs' : 'none',
    mailbox: env.MAIL_GRAPH_MAILBOX ?? null,
    graph: {
      configured: graph,
      tenantId: env.MAIL_GRAPH_TENANT_ID ?? null,
      clientId: env.MAIL_GRAPH_CLIENT_ID ?? null,
      certificate: certificateInfo(),
    },
    acs: { configured: acs, sender: acs ? env.AZURE_EMAIL_SENDER : null },
    inbound: {
      enabled: Boolean(env.MAIL_INBOUND_ENABLED),
      since,
      // O job só liga com as três: flag, Graph e data de corte (ver jobs/inboundMail.ts).
      running: Boolean(env.MAIL_INBOUND_ENABLED && graph && since && env.NODE_ENV !== 'test'),
      categoryConfigured: Boolean(env.MAIL_INBOUND_CATEGORY_ID),
    },
    replyEnabledOrgs: orgs,
    last24h: Object.fromEntries(last24h.map(g => [g.status, g._count._all])),
  }
}

/** Consulta só de leitura na caixa (metadados da Caixa de Entrada). */
export async function testEmailConnection() {
  if (!isGraphConfigured()) return { ok: false, error: 'Caixa de atendimento não configurada (variáveis MAIL_GRAPH_*).' }
  const started = Date.now()
  try {
    const inbox = await getInboxSummary()
    return { ok: true, ms: Date.now() - started, inbox: { total: inbox.totalItemCount, unread: inbox.unreadItemCount } }
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) }
  }
}
