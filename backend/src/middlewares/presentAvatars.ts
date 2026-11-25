import { Request, Response, NextFunction } from 'express'
import { presentAttachment } from '../services/uploads'

/**
 * Selects aninhados do Prisma (assigned_to, participants, filas, dashboard…) devolvem
 * o avatar como nome de blob cru. Aqui toda chave `avatar` guardada no blob
 * ("avatars/…") vira URL assinada, em qualquer resposta da API.
 */
export function presentAvatarsDeep(v: any): any {
  if (Array.isArray(v)) {
    v.forEach(presentAvatarsDeep)
  } else if (v && Object.getPrototypeOf(v) === Object.prototype) {
    for (const k of Object.keys(v)) {
      if (k === 'avatar' && typeof v[k] === 'string' && v[k].startsWith('avatars/')) v[k] = presentAttachment(v[k])
      else presentAvatarsDeep(v[k])
    }
  }
  return v
}

export function presentAvatars(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res)
  res.json = (body: any) => json(presentAvatarsDeep(body))
  next()
}
