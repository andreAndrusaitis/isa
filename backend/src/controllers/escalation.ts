import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { EscalationService } from '../services/escalation'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { getTicketAccess } from '../services/ticketAccess'
import { forbidden } from '../utils/denials'
import { getTicketFamily } from '../services/ticketFamily'

// Escalonar/reverter/entrar exige acesso ao chamado (antes qualquer analista agia só com o ID).
async function assertCanActOnTicket(ticketId: string, user: { sub: string; role: string }) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
  if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
  const access = await getTicketAccess(ticket, user)
  if (!access.allowed) throw forbidden(access.code, access.message)
  return access
}

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['transfer', 'same_ticket', 'child_ticket', 'category_change']),
  target_queue_id: z.string().nullable().optional(),
  target_category_id: z.string().nullable().optional(),
  auto_description: z.string().max(255).nullable().optional(),
  active: z.boolean().optional(),
  target_mode: z.enum(['queue', 'agent_pick', 'agent_fixed']).optional(),
  target_agent_id: z.string().nullable().optional(),
  keep_origin: z.boolean().optional(),
  require_note: z.boolean().optional(),
  target_priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  source_queue_ids: z.array(z.string()).max(100).optional(),
})

export class EscalationController {
  static async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const rules = await EscalationService.listRules()
      res.json({ data: rules })
    } catch (err) { next(err) }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = ruleSchema.parse(req.body)
      const rule = await EscalationService.createRule(data as any)
      res.status(201).json({ data: rule })
    } catch (err) { next(err) }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const data = ruleSchema.partial().parse(req.body)
      const rule = await EscalationService.updateRule(id, data)
      res.json({ data: rule })
    } catch (err) { next(err) }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await EscalationService.deleteRule(req.params.id as string)
      res.json({ data: { ok: true } })
    } catch (err) { next(err) }
  }

  static async execute(req: Request, res: Response, next: NextFunction) {
    try {
      const ticketId = req.params.id as string
      const { ruleId, targetAgentId, note } = z.object({
        ruleId: z.string().min(1),
        targetAgentId: z.string().nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
      }).parse(req.body)
      const actor = (req as any).user
      await assertCanActOnTicket(ticketId, actor)
      const result = await EscalationService.executeEscalation(ticketId, ruleId, actor.sub, targetAgentId ?? null, actor.role, { note: note ?? null })
      res.json({ data: result })
    } catch (err) { next(err) }
  }

  /** Pai e filhos do chamado (escalonamento por chamado filho). */
  static async family(req: Request, res: Response, next: NextFunction) {
    try {
      const ticketId = req.params.id as string
      await assertCanActOnTicket(ticketId, (req as any).user)
      res.json({ data: await getTicketFamily(ticketId) })
    } catch (err) { next(err) }
  }

  static async revert(req: Request, res: Response, next: NextFunction) {
    try {
      const ticketId = req.params.id as string
      const { agentId } = z.object({ agentId: z.string().nullable().optional() }).parse(req.body)
      const actor = (req as any).user
      await assertCanActOnTicket(ticketId, actor)
      const result = await EscalationService.revertUnifiedEscalation(ticketId, { agentId: agentId ?? null }, actor.sub, actor.role)
      res.json({ data: result })
    } catch (err) { next(err) }
  }

  static async join(req: Request, res: Response, next: NextFunction) {
    try {
      const ticketId = req.params.id as string
      const actor = (req as any).user
      await assertCanActOnTicket(ticketId, actor)
      // Vale para quem está na fila para onde o chamado foi escalonado, mesmo que
      // também tenha a empresa na carteira: com responsável definido, só colaborador altera.
      const [ticket, me] = await Promise.all([
        prisma.ticket.findUnique({ where: { id: ticketId }, select: { collab_queue: true, escalated: true, queue: true } }),
        prisma.user.findUnique({ where: { id: actor.sub }, select: { queues: true } }),
      ])
      const myQueues = me?.queues ?? []
      const calledByQueue = (!!ticket?.collab_queue && myQueues.includes(ticket.collab_queue)) ||
        (!!ticket?.escalated && !!ticket.queue && myQueues.includes(ticket.queue))
      if (!calledByQueue) {
        throw forbidden('JOIN_NOT_APPLICABLE', 'Entrar como colaborador é para quem está na fila para onde o chamado foi escalonado. Se você é da equipe responsável, assuma o chamado atribuindo-o a você; senão, peça ao responsável para escalonar para você.')
      }
      res.json({ data: await EscalationService.joinAsCollaborator(ticketId, actor.sub) })
    } catch (err) { next(err) }
  }
}
