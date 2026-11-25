import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { addBusinessHours, holidaysAround } from '../utils/businessHours'
import { getBusinessHoursConfig } from './businessHours'

const TYPE_PREFIX: Record<string, string> = { incident: 'INC', request: 'REQ', problem: 'PRB', change: 'CHG' }

// Troca de tipo de chamado: regrava o prefixo do display_number
// mantendo o número sequencial e recalcula os prazos de SLA com as horas do
// tipo no plano, contadas DESDE A ABERTURA (reclassificar não dá prazo extra).
// O tempo útil já pausado (pendente) estende a resolução, como no fim da pausa.
// Compartilhado entre TicketService.updateTicket (troca manual), as regras de
// automação e a triagem IA para nunca divergir a validação/cálculo.
// Reaberto que troca de tipo também conta da abertura original (prazo
// já vencido); usar a data da reabertura se o negócio pedir.
export async function computeTicketTypeChange(
  ticket: { type: string; display_number: string; org_id: string | null; created_at: Date; total_paused_minutes?: number | null },
  targetType: string,
) {
  const typeConfig = await prisma.ticketTypeConfig.findUnique({ where: { type: targetType as any } })
  if (typeConfig && !typeConfig.enabled) {
    throw new AppError(400, 'Este tipo de chamado está desabilitado', 'TICKET_TYPE_DISABLED')
  }

  // Só o número final: dígitos de um prefixo nunca entram no número.
  const numericPart = ticket.display_number.match(/(\d+)$/)?.[1] ?? ''
  const slaConfig = ticket.org_id
    ? (await prisma.organization.findUnique({ where: { id: ticket.org_id }, include: { sla_config: true } }))?.sla_config
    : null
  const firstResponseHours = (slaConfig as any)?.[`${targetType}_first_response_hours`] ?? 4
  const resolutionHours = (slaConfig as any)?.[`${targetType}_resolution_hours`] ?? 24
  const bh = await getBusinessHoursConfig()
  const start = ticket.created_at
  const holidays = holidaysAround(start)
  const pausedHours = (ticket.total_paused_minutes ?? 0) / 60

  return {
    type: targetType,
    display_number: `${TYPE_PREFIX[targetType]}-${numericPart}`,
    sla_deadline: addBusinessHours(start, resolutionHours + pausedHours, bh, holidays),
    first_response_deadline: addBusinessHours(start, firstResponseHours, bh, holidays),
  }
}
