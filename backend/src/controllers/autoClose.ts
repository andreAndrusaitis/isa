import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getAutoCloseConfig, upsertAutoCloseConfig, getAutoCloseLogs, runAutoCloseJob } from '../services/autoClose'

const configSchema = z.object({
  enabled: z.boolean().optional(),
  inactive_days: z.number().int().min(1).max(90).optional(),
})

export async function getConfig(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getAutoCloseConfig() })
  } catch (err) { next(err) }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await upsertAutoCloseConfig(configSchema.parse(req.body)) })
  } catch (err) { next(err) }
}

export async function listLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1)
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
    res.json(await getAutoCloseLogs({
      page,
      limit,
      ticketId: req.query.ticketId as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
    }, req.user))
  } catch (err) { next(err) }
}

export async function triggerManual(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await runAutoCloseJob()
    res.json({ message: 'Job executado com sucesso.', stats })
  } catch (err) { next(err) }
}
