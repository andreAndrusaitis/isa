import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import {
  getInactivityConfig,
  upsertInactivityConfig,
  getRedirectLogs,
  runInactivityRedirectJob,
} from '../services/inactivityRedirect'

const normalizeArray = (val: unknown): unknown =>
  Array.isArray(val) ? val : val && typeof val === 'object' ? Object.values(val as object) : val

const configSchema = z.object({
  enabled: z.boolean().optional(),
  inactivity_hours: z.number().int().min(1).max(168).optional(),
  business_hours_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  business_hours_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  working_days: z.preprocess(normalizeArray, z.array(z.number().int().min(0).max(6)).min(1)).optional(),
  timezone: z.string().min(1).optional(),
  target_priority: z.enum(['low', 'medium', 'high']).optional(),
  vip_queue_id: z.string().nullable().optional(),
  max_redirects_per_day: z.number().int().min(1).max(10).optional(),
})

export async function getConfig(_req: Request, res: Response, next: NextFunction) {
  try {
    const config = await getInactivityConfig()
    res.json({ data: config })
  } catch (err) { next(err) }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const data = configSchema.parse(req.body)
    const config = await upsertInactivityConfig(data)
    res.json({ data: config })
  } catch (err) { next(err) }
}

export async function listLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
    const result = await getRedirectLogs({
      page,
      limit,
      ticketId: req.query.ticketId as string | undefined,
      agentId: req.query.agentId as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
    }, req.user)
    res.json(result)
  } catch (err) { next(err) }
}

export async function triggerManual(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await runInactivityRedirectJob({ force: true })
    res.json({ message: 'Job executado com sucesso.', stats })
  } catch (err) { next(err) }
}
