import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getReopenSlaConfig, upsertReopenSlaConfig } from '../services/reopenSla'

const reopenConfigSchema = z.object({
  enabled: z.boolean().optional(),
  reopen_limit_hours: z.number().int().min(1).max(8760).optional(),
})

export async function getConfig(_req: Request, res: Response, next: NextFunction) {
  try {
    const config = await getReopenSlaConfig()
    res.json({ data: config })
  } catch (err) {
    next(err)
  }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const data = reopenConfigSchema.parse(req.body)
    const config = await upsertReopenSlaConfig(data)
    res.json({ data: config })
  } catch (err) {
    next(err)
  }
}
