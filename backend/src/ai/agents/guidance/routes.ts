/**
 * Agente guidance.
 * GET   /api/ai/guidance/tickets/:id                status da orientação; o solicitante vê só o que precisa
 *                                                   para os botões, a equipe vê a última execução completa
 * POST  /api/ai/guidance/tickets/:id/resolved       solicitante: "Resolveu meu problema" → resolvido (deflexão)
 * POST  /api/ai/guidance/tickets/:id/declined       solicitante: "Não resolveu" → segue na fila
 * POST  /api/ai/guidance/tickets/:id/link           solicitante: vincula ao chamado aberto e fecha este
 * POST  /api/ai/guidance/tickets/:id/not-duplicate  solicitante: "É outro problema" → orientação normal
 * PATCH /api/ai/guidance/examples/:id/disable       equipe: 👎 desativa um cartão da base de resoluções
 * GET   /api/ai/guidance/examples                   admin (Motor IA): base de resoluções, com busca e filtro
 * PATCH /api/ai/guidance/examples/:id               admin (Motor IA): ativa ou desativa um cartão { active }
 * Montado antes de /api/ai: aquele router exige admin em tudo.
 */
import { Router } from 'express'
import prisma from '../../../config/prisma'
import { authenticate } from '../../../middlewares/auth'
import { requireCap, ticketsAsRequester } from '../../../access/middleware'
import { AppError } from '../../../middlewares/errorHandler'
import { getTicketAccess } from '../../../services/ticketAccess'
import { createAuditLog } from '../../../services/audit'
import { disableExample, setExampleActive } from '../../core/examples'
import { AI_NAME } from '../../core/persona'
import { AGENT as RESOLUTION } from '../resolution/distill'
import { z } from 'zod'
import { AGENT, guidanceTicket, type GuidanceRun } from './agent'

export const DEFLECTED_RESOLUTION = `Resolvido pelo próprio solicitante com a orientação da ${AI_NAME}.`

const OPEN = ['open', 'in_progress', 'pending'] as const

const audit = (req: any, action: string, details: object) =>
  createAuditLog({ userId: req.user.sub, action, resource: 'TICKET', details, ip: req.ip, userAgent: req.get('user-agent') })

async function loadTicket(id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } })
  if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
  return ticket
}

/** Só o próprio solicitante responde à orientação. */
async function requesterTicket(req: any) {
  const ticket = await loadTicket(String(req.params.id))
  if (req.user.role !== 'user' || ticket.user_id !== req.user.sub)
    throw new AppError(403, 'Só o solicitante do chamado pode responder à orientação', 'NOT_REQUESTER')
  return ticket
}

async function lastRun(ticketId: string) {
  return prisma.aiAgentRun.findFirst({
    where: { agent: AGENT, ticket_id: ticketId, status: 'ok' },
    orderBy: { created_at: 'desc' },
    select: { id: true, mode: true, created_at: true, result: true },
  })
}

/** Troca condicional do status: se outra requisição já respondeu, nada muda (409). */
async function transition(ticketId: string, from: string, to: string | null) {
  const { count } = await prisma.ticket.updateMany({
    where: { id: ticketId, guidance_status: from, status: { in: [...OPEN] }, deleted_at: null },
    data: { guidance_status: to },
  })
  if (!count) throw new AppError(409, 'Esta orientação já foi respondida ou o chamado mudou de situação', 'GUIDANCE_NOT_PENDING')
}

/** Mudança no chamado depois da troca de status; se falhar, devolve a marca para o solicitante tentar de novo. */
async function orRevert(ticketId: string, from: string, work: () => Promise<unknown>) {
  try { await work() } catch (err) {
    await prisma.ticket.update({ where: { id: ticketId }, data: { guidance_status: from } }).catch(() => {})
    throw err
  }
}

const service = async () => (await import('../../../services/tickets')).TicketService

const router = Router()
router.use(authenticate)
router.use(ticketsAsRequester)

router.get('/tickets/:id', async (req, res) => {
  const ticket = await loadTicket(String(req.params.id))
  const access = await getTicketAccess(ticket, req.user!)
  if (!access.allowed) throw new AppError(403, access.message, access.code)
  const run = await lastRun(ticket.id)
  const result = (run?.result ?? null) as GuidanceRun | null
  if (req.user!.role === 'user') {
    // Solicitante: só o necessário para os botões (o chamado relacionado é dele mesmo).
    const dup = ticket.guidance_status === 'duplicate_offered' ? result?.duplicate?.ticket ?? null : null
    res.json({ data: { guidance_status: ticket.guidance_status, related: dup } })
    return
  }
  res.json({ data: { guidance_status: ticket.guidance_status, run: run && { ...run, result } } })
})

router.post('/tickets/:id/resolved', async (req, res) => {
  const ticket = await requesterTicket(req)
  await transition(ticket.id, 'offered', 'deflected')
  // Ator = o próprio solicitante com papel 'system': o evento fica no nome dele e não sai e-mail para ele mesmo.
  await orRevert(ticket.id, 'offered', async () =>
    (await service()).updateTicket(ticket.id, ticket.user_id, 'system', { status: 'resolved', resolution_details: DEFLECTED_RESOLUTION }))
  await audit(req, 'GUIDANCE_DEFLECTED', { ticketId: ticket.id })
  res.json({ data: { guidance_status: 'deflected' } })
})

router.post('/tickets/:id/declined', async (req, res) => {
  const ticket = await requesterTicket(req)
  await transition(ticket.id, 'offered', 'declined')
  await audit(req, 'GUIDANCE_DECLINED', { ticketId: ticket.id })
  ;(await service()).broadcastTicketUpdate(ticket.id)
  res.json({ data: { guidance_status: 'declined' } })
})

router.post('/tickets/:id/link', async (req, res) => {
  const ticket = await requesterTicket(req)
  const related = ((await lastRun(ticket.id))?.result as GuidanceRun | null)?.duplicate?.ticket
  if (!related) throw new AppError(409, 'Não há chamado sugerido para vincular', 'GUIDANCE_NOT_PENDING')
  await transition(ticket.id, 'duplicate_offered', 'linked')
  await orRevert(ticket.id, 'duplicate_offered', async () => {
    await prisma.ticketLink.upsert({
      where: { ticket_id_related_id: { ticket_id: ticket.id, related_id: related.id } },
      create: { ticket_id: ticket.id, related_id: related.id, kind: 'duplicate', created_by_id: ticket.user_id },
      update: {},
    })
    await (await service()).updateTicket(ticket.id, ticket.user_id, 'system', {
      status: 'closed', note: `Vinculado pelo solicitante ao chamado ${related.display_number} (mesmo problema).`,
    })
  })
  await audit(req, 'GUIDANCE_LINKED', { ticketId: ticket.id, relatedId: related.id })
  res.json({ data: { guidance_status: 'linked', related } })
})

router.post('/tickets/:id/not-duplicate', async (req, res) => {
  const ticket = await requesterTicket(req)
  await transition(ticket.id, 'duplicate_offered', null)
  await audit(req, 'GUIDANCE_NOT_DUPLICATE', { ticketId: ticket.id })
  // Segue para a orientação normal, sem a checagem de duplicidade (em segundo plano).
  void guidanceTicket(ticket.id, { skipDuplicate: true })
  res.json({ data: { guidance_status: null } })
})

router.patch('/examples/:id/disable', requireCap('tickets.work'), async (req, res) => {
  const row = await disableExample(String(req.params.id))
  if (!row) throw new AppError(404, 'Cartão não encontrado', 'NOT_FOUND')
  await createAuditLog({ userId: req.user!.sub, action: 'DISABLE_AI_EXAMPLE', resource: 'AI_EXAMPLE', details: { exampleId: req.params.id, agent: row.agent }, ip: req.ip, userAgent: req.get('user-agent') })
  res.json({ data: { id: req.params.id, active: false } })
})

// ── Base de resoluções (Motor IA › Orientação) ──────────────────────────────

const PAGE = 30

router.get('/examples', requireCap('system.admin'), async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100)
  const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined
  const where = {
    agent: RESOLUTION,
    ...(active !== undefined ? { active } : {}),
    ...(q ? { text: { contains: q, mode: 'insensitive' as const } } : {}),
  }
  const [rows, total, inactive] = await Promise.all([
    prisma.aiExample.findMany({
      where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, text: true, labels: true, active: true, source: true, created_at: true },
    }),
    prisma.aiExample.count({ where: { agent: RESOLUTION } }),
    prisma.aiExample.count({ where: { agent: RESOLUTION, active: false } }),
  ])
  const page = rows.slice(0, PAGE)
  res.json({
    data: page.map(r => {
      const l = (r.labels ?? {}) as Record<string, any>
      return {
        id: r.id, problem: r.text, active: r.active, source: r.source, created_at: r.created_at,
        selfService: l.selfService === true, steps: Array.isArray(l.steps) ? l.steps : [], teamAction: l.teamAction ?? '',
        product: l.product ?? null, sourceDisplay: l.sourceDisplay ?? null,
      }
    }),
    next_cursor: rows.length > PAGE ? page[page.length - 1].id : null,
    total, inactive,
  })
})

router.patch('/examples/:id', requireCap('system.admin'), async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body)
  const row = await setExampleActive(String(req.params.id), active)
  if (!row) throw new AppError(404, 'Cartão não encontrado', 'NOT_FOUND')
  await createAuditLog({ userId: req.user!.sub, action: active ? 'ENABLE_AI_EXAMPLE' : 'DISABLE_AI_EXAMPLE', resource: 'AI_EXAMPLE', details: { exampleId: req.params.id, agent: row.agent }, ip: req.ip, userAgent: req.get('user-agent') })
  res.json({ data: { id: req.params.id, active } })
})

export default router
