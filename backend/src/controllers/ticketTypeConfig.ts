import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { listTicketTypeConfigs, setTicketTypeEnabled } from '../services/ticketTypeConfig'

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const configs = await listTicketTypeConfigs()
    res.json({ data: configs })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body)
    const config = await setTicketTypeEnabled(req.params.type as string, enabled)
    res.json({ data: config })
  } catch (err) { next(err) }
}
