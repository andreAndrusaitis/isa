/**
 * Agente triage — visão por chamado.
 * GET /api/ai/tickets/:id/triage  última triagem do chamado (decisão por campo, alterações e correções humanas);
 *                                 sem o texto de entrada (input), que só o admin vê em /api/ai/runs
 * Montado antes de /api/ai: aquele router exige admin em tudo.
 */
import { Router } from 'express'
import prisma from '../../../config/prisma'
import { authenticate } from '../../../middlewares/auth'
import { requireCap } from '../../../access/middleware'
import { AppError } from '../../../middlewares/errorHandler'
import { getTicketAccess } from '../../../services/ticketAccess'
import { runChanges } from '../../routes'
import { withValueLabels } from './feedback'
import type { TriageResult } from './triage'

const FIELD_LABELS: Record<string, string> = {
  type: 'Tipo', category: 'Categoria', subcategory: 'Subcategoria', urgency: 'Urgência', impact: 'Impacto',
}

const router = Router()
router.use(authenticate)

router.get('/:id/triage', requireCap('tickets.work'), async (req, res) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: String(req.params.id) } })
  if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
  const access = await getTicketAccess(ticket, req.user!)
  if (!access.allowed) throw new AppError(403, access.message, access.code)
  const run = await prisma.aiAgentRun.findFirst({
    where: { agent: 'triage', ticket_id: ticket.id }, orderBy: { created_at: 'desc' },
  })
  if (!run) { res.json({ data: null }); return }
  const result = (run.result ?? {}) as Partial<TriageResult>
  const feedback = await prisma.aiFeedback.findMany({
    where: { run_id: run.id }, orderBy: { created_at: 'asc' }, include: { user: { select: { id: true, name: true } } },
  })
  const labeled = await withValueLabels(feedback)
  res.json({ data: {
    id: run.id, created_at: run.created_at, mode: run.mode, model: run.model, prompt_version: run.prompt_version,
    status: run.status, error: run.error, justification: result.justification ?? null,
    low_information: !!result.lowInformation, apply_error: result.applyError ?? null,
    gate: result.gate ? { value: result.gate.value, confidence: result.gate.confidence, would_apply: result.gate.wouldApply } : null,
    fields: (result.questions ?? []).map(q => ({
      key: q.key, label: FIELD_LABELS[q.key] ?? q.key, chosen: q.chosen, chosen_label: q.chosenLabel,
      confidence: q.confidence, would_apply: q.wouldApply, evidence: q.evidence,
      evidence_source: q.evidenceSource, evidence_valid: q.evidenceValid,
    })),
    priority: result.priority
      ? { value: result.priority.value, confidence: result.priority.confidence, would_apply: result.priority.wouldApply }
      : null,
    changes: runChanges(result),
    feedback: labeled.map(f => ({
      field: f.field, ai_value: f.ai_value, accepted: f.accepted, ai_label: f.ai_label, from_value: f.from_value, to_value: f.to_value,
      from_label: f.from_label, to_label: f.to_label, user: f.user, created_at: f.created_at,
    })),
  } })
})

export default router
