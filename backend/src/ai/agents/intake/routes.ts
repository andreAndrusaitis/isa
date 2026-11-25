/**
 * Agente intake.
 * GET  /api/ai/intake/checklist            itens do checklist (admin)
 * POST /api/ai/intake/checklist            cria item (admin)
 * PUT  /api/ai/intake/checklist/:id        edita/ativa/desativa item (admin)
 * POST /api/ai/intake/tickets/:id/dismiss  analista dispensa a marca "Informações incompletas"
 * Montado antes de /api/ai: aquele router exige admin em tudo.
 */
import { Router } from 'express'
import { z } from 'zod'
import prisma from '../../../config/prisma'
import { authenticate } from '../../../middlewares/auth'
import { requireCap } from '../../../access/middleware'
import { AppError } from '../../../middlewares/errorHandler'
import { getTicketAccess } from '../../../services/ticketAccess'
import { createAuditLog } from '../../../services/audit'

// Base sem defaults: o PUT parcial não pode reaplicar defaults em campos omitidos.
const base = z.object({
  type: z.enum(['incident', 'request', 'problem', 'change']),
  subcategory_id: z.string().min(1).nullable().optional(),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Key: letras minúsculas, números e _'),
  label: z.string().trim().min(2).max(80),
  criterion: z.string().trim().min(10).max(600),
  question: z.string().trim().min(5).max(300),
  kind: z.enum(['text', 'evidence']),
  required: z.boolean(),
  sort: z.number().int().min(0).max(999),
  active: z.boolean(),
})
const createSchema = base.extend({
  kind: base.shape.kind.default('text'),
  required: base.shape.required.default(true),
  sort: base.shape.sort.default(0),
  active: base.shape.active.default(true),
})
const updateSchema = base.partial()

const audit = (req: any, action: string, resource: string, details: object) =>
  createAuditLog({ userId: req.user.sub, action, resource, details, ip: req.ip, userAgent: req.get('user-agent') })

type Item = { type: string; subcategory_id?: string | null; key: string }

// Subcategoria precisa existir; chave única por tipo + subcategoria (null casa com null), em qualquer estado.
async function validateItem(eff: Item, selfId?: string) {
  if (eff.subcategory_id && !(await prisma.subcategory.findUnique({ where: { id: eff.subcategory_id }, select: { id: true } })))
    throw new AppError(400, 'Subcategoria não encontrada', 'INVALID_SUBCATEGORY')
  const dup = await prisma.intakeChecklistItem.findFirst({
    where: { type: eff.type as any, subcategory_id: eff.subcategory_id ?? null, key: eff.key, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true },
  })
  if (dup) throw new AppError(409, 'Já existe um item com essa chave para este tipo/subcategoria', 'DUPLICATE_KEY')
}

const router = Router()
router.use(authenticate)

router.get('/checklist', requireCap('system.admin'), async (_req, res) => {
  const data = await prisma.intakeChecklistItem.findMany({
    orderBy: [{ type: 'asc' }, { sort: 'asc' }, { created_at: 'asc' }],
    include: { subcategory: { select: { id: true, name: true } } },
  })
  res.json({ data })
})

router.post('/checklist', requireCap('system.admin'), async (req, res) => {
  const input = createSchema.parse(req.body)
  await validateItem(input)
  const data = await prisma.intakeChecklistItem.create({ data: input })
  await audit(req, 'CREATE_INTAKE_ITEM', 'INTAKE_CHECKLIST', { itemId: data.id, key: data.key })
  res.status(201).json({ data })
})

router.put('/checklist/:id', requireCap('system.admin'), async (req, res) => {
  const id = String(req.params.id)
  const existing = await prisma.intakeChecklistItem.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Item não encontrado', 'NOT_FOUND')
  const changes = updateSchema.parse(req.body)
  await validateItem({ ...existing, ...changes }, id)
  const data = await prisma.intakeChecklistItem.update({ where: { id }, data: changes })
  await audit(req, 'UPDATE_INTAKE_ITEM', 'INTAKE_CHECKLIST', { itemId: id, changes })
  res.json({ data })
})

router.post('/tickets/:id/dismiss', requireCap('tickets.work'), async (req, res) => {
  // authorize sempre deixa admin passar; admin é somente leitura em chamados.
  if (req.user!.role === 'admin') throw new AppError(403, 'Admin tem acesso somente leitura a chamados', 'ADMIN_READ_ONLY')
  const ticket = await prisma.ticket.findUnique({ where: { id: String(req.params.id) } })
  if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
  const access = await getTicketAccess(ticket, req.user!)
  if (!access.allowed) throw new AppError(403, access.message, access.code)
  if (ticket.intake_status !== 'incomplete') { res.json({ data: { intake_status: ticket.intake_status } }); return }
  // Condicional: se outra requisição já dispensou/mudou o status, não sobrescreve.
  const { count } = await prisma.ticket.updateMany({ where: { id: ticket.id, intake_status: 'incomplete' }, data: { intake_status: 'dismissed' } })
  if (count) {
    await audit(req, 'DISMISS_INTAKE_FLAG', 'TICKET', { ticketId: ticket.id })
    // Import tardio: services/tickets importa o módulo do intake (ciclo).
    const { TicketService } = await import('../../../services/tickets')
    await TicketService.broadcastTicketUpdate(ticket.id)
  }
  res.json({ data: { intake_status: 'dismissed' } })
})

export default router
