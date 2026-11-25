import prisma from '../config/prisma'
import { logger } from '../utils/logger'
import { TicketService } from './tickets'
import { NotificationService } from './notifications'

// Chamados em "Pendente Agendamento" cujo horário combinado já
// chegou voltam automaticamente para "Em atendimento".
export async function runPendingScheduleReopenJob(): Promise<{ checked: number; reopened: number }> {
  const dueTickets = await prisma.ticket.findMany({
    where: {
      status: 'pending',
      pending_reason: 'pending_schedule',
      pending_schedule_at: { lte: new Date() },
      deleted_at: null,
    },
    select: { id: true, assigned_to_id: true },
  })

  let reopenedCount = 0
  for (const ticket of dueTickets) {
    try {
      await TicketService.updateTicket(ticket.id, 'system', 'system', {
        status: 'in_progress',
        note: 'Reaberto automaticamente: horário agendado atingido.',
      })

      if (ticket.assigned_to_id) {
        await NotificationService.create({
          userId: ticket.assigned_to_id,
          ticketId: ticket.id,
          type: 'ticket_schedule_reopened',
          title: 'Chamado reaberto por agendamento',
          body: 'O horário combinado chegou e o chamado voltou para "Em atendimento".',
          senderName: 'Sistema',
        })
      }

      logger.info(`[PendingScheduleReopen] Chamado ${ticket.id} reaberto (agendamento atingido).`)
      reopenedCount++
    } catch (err) {
      logger.error(`[PendingScheduleReopen] Erro ao reabrir chamado ${ticket.id}:`, { err })
    }
  }

  return { checked: dueTickets.length, reopened: reopenedCount }
}
