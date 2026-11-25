import prisma from '../config/prisma'
import { AutoCloseConfig } from '@prisma/client'
import { TicketService } from './tickets'
import { getEffectiveScope } from './scope'
import { ticketVisibilityWhere } from './ticketAccess'
import { logger } from '../utils/logger'

// ── Config ─────────────────────────────────────────────────────────────────────

export async function getAutoCloseConfig(): Promise<AutoCloseConfig> {
  return (await prisma.autoCloseConfig.findFirst()) ?? prisma.autoCloseConfig.create({ data: {} })
}

export async function upsertAutoCloseConfig(data: Partial<Pick<AutoCloseConfig, 'enabled' | 'inactive_days'>>) {
  const existing = await getAutoCloseConfig()
  return prisma.autoCloseConfig.update({ where: { id: existing.id }, data })
}

// ── Job ────────────────────────────────────────────────────────────────────────

// Resolvido sem atualização há N dias e sem mensagem do cliente no período → Fechado.
export async function runAutoCloseJob(): Promise<{ checked: number; closed: number }> {
  const config = await getAutoCloseConfig()
  if (!config.enabled) {
    logger.info('[AutoClose] Desabilitado — pulando execução.')
    return { checked: 0, closed: 0 }
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - config.inactive_days)

  const tickets = await prisma.ticket.findMany({
    where: { status: 'resolved', deleted_at: null, updated_at: { lt: cutoffDate } },
    select: { id: true, resolved_at: true },
  })

  let closed = 0
  for (const ticket of tickets) {
    try {
      const clientMessage = await prisma.ticketMessage.findFirst({
        where: { ticket_id: ticket.id, type: 'user', created_at: { gte: cutoffDate } },
        select: { id: true },
      })
      if (clientMessage) continue

      await TicketService.updateTicket(ticket.id, 'system', 'system', {
        status: 'closed',
        note: `Fechamento automático por inatividade do cliente (${config.inactive_days} dias).`,
      })
      await prisma.autoCloseLog.create({
        data: { ticket_id: ticket.id, resolved_at: ticket.resolved_at, inactive_days: config.inactive_days },
      })
      closed++
    } catch (err) {
      logger.error(`[AutoClose] Erro ao auto-fechar chamado ${ticket.id}:`, { err })
    }
  }

  logger.info(`[AutoClose] ${closed} de ${tickets.length} chamado(s) resolvido(s) fechado(s).`)
  return { checked: tickets.length, closed }
}

// ── Logs ───────────────────────────────────────────────────────────────────────

export async function getAutoCloseLogs(params: { page: number; limit: number; ticketId?: string; startDate?: string; endDate?: string }, viewer?: { sub: string; role: string }) {
  const { page, limit, ticketId, startDate, endDate } = params
  const where: any = {}
  if (viewer) where.ticket = ticketVisibilityWhere(viewer.sub, await getEffectiveScope(viewer.sub, viewer.role))
  if (ticketId) where.ticket_id = { contains: ticketId, mode: 'insensitive' }
  if (startDate || endDate) {
    where.created_at = {}
    if (startDate) where.created_at.gte = new Date(startDate)
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      where.created_at.lte = end
    }
  }

  const [items, total] = await Promise.all([
    prisma.autoCloseLog.findMany({
      where,
      include: {
        ticket: {
          select: {
            id: true, title: true, status: true,
            org: { select: { name: true } },
            assigned_to: { select: { name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.autoCloseLog.count({ where }),
  ])

  return { items, total, pages: Math.ceil(total / limit), currentPage: page }
}
