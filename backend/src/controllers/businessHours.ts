import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getBusinessHoursConfig, updateBusinessHoursConfig } from '../services/businessHours'
import { holidaysAround } from '../utils/businessHours'
import { AppError } from '../middlewares/errorHandler'

const normalizeArray = (v: unknown): unknown =>
  Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as object) : v

// Hora real (00:00–23:59) e fuso que o Intl conhece: valor inválido aqui
// quebra o cálculo de SLA e derruba a abertura de todo chamado.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (use HH:MM entre 00:00 e 23:59)')
const validTimezone = (tz: string) => { try { new Intl.DateTimeFormat('pt-BR', { timeZone: tz }); return true } catch { return false } }

const schema = z.object({
  business_hours_start: hhmm.optional(),
  business_hours_end: hhmm.optional(),
  working_days: z.preprocess(normalizeArray, z.array(z.number().int().min(1).max(7)).min(1)).optional(),
  timezone: z.string().min(1).refine(validTimezone, 'Fuso horário desconhecido').optional(),
})

export async function get(_req: Request, res: Response, next: NextFunction) {
  try {
    // Feriados vão junto para o front contar o SLA restante em tempo útil.
    res.json({ data: { ...(await getBusinessHoursConfig()), holidays: holidaysAround(new Date()) } })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = schema.parse(req.body)
    // Compara com o lado já salvo quando o PATCH traz só início ou só fim.
    const current = await getBusinessHoursConfig()
    const start = data.business_hours_start ?? current.business_hours_start
    const end = data.business_hours_end ?? current.business_hours_end
    if (start >= end) {
      throw new AppError(400, 'O horário de início deve ser anterior ao de término.', 'INVALID_BUSINESS_HOURS')
    }
    res.json({ data: await updateBusinessHoursConfig(data, req.user?.sub) })
  } catch (err) { next(err) }
}
