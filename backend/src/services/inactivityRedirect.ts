import prisma from '../config/prisma'
import { getEffectiveModules } from './moduleAccess'
import { logger } from '../utils/logger'
import { SYSTEM_USER_ID } from '../utils/constants'
import { createAuditLog } from './audit'
import { TicketService } from './tickets'
import { getEffectiveScope } from './scope'
import { getTicketAccess, ticketVisibilityWhere } from './ticketAccess'
import { NotificationService } from './notifications'
import { emitWebhookEvent, buildTicketPayload } from './webhookEvents'
import { InactivityRedirectConfig, TicketPriority } from '@prisma/client'

// ── Business hours helpers ────────────────────────────────────────────────────

function getLocalParts(date: Date, timezone: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value ?? 'Mon'
  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '0'
  const minuteStr = parts.find(p => p.type === 'minute')?.value ?? '0'

  return {
    weekday: weekdayMap[weekdayStr] ?? 1,
    hour: parseInt(hourStr, 10),
    minute: parseInt(minuteStr, 10),
  }
}

export function businessHoursElapsed(from: Date, to: Date, config: InactivityRedirectConfig): number {
  const [startH] = config.business_hours_start.split(':').map(Number)
  const [endH] = config.business_hours_end.split(':').map(Number)

  let businessMinutes = 0
  const stepMs = 15 * 60 * 1000 // 15-minute steps
  let cursor = new Date(from.getTime())

  while (cursor < to) {
    const { weekday, hour } = getLocalParts(cursor, config.timezone)
    if (config.working_days.includes(weekday) && hour >= startH && hour < endH) {
      businessMinutes += 15
    }
    cursor = new Date(cursor.getTime() + stepMs)
  }

  return businessMinutes / 60
}

export function isWithinBusinessHours(config: InactivityRedirectConfig): boolean {
  const now = new Date()
  const { weekday, hour, minute } = getLocalParts(now, config.timezone)
  const [startH, startM] = config.business_hours_start.split(':').map(Number)
  const [endH, endM] = config.business_hours_end.split(':').map(Number)

  if (!config.working_days.includes(weekday)) return false

  const currentMin = hour * 60 + minute
  const startMin = startH * 60 + startM
  const endMin = endH * 60 + endM

  return currentMin >= startMin && currentMin < endMin
}

// ── Config ─────────────────────────────────────────────────────────────────────

export async function getInactivityConfig(): Promise<InactivityRedirectConfig> {
  let config = await prisma.inactivityRedirectConfig.findFirst()
  if (!config) {
    config = await prisma.inactivityRedirectConfig.create({ data: {} })
  }
  return config
}

export async function upsertInactivityConfig(data: Partial<Omit<InactivityRedirectConfig, 'id' | 'created_at' | 'updated_at'>>) {
  const existing = await prisma.inactivityRedirectConfig.findFirst()
  if (existing) {
    return prisma.inactivityRedirectConfig.update({ where: { id: existing.id }, data })
  }
  return prisma.inactivityRedirectConfig.create({ data: data as any })
}

// ── Elegibilidade ─────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<TicketPriority, number> = { low: 0, medium: 1, high: 2 }

/** Só sobe: um chamado já acima da prioridade alvo não é rebaixado. */
export function raisedPriority(current: TicketPriority, target: TicketPriority): TicketPriority {
  return PRIORITY_RANK[target] > PRIORITY_RANK[current] ? target : current
}

/** Alguém da equipe (não o solicitante, não o sistema/IA/automação). */
const STAFF = { id: { not: SYSTEM_USER_ID }, role: { not: 'user' as const } }

/**
 * Chamado que ninguém da equipe tocou: aberto, sem analista, sem mensagem ou
 * nota de analista e sem evento de equipe além da abertura (abrir em nome do
 * cliente não conta como atuação). Pendentes nunca entram — estão esperando
 * alguém de fora, não parados.
 */
export const untouchedTicketWhere = {
  status: 'open' as const,
  deleted_at: null,
  assigned_to_id: null,
  messages: { none: { type: { in: ['agent' as const, 'internal' as const] }, user: STAFF } },
  events: { none: { from_status: { not: null }, user: STAFF } },
}

// ── Redirect logic ────────────────────────────────────────────────────────────

export async function runInactivityRedirectJob(options?: { force?: boolean }): Promise<{ checked: number; redirected: number; skipped: number }> {
  const config = await getInactivityConfig()

  if (!config.enabled) {
    logger.info('[InactivityRedirect] Desabilitado — pulando execução.')
    return { checked: 0, redirected: 0, skipped: 0 }
  }

  if (!options?.force && !isWithinBusinessHours(config)) {
    logger.info('[InactivityRedirect] Fora do horário comercial — pulando execução.')
    return { checked: 0, redirected: 0, skipped: 0 }
  }

  const activeTickets = await prisma.ticket.findMany({
    where: untouchedTicketWhere,
    include: {
      assigned_to: { select: { id: true, name: true, manager_id: true } },
      org: { select: { id: true, name: true } },
    },
  })

  logger.info(`[InactivityRedirect] Verificando ${activeTickets.length} chamado(s) sem analista e sem atendimento...`)

  let redirectedCount = 0
  let skippedCount = 0

  for (const ticket of activeTickets) {
    try {
      // Ninguém da equipe atuou, então está parado desde a abertura — o
      // solicitante cobrando não pode adiar a atribuição.
      const elapsed = businessHoursElapsed(ticket.created_at, new Date(), config)

      if (elapsed < config.inactivity_hours) { skippedCount++; continue }

      if (!ticket.queue) { skippedCount++; continue }

      // Buscar analistas elegíveis na fila original
      const inQueue = await prisma.user.findMany({
        where: {
          role: 'agent',
          active: true,
          deleted_at: null,
          queues: { has: ticket.queue },
          id: { not: SYSTEM_USER_ID },
        },
        select: { id: true, name: true, manager_id: true },
      })
      // Quem está com Chamados desligado não recebe chamado (não conseguiria vê-lo). Fila é
      // compartilhada entre empresas: precisa atender a empresa do chamado, se ele tiver uma.
      const canReceive = await Promise.all(inQueue.map(async a =>
        (await getEffectiveModules(a.id, 'agent')).tickets
        && (!ticket.org_id || (await getTicketAccess({ ...ticket, assigned_to_id: null }, { sub: a.id, role: 'agent' })).allowed)))
      const eligibleAgents = inQueue.filter((_, i) => canReceive[i])

      if (eligibleAgents.length === 0) {
        logger.warn(`[InactivityRedirect] Nenhum analista elegível para fila "${ticket.queue}" no chamado ${ticket.id}`)
        await notifyManagerNoAgents(ticket, config)
        continue
      }

      // Seleção aleatória
      const newAgent = eligibleAgents[Math.floor(Math.random() * eligibleAgents.length)]
      const prevPriority = ticket.priority
      const newPriority = raisedPriority(prevPriority, config.target_priority)

      const newQueue = config.vip_queue_id ?? ticket.queue

      try {
        await prisma.$transaction([
          prisma.ticket.update({
            // Só se continua sem analista (outro processo/pessoa pode ter assumido no meio).
            where: { id: ticket.id, assigned_to_id: null },
            data: {
              assigned_to_id: newAgent.id,
              priority: newPriority,
              queue: newQueue,
              auto_redirected: true,
              redirected_at: new Date(),
            },
          }),
          prisma.ticketEvent.create({
            data: {
              ticket_id: ticket.id,
              user_id: SYSTEM_USER_ID,
              from_status: ticket.status,
              to_status: ticket.status,
              note: `Atribuição automática: ${Math.floor(elapsed)}h úteis sem atendimento. Analista: ${newAgent.name}. Prioridade: ${prevPriority} → ${newPriority}.`,
            },
          }),
          prisma.inactivityRedirectLog.create({
            data: {
              ticket_id: ticket.id,
              original_queue: ticket.queue ?? '',
              previous_assigned_to_id: ticket.assigned_to_id ?? null,
              new_assigned_to_id: newAgent.id,
              previous_priority: prevPriority,
              new_priority: newPriority,
            },
          }),
        ])
      } catch (err: any) {
        if (err.code === 'P2025') {
          logger.info(`[InactivityRedirect] Chamado ${ticket.id} já foi atualizado ou redirecionado por outro processo. Pulando.`)
          skippedCount++
          continue
        }
        throw err
      }

      TicketService.broadcastTicketUpdate(ticket.id, 'ticket:updated', ticket.queue)

      const inactivityPayload = {
        ticket: buildTicketPayload({ ...ticket, assigned_to_id: newAgent.id, priority: newPriority, queue: newQueue }),
        reason: 'inactivity_redirect',
        inactive_hours: Math.floor(elapsed),
        previous_assigned_to_id: ticket.assigned_to_id ?? null,
        assigned_to_id: newAgent.id,
        manager_id: newAgent.manager_id ?? null,
        previous_manager_id: ticket.assigned_to?.manager_id ?? null,
      }

      emitWebhookEvent('ticket.updated', inactivityPayload)
      emitWebhookEvent('ticket.inactive', inactivityPayload)

      await createAuditLog({
        userId: SYSTEM_USER_ID,
        action: 'INACTIVITY_REDIRECT',
        resource: 'TICKET',
        details: {
          ticketId: ticket.id,
          inactiveHours: Math.floor(elapsed),
          previousAgentId: ticket.assigned_to_id,
          newAgentId: newAgent.id,
          previousPriority: prevPriority,
          newPriority,
          originalQueue: ticket.queue,
          newQueue,
        },
      })

      // Notificar o novo analista
      await NotificationService.create({
        userId: newAgent.id,
        ticketId: ticket.id,
        type: 'ticket_redirected',
        title: 'Chamado atribuído por inatividade',
        body: `O chamado ${ticket.id} estava sem atuação há ${Math.floor(elapsed)}h e foi atribuído automaticamente a você.`,
        senderName: 'Sistema',
      })

      // Notificar o gestor (se existir)
      const managerId = newAgent.manager_id ?? ticket.assigned_to?.manager_id
      if (managerId) {
        await NotificationService.create({
          userId: managerId,
          ticketId: ticket.id,
          type: 'ticket_redirected',
          title: 'Redirecionamento automático de chamado',
          body: `Chamado ${ticket.id} redirecionado por ${Math.floor(elapsed)}h de inatividade → ${newAgent.name}. Prioridade: ${newPriority.toUpperCase()}.`,
          senderName: 'Sistema',
        })
      }

      logger.info(`[InactivityRedirect] Chamado ${ticket.id} redirecionado para ${newAgent.name} após ${Math.floor(elapsed)}h de inatividade.`)
      redirectedCount++
    } catch (err) {
      logger.error(`[InactivityRedirect] Erro ao processar chamado ${ticket.id}:`, { err })
    }
  }

  logger.info(`[InactivityRedirect] Execução concluída. ${redirectedCount} redirecionado(s), ${skippedCount} dentro do prazo.`)
  return { checked: activeTickets.length, redirected: redirectedCount, skipped: skippedCount }
}

async function notifyManagerNoAgents(ticket: any, _config: InactivityRedirectConfig) {
  await createAuditLog({
    userId: SYSTEM_USER_ID,
    action: 'INACTIVITY_REDIRECT_NO_AGENT',
    resource: 'TICKET',
    details: { ticketId: ticket.id, queue: ticket.queue, reason: 'no_eligible_agents' },
  })
}

// ── Logs query ────────────────────────────────────────────────────────────────

export async function getRedirectLogs(params: {
  page?: number
  limit?: number
  ticketId?: string
  agentId?: string
  startDate?: string
  endDate?: string
}, viewer?: { sub: string; role: string }) {
  const { page = 1, limit = 50, ticketId, agentId, startDate, endDate } = params
  const skip = (page - 1) * limit

  const where: any = {}
  if (ticketId) where.ticket_id = ticketId
  if (agentId) where.new_assigned_to_id = agentId
  if (viewer) where.ticket = ticketVisibilityWhere(viewer.sub, await getEffectiveScope(viewer.sub, viewer.role))
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
    prisma.inactivityRedirectLog.findMany({
      where,
      include: {
        ticket: { select: { id: true, title: true, status: true } },
        previous_assigned_to: { select: { id: true, name: true } },
        new_assigned_to: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.inactivityRedirectLog.count({ where }),
  ])

  return { items, total, pages: Math.ceil(total / limit), currentPage: page }
}
