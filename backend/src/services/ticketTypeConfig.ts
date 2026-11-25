import { TicketType } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'

export async function listTicketTypeConfigs() {
  return prisma.ticketTypeConfig.findMany({ orderBy: { type: 'asc' } })
}

export async function setTicketTypeEnabled(type: string, enabled: boolean) {
  if (!Object.values<string>(TicketType).includes(type)) throw new AppError(404, 'Tipo de chamado não encontrado', 'NOT_FOUND')
  if (type === 'incident' && !enabled) {
    throw new AppError(400, 'O tipo Incidente não pode ser desabilitado', 'INCIDENT_ALWAYS_ENABLED')
  }
  return prisma.ticketTypeConfig.update({
    where: { type: type as any },
    data: { enabled },
  })
}
