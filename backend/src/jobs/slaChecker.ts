import cron from 'node-cron'
import prisma from '../config/prisma'
import { logger } from '../utils/logger'
import { SYSTEM_USER_ID } from '../utils/constants'
import { createAuditLog } from '../services/audit'
import { TicketService } from '../services/tickets'
import { emitWebhookEvent, buildTicketPayload } from '../services/webhookEvents'
import { getBusinessHoursConfig } from '../services/businessHours'
import { addBusinessHours, holidaysAround, type BusinessHoursLike } from '../utils/businessHours'

export function getEscalationMinutes(slaConfig: { escalation_minutes?: number | null } | null | undefined): number {
  return slaConfig?.escalation_minutes ?? 30
}

// Limiar em minutos ÚTEIS: sexta 17:45 com prazo segunda 08:10 faltam 25min
// de SLA, não 62h — o relógio do SLA não anda fora do horário comercial.
export function isPastEscalationThreshold(
  slaDeadline: Date | null | undefined,
  escalationMinutes: number,
  now: Date,
  bh: BusinessHoursLike,
  holidays: string[],
): boolean {
  if (!slaDeadline) return false
  return slaDeadline.getTime() <= addBusinessHours(now, escalationMinutes / 60, bh, holidays).getTime()
}

// Roda a cada minuto — verifica tickets próximos do vencimento de SLA e
// escalona automaticamente para a fila de escalação configurada. O limiar
// (minutos antes do vencimento) é o `escalation_minutes` do plano/SLA da
// organização (SLAPanel), com 30min como default quando não configurado.
export function startSlaJob() {
  cron.schedule('* * * * *', async () => {
    try {
      // Busca numa janela ampla (24h úteis) e filtra o limiar exato por
      // ticket depois, já que cada org pode ter um escalation_minutes diferente.
      const now = new Date()
      const bh = await getBusinessHoursConfig()
      const holidays = holidaysAround(now)
      const wideWindow = addBusinessHours(now, 24, bh, holidays)

      const ticketsAtRisk = await prisma.ticket.findMany({
        where: {
          // Tickets em 'pending' (aguardando cliente) têm SLA pausado e não
          // devem ser escalonados — por isso não constam neste filtro.
          status: { in: ['open', 'in_progress'] },
          escalated: false,
          sla_deadline: { lte: wideWindow },
          deleted_at: null,
        },
        include: {
          org: { include: { sla_config: true } },
          assigned_to: true,
        },
      })

      for (const ticket of ticketsAtRisk) {
        const escalationMinutes = getEscalationMinutes((ticket.org as any)?.sla_config)
        if (!isPastEscalationThreshold(ticket.sla_deadline, escalationMinutes, now, bh, holidays)) continue

        // Só usa a fila de escalação configurada se ela existir de fato
        // no catálogo de filas; senão o chamado fica sem fila (visível a todos)
        // em vez de cair numa fila fantasma que nenhum analista tem no escopo.
        const configuredQueue = (ticket.org as any)?.sla_config?.escalation_queue ?? null
        const escalationQueue = configuredQueue && await prisma.queue.findUnique({ where: { id: configuredQueue } })
          ? configuredQueue
          : null

        await prisma.$transaction([
          // Mover para fila de escalação e marcar como escalado
          prisma.ticket.update({
            where: { id: ticket.id },
            data: {
              queue: escalationQueue,
              escalated: true,
              priority: 'high',
              updated_at: new Date(),
            },
          }),
          // Registrar evento de auditoria
          prisma.ticketEvent.create({
            data: {
              ticket_id: ticket.id,
              user_id: SYSTEM_USER_ID,
              from_status: ticket.status,
              to_status: ticket.status,
              note: `Escalonamento automático: SLA vence em menos de ${escalationMinutes} minutos.${escalationQueue ? ` Fila alterada para ${escalationQueue}.` : ''}`,
            },
          }),
        ])

        // Broadcast real-time ticket update
        TicketService.broadcastTicketUpdate(ticket.id, 'ticket:updated', ticket.queue)

        // Webhooks de saída (fora da transação): SLA em risco + escalonamento
        const webhookTicket = buildTicketPayload({ ...ticket, queue: escalationQueue, escalated: true, priority: 'high' })
        emitWebhookEvent('sla.warning', {
          ticket: webhookTicket,
          sla_deadline: ticket.sla_deadline,
          escalation_minutes: escalationMinutes,
        })
        emitWebhookEvent('ticket.escalated', {
          ticket: webhookTicket,
          trigger: 'sla_auto',
          previous_queue: ticket.queue,
          escalation_queue: escalationQueue,
        })

        // Adicionar Log de Auditoria Centralizado
        await createAuditLog({
          userId: SYSTEM_USER_ID,
          action: 'ESCALATE_TICKET',
          resource: 'TICKET',
          details: { 
            ticketId: ticket.id, 
            reason: 'SLA_RISK',
            queue: escalationQueue 
          }
        })

        logger.info(`[SLA Job] Ticket ${ticket.id} escalonado para fila ${escalationQueue}`)

        // TODO: enviar e-mail de notificação para supervisores
      }
    } catch (err) {
      logger.error('[SLA Job] Erro ao verificar SLAs:', { err })
    }
  })

  logger.info('[ISA] Job de verificação de SLA iniciado (intervalo: 1 minuto)')

  // Limpeza de refresh tokens expirados — roda todo dia à meia-noite.
  cron.schedule('0 0 * * *', async () => {
    try {
      const { count } = await prisma.refreshToken.deleteMany({
        where: { expires_at: { lt: new Date() } },
      })
      if (count > 0) logger.info(`[Cleanup] ${count} refresh token(s) expirado(s) removido(s)`)
    } catch (err) {
      logger.error('[Cleanup] Erro ao remover refresh tokens expirados:', { err })
    }
  })
}
