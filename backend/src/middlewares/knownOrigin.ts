import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'
import { AppError } from './errorHandler'

const originOf = (url: string) => { try { return new URL(url).origin } catch { return '' } }

/**
 * Login, refresh e logout usam cookie: um site de fora não pode dispará-los pelo
 * navegador da pessoa. Todo navegador manda Origin em POST de outra origem; quem não
 * manda (integrações, testes) não carrega o cookie de ninguém.
 */
export function requireKnownOrigin(req: Request, _res: Response, next: NextFunction) {
  const origin = req.headers.origin
  if (req.method === 'GET' || !origin) return next()
  const allowed = new Set([...env.CORS_ORIGIN.split(',').map(o => o.trim()), originOf(env.PORTAL_URL)])
  if (allowed.has(origin) || originOf(origin) === originOf(`${req.protocol}://${req.headers.host}`)) return next()
  throw new AppError(403, 'Origem não autorizada', 'ORIGIN_NOT_ALLOWED')
}
