import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getAuditInfo } from '../utils/audit'
import prisma from '../config/prisma'
import * as TrashService from '../services/trash'
import { TICKET_ACCESS_SELECT } from '../services/ticketAccess'
import { assertTicketAccess, listVisibility } from './tickets'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  orgId: z.string().trim().optional(),
})

const configSchema = z.object({
  enabled: z.boolean().optional(),
  retention_days: z.number().int().min(1).max(3650).optional(),
})

// Restaurar e expurgar seguem a regra de ver e agir. Chamado inexistente fica com
// o 404 do serviço; o job de retenção não passa por aqui.
async function assertTrashedAccess(req: Request) {
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id as string }, select: TICKET_ACCESS_SELECT })
  if (ticket) await assertTicketAccess(ticket, (req as any).user)
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await TrashService.listTrash({ ...listSchema.parse(req.query), visibility: await listVisibility((req as any).user) }))
  } catch (err) { next(err) }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    await assertTrashedAccess(req)
    await TrashService.restoreTicket(req.params.id as string, getAuditInfo(req))
    res.status(204).end()
  } catch (err) { next(err) }
}

export async function purge(req: Request, res: Response, next: NextFunction) {
  try {
    await assertTrashedAccess(req)
    await TrashService.purgeTicket(req.params.id as string, getAuditInfo(req))
    res.status(204).end()
  } catch (err) { next(err) }
}

export async function getConfig(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await TrashService.getTrashConfig() })
  } catch (err) { next(err) }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await TrashService.updateTrashConfig(configSchema.parse(req.body), getAuditInfo(req)) })
  } catch (err) { next(err) }
}
