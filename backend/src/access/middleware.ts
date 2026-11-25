/**
 * Trava de rota do porteiro: substitui authorize / authorizeArea / requireModule.
 * Responde igual a elas (mesmos códigos e mensagens de erro), decidindo por can().
 */
import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../middlewares/errorHandler'
import { tagGate } from '../middlewares/auth'
import { roleDenied, areaDenied } from '../utils/denials'
import { CAPABILITIES, type CapabilityKey } from './capabilities'
import { can, subjectOf, modulesFor, ticketRole } from './can'

export function requireCap(capability: CapabilityKey) {
  const cap = CAPABILITIES[capability] as { roles: readonly string[]; area?: string; module?: string }
  if (!cap) throw new Error(`Capacidade desconhecida: ${capability}`)
  return tagGate(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, 'Não autenticado', 'UNAUTHORIZED')
    // Módulo exige o cálculo da herança (uma vez por requisição); o resto decide pelo token.
    const subject = cap.module ? await subjectOf(req) : req.user
    if (can(subject, capability)) return next()
    if (cap.module && !(subject as any).modules?.[cap.module]) throw new AppError(403, 'Sem acesso a este módulo', 'FORBIDDEN')
    if (cap.area) throw areaDenied(cap.area, req.user.role)
    throw roleDenied([...cap.roles], req.user.role)
  }, { kind: 'cap', cap: capability })
}

/**
 * Equipe com Chamados desligado usa as rotas de chamado como solicitante: vê e
 * responde só o que ela mesma abriu (Minhas solicitações). Os módulos são calculados
 * antes da troca, então as ações de atendimento negam com "Sem acesso a este módulo".
 */
export const ticketsAsRequester = tagGate(async function ticketsAsRequester(req: Request, _res: Response, next: NextFunction) {
  if (req.user) {
    const role = await ticketRole(req.user.sub, req.user.role, await modulesFor(req))
    if (role !== req.user.role) req.user = { ...req.user, role }
  }
  next()
}, { kind: 'requester' })
