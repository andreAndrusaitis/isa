import { Request, Response, NextFunction } from 'express'
import { can } from '../access/can'
import { TicketService, buildTicketListWhere, TICKET_LIST_SORTS, redactForRequester, publicMessages, withoutIntakeStatus, withoutSurveyToken } from '../services/tickets'
import { logger } from '../utils/logger'
import { z } from 'zod'
import { getEffectiveScope, canSeeOrg } from '../services/scope'
import { getTicketAccess, ticketVisibilityWhere, TICKET_ACCESS_SELECT } from '../services/ticketAccess'
import { adminReadOnly, forbidden, roleDenied } from '../utils/denials'
import { AppError } from '../middlewares/errorHandler'
import prisma from '../config/prisma'
import { getAuditInfo } from '../utils/audit'
import { userHasPermission, DELETE_TICKETS_PERMISSION } from '../config/permissions'
import { createUser } from '../services/users'
import { assertCategoryNotBlocked } from '../services/orgCategoryAccess'
import { createAuditLog } from '../services/audit'
import { randomUUID } from 'node:crypto'

// Perfis autorizados a abrir chamados em nome de um cliente, ou a abrir
// chamado proativo em nome próprio vinculado a uma empresa escolhida.
// Admin é somente leitura em chamados — não abre chamados.
export const ON_BEHALF_ROLES = ['agent', 'supervisor', 'manager']

// Nega com o motivo real (empresa fora da carteira, fila não vinculada, …).
export async function assertTicketAccess(ticket: any, user: any) {
  const access = await getTicketAccess(ticket, user)
  if (!access.allowed) throw forbidden(access.code, access.message)
  return access
}

// via 'requester' = só chega ao chamado por tê-lo aberto: acompanha e responde como
// cliente, mesmo sendo da equipe. Atender exige carteira ou envolvimento direto.
async function assertTicketWork(ticket: any, user: any) {
  const access = await assertTicketAccess(ticket, user)
  if (access.via === 'requester') {
    throw forbidden('REQUESTER_ONLY', 'Você abriu este chamado, mas ele não está na sua carteira: aqui você é o solicitante. Pode acompanhar e responder; para atender, peça a inclusão da empresa e da fila na sua carteira.')
  }
}

// Editar ou apagar mensagem exige o chamado ao alcance de quem mexe. A fronteira é a
// empresa: analista da carteira fora da fila segue a regra de autor e moderação.
// Devolve se a pessoa pode moderar mensagens de terceiros neste chamado.
async function canModerateMessagesOf(id: string, user: any) {
  const ticket = await prisma.ticket.findFirst({ where: { id, deleted_at: null }, select: TICKET_ACCESS_SELECT })
  if (!ticket) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
  const access = await getTicketAccess(ticket, user)
  if (!access.allowed && access.code !== 'QUEUE_NOT_ASSIGNED') throw forbidden(access.code, access.message)
  return can(user, 'tickets.messages.moderate') && !(access.allowed && access.via === 'requester')
}

// Mesma regra de visibilidade da listagem legada: cliente vê os próprios,
// analista/TM/gerente a carteira + envolvimento, admin tudo.
export async function listVisibility(user: any): Promise<any> {
  if (user.role === 'user') return { user_id: user.sub }
  if (user.role === 'agent' || user.role === 'supervisor' || user.role === 'manager') {
    return ticketVisibilityWhere(user.sub, await getEffectiveScope(user.sub, user.role))
  }
  return {}
}

const csv = (v: unknown) => (typeof v === 'string' && v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined)
const flag = z.enum(['true', 'false']).transform(v => v === 'true').optional()
// Filtros multivalorados chegam como CSV ("a,b") e viram `in` no where.
const ids100 = z.array(z.string().max(100)).max(500).optional()
const isoDate = z.string().datetime({ offset: true }).transform(v => new Date(v)).optional()
const listPageQuery = z.object({
  page: z.coerce.number().int().min(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(TICKET_LIST_SORTS).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  status: z.preprocess(csv, z.array(z.enum(['active', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'ai_resolved', 'team_resolved', 'team_closed'])).optional()),
  priority: z.preprocess(csv, z.array(z.enum(['low', 'medium', 'high'])).optional()),
  type: z.preprocess(csv, z.array(z.enum(['incident', 'request', 'problem', 'change'])).optional()),
  categoryId: z.preprocess(csv, ids100),
  orgId: z.preprocess(csv, ids100),
  queueId: z.preprocess(csv, ids100),
  assignedToId: z.preprocess(csv, ids100),
  unassigned: flag,
  overdue: flag,
  mine: flag,
  requested: flag,
  isReopened: flag,
  search: z.string().max(100).optional(),
  createdFrom: isoDate,
  createdTo: isoDate,
  ids: z.preprocess(csv, z.array(z.string().max(100)).max(500).optional()),
})

// Contadores da sidebar acompanham os filtros de Empresa/Analista da tela
const countsQuery = listPageQuery.pick({ orgId: true, assignedToId: true, unassigned: true, requested: true })

const groupedCountsQuery = z.object({
  by: z.enum(['assignee', 'requester', 'org']),
  orgId: z.string().max(100).optional(),
})

// O chamado já abriu: id de outro usuário, já usado ou falha aqui não mudam nada para quem abriu.
async function linkDeclinedInteraction(id: string, userId: string, ticketId: string) {
  await prisma.aiInteraction.updateMany({
    where: { id, user_id: userId, ticket_id: null, accepted: false },
    data: { ticket_id: ticketId },
  }).catch(err => logger.error('[AI:knowledge] vínculo da interação falhou:', { err }))
}

// Bloqueia URLs de anexo com schemes perigosos (javascript:, vbscript:, file:…)
// que viram XSS quando renderizados em <a href>. Permite data URIs (imagens,
// PDFs, logs, etc.), http(s) e caminhos relativos.
export const safeAttachmentUrl = z.string().refine((v) => {
  if (!v) return true
  const lower = v.trim().toLowerCase()
  return (
    lower.startsWith('data:') ||
    // Caminho do próprio portal; "//host" seria outro site.
    (lower.startsWith('/') && !lower.startsWith('//'))
  )
}, { message: 'URL de anexo inválida' })

export const createTicketSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório').optional(),
  description: z.string().min(1, 'Descrição é obrigatória').optional(),
  special_data: z.record(z.string()).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  categoryId: z.preprocess((val) => (val === '' ? null : val), z.string().nullable().optional()),
  category_id: z.preprocess((val) => (val === '' ? null : val), z.string().nullable().optional()),
  subcategoryId: z.preprocess((val) => (val === '' ? null : val), z.string().nullable().optional()),
  subcategory_id: z.preprocess((val) => (val === '' ? null : val), z.string().nullable().optional()),
  queue: z.string().optional(),
  attachment_url: safeAttachmentUrl.nullable().optional(),
  onBehalfOfUserId: z.string().min(1).optional(),
  proactiveOrgId: z.string().min(1).optional(),
  // Cadastro rápido: cliente ainda não existe — cria e abre em nome dele.
  newRequester: z.object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(50, 'Nome deve ter no máximo 50 caracteres'),
    email: z.string().trim().toLowerCase().email('E-mail inválido'),
    orgId: z.string().min(1, 'Empresa é obrigatória'),
  }).optional(),
  // Segundos entre abrir o formulário e enviar (linha de base do portal).
  openingSeconds: z.number().int().min(0).max(86_400).optional(),
  // Sugestão da base recusada antes de abrir: só liga o chamado à interação, nunca barra a abertura.
  aiInteractionId: z.string().uuid().optional().catch(undefined),
})

/** Campos do chamado que vêm do formulário; solicitante e empresa já decididos por quem chama. */
export function ticketFields(body: z.infer<typeof createTicketSchema>, requester: { id: string; orgId: string | null }, role: string) {
  return {
    title: body.title,
    description: body.description,
    special_data: body.special_data,
    priority: body.priority,
    category_id: body.categoryId || body.category_id || null,
    subcategory_id: body.subcategoryId || body.subcategory_id || null,
    user_id: requester.id,
    org_id: requester.orgId,
    // Fila é decisão do atendimento: o cliente segue a fila padrão da empresa.
    queue: role === 'user' ? undefined : body.queue,
    attachment_url: body.attachment_url || null,
    channel: 'portal',
    opening_seconds: body.openingSeconds ?? null,
  }
}

export class TicketController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createTicketSchema.parse(req.body)
      const { categoryId, category_id, subcategoryId, subcategory_id, onBehalfOfUserId, proactiveOrgId, newRequester, aiInteractionId } = body
      const user = (req as any).user

      // Admin tem acesso somente leitura a chamados — não abre chamados.
      if (user.role === 'admin') throw adminReadOnly()

      if (onBehalfOfUserId && proactiveOrgId) {
        throw new AppError(400, 'Informe apenas um cliente OU uma empresa para ação proativa, não ambos', 'PROACTIVE_AND_ON_BEHALF_CONFLICT')
      }
      if (newRequester && (onBehalfOfUserId || proactiveOrgId)) {
        throw new AppError(400, 'Cadastro rápido de cliente não pode ser combinado com cliente existente ou ação proativa', 'NEW_REQUESTER_CONFLICT')
      }

      // Abertura em nome de cliente: só Analista, Ticket Manager e Gerente (admin
      // é somente leitura). O solicitante (user_id/org_id) passa a ser o
      // cliente; quem abriu fica em created_by_id.
      let requesterId = user.sub
      let requesterOrgId = user.orgId || null
      let proactiveAuditNote: string | null = null
      if (onBehalfOfUserId && onBehalfOfUserId !== user.sub) {
        if (!ON_BEHALF_ROLES.includes(user.role)) {
          throw forbidden('ON_BEHALF_FORBIDDEN', roleDenied(ON_BEHALF_ROLES, user.role, 'Abrir chamado em nome de um cliente').message)
        }
        const target = await prisma.user.findFirst({
          where: { id: onBehalfOfUserId, deleted_at: null, active: true },
          select: { id: true, org_id: true, role: true },
        })
        if (!target || target.role !== 'user') {
          throw new AppError(404, 'Cliente não encontrado', 'ON_BEHALF_USER_NOT_FOUND')
        }
        const scope = await getEffectiveScope(user.sub, user.role)
        if (!canSeeOrg(scope, target.org_id)) {
          const targetOrg = target.org_id ? await prisma.organization.findUnique({ where: { id: target.org_id }, select: { name: true } }) : null
          throw forbidden('ON_BEHALF_OUT_OF_SCOPE', `O cliente pertence à empresa ${targetOrg?.name ?? '(sem empresa)'}, que não está na sua carteira. Você só pode abrir chamados em nome de clientes das empresas que atende.`)
        }
        requesterId = target.id
        requesterOrgId = target.org_id
      } else if (proactiveOrgId) {
        // Ação proativa: o solicitante continua sendo o próprio ator, só a
        // empresa (org_id) muda — usado quando o analista age preventivamente
        // para uma empresa, sem um cliente específico envolvido.
        if (!ON_BEHALF_ROLES.includes(user.role)) {
          throw forbidden('ON_BEHALF_FORBIDDEN', roleDenied(ON_BEHALF_ROLES, user.role, 'Abrir chamado proativo para uma empresa').message)
        }
        const org = await prisma.organization.findFirst({
          where: { id: proactiveOrgId, deleted_at: null },
          select: { id: true, name: true },
        })
        if (!org) {
          throw new AppError(404, 'Empresa não encontrada', 'ORG_NOT_FOUND')
        }
        const scope = await getEffectiveScope(user.sub, user.role)
        if (!canSeeOrg(scope, org.id)) {
          throw forbidden('ON_BEHALF_OUT_OF_SCOPE', `A empresa ${org.name} não está na sua carteira. Você só pode abrir chamados proativos para as empresas que atende.`)
        }
        requesterOrgId = org.id
        proactiveAuditNote = `Chamado proativo aberto para a empresa ${org.name}`
      } else if (newRequester) {
        if (!ON_BEHALF_ROLES.includes(user.role)) {
          throw forbidden('ON_BEHALF_FORBIDDEN', roleDenied(ON_BEHALF_ROLES, user.role, 'Cadastrar cliente e abrir chamado em nome dele').message)
        }
        const org = await prisma.organization.findFirst({
          where: { id: newRequester.orgId, deleted_at: null },
          select: { id: true, name: true },
        })
        if (!org) throw new AppError(404, 'Empresa não encontrada', 'ORG_NOT_FOUND')
        const scope = await getEffectiveScope(user.sub, user.role)
        if (!canSeeOrg(scope, org.id)) {
          throw forbidden('ON_BEHALF_OUT_OF_SCOPE', `A empresa ${org.name} não está na sua carteira. Você só pode cadastrar clientes das empresas que atende.`)
        }
        await assertCategoryNotBlocked(org.id, categoryId || category_id, subcategoryId || subcategory_id)
        // User.email é @unique: qualquer conta com o e-mail (inclusive inativa
        // ou excluída) bloqueia o cadastro — nunca cria duplicado.
        const existing = await prisma.user.findFirst({
          where: { email: { equals: newRequester.email, mode: 'insensitive' as const } },
          select: { id: true },
        })
        if (existing) {
          throw new AppError(409, `Já existe um usuário com o e-mail ${newRequester.email}. Selecione-o no campo de cliente em vez de cadastrar de novo (se não aparecer, ele pode estar inativo ou em outra empresa — fale com um administrador).`, 'REQUESTER_EMAIL_EXISTS')
        }
        // Domínio autorizado para SSO nesta empresa → entra com Microsoft, sem
        // senha. Senão, conta local com senha provisória enviada no e-mail de
        // boas-vindas (createUser força a troca no primeiro login).
        const domain = newRequester.email.split('@').pop()!
        const ssoDomain = await prisma.authorizedDomain.findFirst({
          where: { domain, org_id: org.id, active: true },
          select: { id: true },
        })
        const audit = getAuditInfo(req)
        const created = await createUser({
          name: newRequester.name,
          email: newRequester.email,
          ...(ssoDomain ? { authProvider: 'microsoft' } : { authProvider: 'local', password: randomUUID() }),
          role: 'user',
          org_id: org.id,
          queues: [],
        } as any, audit)
        await createAuditLog({
          userId: user.sub,
          action: 'USER_QUICK_CREATED',
          resource: 'USER',
          details: { createdUserId: created.id, email: created.email, orgId: org.id, authProvider: created.auth_provider, via: 'ticket_on_behalf' },
          ip: audit.ip,
          userAgent: audit.userAgent,
        })
        requesterId = created.id
        requesterOrgId = org.id
      }

      // Categoria desligada para a empresa (Categorias › Empresas). Integrações
      // (API externa) não passam por aqui e nunca são rejeitadas.
      await assertCategoryNotBlocked(requesterOrgId, categoryId || category_id, subcategoryId || subcategory_id)

      const ticket = await TicketService.createTicket({
        ...ticketFields(body, { id: requesterId, orgId: requesterOrgId }, user.role),
        auditNote: proactiveAuditNote,
      }, user.sub)

      if (aiInteractionId && ticket) await linkDeclinedInteraction(aiInteractionId, user.sub, ticket.id)

      logger.info(`Chamado criado: ${ticket.id} por usuário ${user.sub}${requesterId !== user.sub ? ` em nome de ${requesterId}` : ''}${proactiveAuditNote ? ' (ação proativa)' : ''}`)
      return res.status(201).json({ data: ticket })
    } catch (err) {
      return next(err)
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user
      if (req.query.page !== undefined) {
        const parsed = listPageQuery.safeParse(req.query)
        if (!parsed.success) {
          return res.status(400).json({ error: 'Parâmetros de listagem inválidos', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
        }
        const { page, pageSize, sort, dir, ...q } = parsed.data
        const where = buildTicketListWhere(q, await listVisibility(user), user.sub)
        const pageResult = await TicketService.getTicketsPage(where, { page, pageSize, sort, dir })
        return res.json(user.role === 'user' ? { ...pageResult, data: pageResult.data.map(withoutIntakeStatus) } : pageResult)
      }
      const { status, orgId, categoryId, queueId, isReopened, limit, offset } = req.query

      const filters: any = {}
      if (status) filters.status = status
      if (orgId) filters.org_id = orgId
      if (categoryId) filters.category_id = categoryId
      if (queueId) filters.queue = queueId
      if (isReopened !== undefined) filters.is_reopened = isReopened === 'true'
      if (limit) filters.limit = Math.min(Number(limit), 500)
      if (offset) filters.offset = Number(offset)

      if (user.role === 'user') {
        filters.user_id = user.sub
      } else if (user.role === 'agent' || user.role === 'supervisor' || user.role === 'manager') {
        filters.scope = await getEffectiveScope(user.sub, user.role)
        filters.scope_user_id = user.sub
      }

      const result = await TicketService.getTickets(filters)
      return res.json(user.role === 'user' ? { ...result, data: result.data.map(withoutIntakeStatus) } : result)
    } catch (err) {
      return next(err)
    }
  }

  static async counts(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user
      const parsed = countsQuery.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Parâmetros inválidos', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
      }
      const where = buildTicketListWhere(parsed.data, await listVisibility(user), user.sub)
      return res.json({ data: await TicketService.getTicketCounts(where, user.sub) })
    } catch (err) {
      return next(err)
    }
  }

  static async groupedCounts(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user
      const parsed = groupedCountsQuery.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Parâmetros inválidos', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
      }
      const where = buildTicketListWhere({ orgId: parsed.data.orgId }, await listVisibility(user), user.sub)
      return res.json({ data: await TicketService.getGroupedCounts(where, parsed.data.by) })
    } catch (err) {
      return next(err)
    }
  }

  static async activity(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user
      const where = buildTicketListWhere({}, await listVisibility(user), user.sub)
      return res.json({ data: await TicketService.getTicketActivity(where) })
    } catch (err) {
      return next(err)
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const user = (req as any).user

      const ticket = await TicketService.getTicketById(id)
      if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado', code: 'NOT_FOUND' })

      const access = await assertTicketAccess(ticket, user)

      if (access.via === 'requester') return res.json({ data: redactForRequester(ticket) })
      return res.json({ data: ticket.user_id === user.sub ? ticket : withoutSurveyToken(ticket) })
    } catch (err) {
      return next(err)
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const user = (req as any).user

      const ticket = await TicketService.getTicketById(id)
      if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado', code: 'NOT_FOUND' })

      await assertTicketWork(ticket, user)

      const updateSchema = z.object({
        status: z.enum(['open', 'in_progress', 'pending', 'resolved', 'closed']).optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        assigned_to_id: z.string().nullable().optional(),
        queue: z.string().optional(),
        note: z.string().optional(),
        categoryId: z.string().nullable().optional(),
        category_id: z.string().nullable().optional(),
        subcategoryId: z.string().nullable().optional(),
        subcategory_id: z.string().nullable().optional(),
        resolution_details: z.string().optional(),
        reopen_sla_enabled: z.boolean().optional(),
        reopen_sla_limit_hours: z.number().or(z.string()).nullable().optional(),
        sla_deadline: z.string().or(z.date()).optional(),
        chat_enabled: z.boolean().optional(),
        pending_reason: z.enum(['pending_user', 'pending_vendor', 'pending_approval', 'pending_parts', 'pending_schedule']).optional(),
        pending_evidence_url: safeAttachmentUrl.optional(),
        pending_schedule_at: z.string().or(z.date()).nullable().optional(),
        client_forecast_at: z.string().datetime({ offset: true }).nullable().optional(),
        type: z.enum(['incident', 'request', 'problem', 'change']).optional(),
        requesterId: z.string().min(1).optional(),
      })
      const parsedBody = updateSchema.parse(req.body)

      const updatedTicket = await TicketService.updateTicket(id, user.sub, user.role, parsedBody)
      return res.json({ data: withoutSurveyToken(updatedTicket) })
    } catch (err) {
      return next(err)
    }
  }

  static async reopen(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const user = (req as any).user

      const ticket = await TicketService.getTicketById(id)
      if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado', code: 'NOT_FOUND' })

      const access = await assertTicketAccess(ticket, user)

      // Admin tem acesso somente leitura a chamados — não reabre chamados.
      if (user.role === 'admin') throw adminReadOnly()

      const { reason } = z.object({ reason: z.string().min(10, 'Motivo deve ter pelo menos 10 caracteres') }).parse(req.body)
      const ticketResult = await TicketService.reopenTicket(id, user.sub, reason)
      return res.json({ data: access.via === 'requester' ? withoutIntakeStatus(ticketResult) : ticketResult })
    } catch (err) {
      return next(err)
    }
  }

  // Cliente confirma que resolveu: fecha o próprio chamado, sem esperar o fechamento automático.
  static async confirm(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user
      const ticket = await TicketService.getTicketById(req.params.id as string)
      if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado', code: 'NOT_FOUND' })
      await assertTicketAccess(ticket, user)
      const result = await TicketService.confirmResolution(ticket.id, user.sub)
      return res.json({ data: withoutIntakeStatus(result) })
    } catch (err) {
      return next(err)
    }
  }

  static async addMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const user = (req as any).user

      const ticket = await TicketService.getTicketById(id)
      if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado', code: 'NOT_FOUND' })

      const access = await assertTicketAccess(ticket, user)

      // Admin tem acesso somente leitura a chamados — não envia mensagens.
      if (user.role === 'admin') throw adminReadOnly()

      const { text, type, attachment_url, dispatchChannel, is_realtime } = z.object({
        text: z.string().default(''),
        type: z.enum(['user', 'agent', 'internal', 'email']).default('user'),
        attachment_url: safeAttachmentUrl.optional(),
        dispatchChannel: z.string().optional(),
        is_realtime: z.boolean().optional().default(false)
      }).parse(req.body)

      if (access.via === 'requester' && type !== 'user') {
        throw forbidden('MESSAGE_TYPE_NOT_ALLOWED', 'Como solicitante, você só pode enviar mensagens públicas no chamado. Notas internas e respostas de atendimento são exclusivas da equipe de atendimento.')
      }

      if (!text && !attachment_url) {
        return res.status(400).json({ error: 'A mensagem não pode estar vazia', code: 'VALIDATION_ERROR' })
      }

      const message = await TicketService.addMessage(id, user.sub, text, type, attachment_url, dispatchChannel, is_realtime)
      return res.status(201).json({ data: message })
    } catch (err) {
      return next(err)
    }
  }

  static async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const user = (req as any).user

      const ticket = await TicketService.getTicketById(id)
      if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado', code: 'NOT_FOUND' })

      const access = await assertTicketAccess(ticket, user)

      const messages = await TicketService.getMessages(id)
      return res.json({ data: access.via === 'requester' ? publicMessages(messages) : messages })
    } catch (err) {
      return next(err)
    }
  }

  static async updateMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const messageId = req.params.messageId as string
      const user = (req as any).user
      const { text } = z.object({ text: z.string().min(1, 'A mensagem não pode estar vazia') }).parse(req.body)

      const message = await TicketService.updateMessage(id, messageId, user.sub, await canModerateMessagesOf(id, user), text)
      return res.json({ data: message })
    } catch (err) {
      return next(err)
    }
  }

  // Exclusão (soft delete): admin de qualquer chamado; demais só com a permissão
  // individual 'delete_tickets' concedida pelo admin, dentro da própria carteira.
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user
      if (!userHasPermission(user, DELETE_TICKETS_PERMISSION)) {
        throw forbidden('PERMISSION_REQUIRED', 'Excluir chamados exige a permissão individual "Excluir chamados", que só o administrador concede. Peça ao administrador em Usuários › Permissões.')
      }
      const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id as string, deleted_at: null }, select: TICKET_ACCESS_SELECT })
      if (!ticket) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
      await assertTicketWork(ticket, user)
      await TicketService.deleteTicket(ticket.id, getAuditInfo(req))
      return res.status(204).end()
    } catch (err) {
      return next(err)
    }
  }

  static async deleteMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const messageId = req.params.messageId as string
      const user = (req as any).user

      const result = await TicketService.deleteMessage(id, messageId, user.sub, await canModerateMessagesOf(id, user))
      return res.json({ data: result })
    } catch (err) {
      return next(err)
    }
  }
}
