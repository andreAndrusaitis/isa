import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { assertCategoryNotBlocked } from './orgCategoryAccess'
import { createAuditLog } from './audit'
import { runRoutingRules, type RoutingTrigger } from './routing'
import { getIo } from '../config/socket'
import { NotificationService } from './notifications'
import { SurveyService } from './survey'

import { SYSTEM_USER_ID } from '../utils/constants'
import { addBusinessHours, holidaysAround, getBusinessMinutesBetween } from '../utils/businessHours'
import { getBusinessHoursConfig } from './businessHours'
import { storeAttachment, presentAttachment } from './uploads'
import { computeTicketTypeChange } from './ticketTypeChange'
import { emitWebhookEvent, buildTicketPayload, buildMessagePayload } from './webhookEvents'
import { queueRequesterUpdate, RequesterUpdate } from './email/ticketUpdateDigest'
import { notifyTicketCreated } from './email/ticketCreatedNotice'
import { getEffectiveScope, canSeeOrg } from './scope'
import { forbidden, adminReadOnly, roleDenied, roleLabel } from '../utils/denials'
import { ticketVisibilityWhere, socketsByTicketAccess, assertValidAssignee, TICKET_ACCESS_SELECT, type TicketLike } from './ticketAccess'
import type { AuditInfo } from '../utils/audit'
import { triageTicket } from '../ai/agents/triage/agent'
import { canStillReopen } from './reopenWindow'
import { recordTriageFeedback } from '../ai/agents/triage/feedback'
import { intakeTicket } from '../ai/agents/intake/agent'
import { appendComplement } from '../ai/agents/intake/complement'
import { guidanceTicket } from '../ai/agents/guidance/agent'
import { distillTicket } from '../ai/agents/resolution/distill'
import { notifyAgentReply } from '../teams/bot/notifier'
import { notifyParentOfChildStatus } from './ticketFamily'

// Campos das linhas da listagem (GET /tickets) — sem mensagens/eventos completos.
const LIST_INCLUDE = {
  category: true,
  subcategory: true,
  user: { select: { id: true, name: true, email: true, avatar: true } },
  created_by: { select: { id: true, name: true, email: true, avatar: true } },
  org: { select: { id: true, name: true } },
  assigned_to: { select: { id: true, name: true, avatar: true } },
  participants: {
    where: { active: true },
    include: { agent: { select: { id: true, name: true, avatar: true } } },
  },
  messages: {
    where: { type: { not: 'internal' as const } },
    orderBy: { created_at: 'desc' as const },
    take: 1,
    select: { id: true, user_id: true, created_at: true },
  },
}

export const TICKET_LIST_SORTS = ['urgency', 'sla', 'priority', 'date', 'id', 'title', 'org', 'category', 'queue', 'status', 'assignee', 'portal'] as const
export type TicketListSort = typeof TICKET_LIST_SORTS[number]
type Dir = 'asc' | 'desc'

// Ordenações que o banco resolve direto; as ausentes são calculadas em getTicketsPage.
// "id" segue a criação: o número do chamado é sequencial.
const PRISMA_SORTS: Partial<Record<TicketListSort, (dir: Dir) => any[]>> = {
  date: dir => [{ created_at: dir }],
  id: dir => [{ created_at: dir }],
  sla: dir => [{ sla_deadline: dir }, { created_at: 'desc' }],
  priority: dir => [{ priority: dir }, { created_at: 'desc' }],
  title: dir => [{ title: dir }, { created_at: 'desc' }],
  org: dir => [{ org: { name: dir } }, { created_at: 'desc' }],
  category: dir => [{ category: { name: dir } }, { created_at: 'desc' }],
}

const STATUS_ORDER: Record<string, number> = { open: 0, in_progress: 1, pending: 2, resolved: 3, closed: 4 }

// Mesma régua do "Urgência" que a tela do analista usava no cliente.
export function urgencyScore(t: { status: string; priority: string; sla_deadline: Date; assigned_to_id: string | null }, now: number): number {
  if (['resolved', 'closed'].includes(t.status)) return 100
  const msLeft = t.sla_deadline.getTime() - now
  if (msLeft < 0) return 0
  if (t.status === 'open' && !t.assigned_to_id) return 1
  if (msLeft < 3600_000) return 2
  if (msLeft < 3 * 3600_000) return 3
  if (t.priority === 'high') return 4
  if (t.status === 'in_progress') return 5
  if (t.priority === 'medium') return 6
  if (t.status === 'pending') return 7
  return 8
}

// "Meus chamados": responsável ou colaborador ativo.
function mineWhere(userId: string) {
  return {
    OR: [
      { assigned_to_id: userId },
      { participants: { some: { agent_id: userId, active: true, role: 'collaborator' } } },
    ],
  }
}

type OneOrMany = string | string[]
const eqOrIn = (v: OneOrMany) => (Array.isArray(v) ? { in: v } : v)

export interface TicketListQuery {
  status?: string[]       // status reais ou uma chave de STATUS_FILTERS
  priority?: OneOrMany
  type?: OneOrMany
  categoryId?: OneOrMany
  orgId?: OneOrMany
  queueId?: OneOrMany
  assignedToId?: OneOrMany
  unassigned?: boolean
  overdue?: boolean
  mine?: boolean
  requested?: boolean     // solicitante = o próprio usuário ("Minhas Solicitações")
  isReopened?: boolean
  search?: string
  createdFrom?: Date
  createdTo?: Date
  ids?: string[]
}

// Além dos status reais: `active` e os recortes que a Visão geral conta em separado.
const STATUS_FILTERS: Record<string, object> = {
  active: { status: { in: ['open', 'in_progress', 'pending'] } },
  ai_resolved: { ai_resolved: true },
  team_resolved: { status: 'resolved', ai_resolved: false },
  team_closed: { status: 'closed', ai_resolved: false },
}

/** Filtros da listagem como `where` do Prisma, somados (AND) à visibilidade já resolvida. */
export function buildTicketListWhere(q: TicketListQuery, visibility: any, userId: string): any {
  const and: any[] = [{ deleted_at: null }]
  if (visibility && Object.keys(visibility).length) and.push(visibility)
  if (q.status?.length) {
    const statuses = q.status.map(s => STATUS_FILTERS[s] ?? { status: s })
    and.push(statuses.length > 1 ? { OR: statuses } : statuses[0])
  }
  if (q.priority?.length) and.push({ priority: eqOrIn(q.priority) })
  if (q.type?.length) and.push({ type: eqOrIn(q.type) })
  if (q.categoryId?.length) and.push({ category_id: eqOrIn(q.categoryId) })
  if (q.orgId?.length) and.push({ org_id: eqOrIn(q.orgId) })
  // A fila também vê os chamados para os quais foi chamada a atuar junto (fila colaboradora).
  if (q.queueId?.length) and.push({ OR: [{ queue: eqOrIn(q.queueId) }, { collab_queue: eqOrIn(q.queueId) }] })
  // Analistas + "Sem responsável" na mesma seleção somam (OR), não se anulam
  const assignee: any[] = []
  if (q.assignedToId?.length) assignee.push({ assigned_to_id: eqOrIn(q.assignedToId) })
  // Resolvido pela IA nunca foi da equipe: sem dono, mas sem nada a atribuir.
  if (q.unassigned) assignee.push({ assigned_to_id: null, ai_resolved: false })
  if (assignee.length) and.push(assignee.length > 1 ? { OR: assignee } : assignee[0])
  if (q.overdue) and.push({ status: { notIn: ['resolved', 'closed'] }, sla_deadline: { lt: new Date() } })
  if (q.mine) and.push(mineWhere(userId))
  if (q.requested) and.push({ user_id: userId })
  if (q.isReopened !== undefined) and.push({ is_reopened: q.isReopened })
  if (q.createdFrom) and.push({ created_at: { gte: q.createdFrom } })
  if (q.createdTo) and.push({ created_at: { lte: q.createdTo } })
  if (q.ids) and.push({ id: { in: q.ids } })
  const s = q.search?.trim()
  if (s) {
    and.push({
      OR: [
        { title: { contains: s, mode: 'insensitive' } },
        { display_number: { contains: s, mode: 'insensitive' } },
        { id: { contains: s, mode: 'insensitive' } },
      ],
    })
  }
  return { AND: and }
}

/** "Fulano (Empresa)" para o histórico de abertura em nome do cliente. */
export async function describeRequester(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, org: { select: { name: true } } },
  })
  if (!user) return 'cliente não encontrado'
  return user.org?.name ? `${user.name} (${user.org.name})` : user.name
}

// Aberturas antigas gravaram só o id do cliente na nota — traduzido na leitura.
const LEGACY_ON_BEHALF_NOTE = /^Chamado aberto em nome do cliente ([0-9a-f-]{36})$/i

export async function resolveLegacyOnBehalfNotes<T extends { note?: string | null }>(events: T[]): Promise<T[]> {
  const ids = [...new Set(events.map(e => e.note?.match(LEGACY_ON_BEHALF_NOTE)?.[1]).filter((id): id is string => !!id))]
  if (!ids.length) return events
  const names = new Map(await Promise.all(ids.map(async id => [id, await describeRequester(id)] as const)))
  return events.map(e => {
    const id = e.note?.match(LEGACY_ON_BEHALF_NOTE)?.[1]
    return id ? { ...e, note: `Chamado aberto em nome de ${names.get(id)}` } : e
  })
}

/**
 * Versão do chamado/mensagens que pode sair para o solicitante: sem notas
 * internas e sem o histórico interno (justificativas de pendência, regras,
 * trocas de fila). O portal do cliente não usa `events`.
 */
export function redactForRequester<T extends { messages?: any[]; events?: any[]; project_task?: { due_date: Date | null } | null }>(ticket: T): T {
  // Projeto/task são internos: o cliente vê só a previsão ("Em projeto · previsão dd/mm").
  const projectTask = ticket.project_task ? { due_date: ticket.project_task.due_date } : ticket.project_task
  return { ...withoutIntakeStatus(ticket), project_task: projectTask, messages: (ticket.messages ?? []).filter(m => m.type !== 'internal'), events: [] } as unknown as T
}
/** Marca interna do agente intake: nunca sai para o solicitante (role 'user'). */
export const withoutIntakeStatus = <T extends object>(row: T): T => {
  const { intake_status: _intake, ...rest } = row as T & { intake_status?: unknown }
  return rest as unknown as T
}
export const publicMessages = <M extends { type: string }>(msgs: M[]) => msgs.filter(m => m.type !== 'internal')
/**
 * O token do link da pesquisa responde como o cliente: no chamado, só o solicitante o
 * recebe. Quem atende envia a pesquisa pela macro ou pelo reenvio, montados no servidor.
 */
export const withoutSurveyToken = <T extends object>(ticket: T): T => {
  const t = ticket as T & { surveyInstance?: any; survey_instance?: any }
  if (!t.surveyInstance && !t.survey_instance) return ticket
  const { linkToken: _token, ...surveyInstance } = t.surveyInstance ?? {}
  const { link_token: _raw, ...survey_instance } = t.survey_instance ?? {}
  return { ...t, surveyInstance, survey_instance }
}

const MESSAGE_TICKET_SELECT = { ...TICKET_ACCESS_SELECT, deleted_at: true, status: true } as const

// Fechado é definitivo também para o que já foi dito (mesma regra do addMessage);
// depois disso só quem modera mexe.
function assertMessageEditable(message: { type: string; ticket: { status: string } }, canModerate: boolean) {
  if (message.ticket.status === 'closed' && !canModerate && (message.type === 'user' || message.type === 'agent')) {
    throw new AppError(400, 'Este chamado está fechado e as mensagens dele não podem mais ser alteradas.', 'TICKET_CLOSED')
  }
}

function sanitizeId(id: any): string | null {
  if (typeof id !== 'string' || id.trim() === '' || id === 'null' || id === 'undefined') return null
  return id
}

export class TicketService {
  private static calculateReopenDeadline(ticket: any, reopenConfig: any, bh: any) {
    const rule = reopenConfig?.reopen_deadline_rule ?? 'org_sla'
    const ruleHours = reopenConfig?.reopen_deadline_hours ?? 8

    const now = new Date()
    if (rule === 'fixed_hours') {
      return addBusinessHours(now, ruleHours, bh, holidaysAround(now))
    }
    if (rule === 'keep_original') {
      return ticket.sla_deadline
    }
    if (rule === 'extra_hours') {
      const original = new Date(ticket.sla_deadline)
      return addBusinessHours(original, ruleHours, bh, holidaysAround(original))
    }
    // Default: 'org_sla'
    const slaHours = ticket.org?.sla_config?.incident_resolution_hours ?? 24
    return addBusinessHours(now, slaHours, bh, holidaysAround(now))
  }

  private static mapTicket(ticket: any, reopenConfig?: any) {
    if (!ticket) return null
    const canReopen = canStillReopen(ticket, reopenConfig)
    return {
      ...ticket,
      canReopen,
      reopenSlaEnabled: ticket.reopen_sla_enabled,
      reopenSlaLimitHours: ticket.reopen_sla_limit_hours,
      categoryId: ticket.category_id,
      subcategoryId: ticket.subcategory_id,
      userId: ticket.user_id,
      createdById: ticket.created_by_id ?? null,
      createdBy: ticket.created_by ?? undefined,
      orgId: ticket.org_id,
      displayNumber: ticket.display_number,
      org: ticket.org ? {
        ...ticket.org,
        slaHours: ticket.org.sla_config?.incident_resolution_hours ?? 24,
        firstResponseHours: ticket.org.sla_config?.incident_first_response_hours ?? 4,
        defaultQueue: ticket.org.sla_config?.default_queue ?? null,
        escalationQueue: ticket.org.sla_config?.escalation_queue ?? null
      } : undefined,
      assignedToId: ticket.assigned_to_id,
      collabQueue: ticket.collab_queue,
      slaDeadline: ticket.sla_deadline,
      slaPausedAt: ticket.sla_paused_at,
      totalPausedMinutes: ticket.total_paused_minutes ?? 0,
      pendingReason: ticket.pending_reason,
      pendingScheduleAt: ticket.pending_schedule_at,
      clientForecastAt: ticket.client_forecast_at ?? null,
      chatEnabled: ticket.chat_enabled,
      is_reopened: ticket.is_reopened,
      aiResolved: ticket.ai_resolved,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      deletedAt: ticket.deleted_at,
      attachmentUrl: presentAttachment(ticket.attachment_url),
      attachments: ticket.attachments?.map((a: any) => ({
        id: a.id,
        ticketId: a.ticket_id,
        name: a.name,
        size: a.size,
        type: a.type,
        url: presentAttachment(a.url),
        createdAt: a.created_at,
      })),
      assignedTo: ticket.assigned_to,
      category: ticket.category,
      subcategory: ticket.subcategory,
      participants: ticket.participants?.map((p: any) => ({
        id: p.id,
        ticketId: p.ticket_id,
        agentId: p.agent_id,
        agent: p.agent,
        role: p.role,
        active: p.active,
        addedAt: p.added_at,
        removedAt: p.removed_at,
      })),
      messages: ticket.messages?.map((m: any) => ({
        ...m,
        ticketId: m.ticket_id,
        userId: m.user_id,
        attachmentUrl: presentAttachment(m.attachment_url),
        isRealtime: m.is_realtime,
        createdAt: m.created_at,
      })),
      events: ticket.events?.map((e: any) => ({
        ...e,
        ticketId: e.ticket_id,
        userId: e.user_id,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        pendingReason: e.pending_reason,
        pendingScheduleAt: e.pending_schedule_at,
        attachmentUrl: presentAttachment(e.attachment_url),
        createdAt: e.created_at,
      })),
      surveyInstance: ticket.survey_instance ? {
        id: ticket.survey_instance.id,
        ticketId: ticket.survey_instance.ticket_id,
        linkToken: ticket.survey_instance.link_token,
        status: ticket.survey_instance.status,
        criadaEm: ticket.survey_instance.criada_em,
        respondidaEm: ticket.survey_instance.respondida_em,
      } : null,
    }
  }

  // Fila padrão e prazos do plano da empresa, contados a partir de agora. Prazos só em
  // horário comercial cadastrado, pulando dias não úteis e feriados nacionais brasileiros.
  private static async planTerms(org: { sla_config?: { incident_resolution_hours: number; incident_first_response_hours: number; default_queue: string | null } | null } | null) {
    // Fila só é aplicada se corresponder a uma Queue real; senão o
    // chamado fica sem fila (null) e aparece para todos os analistas, em vez
    // de cair numa fila fantasma que ninguém tem no escopo.
    const planQueue = org?.sla_config?.default_queue
    const queue = planQueue && await prisma.queue.findUnique({ where: { id: planQueue } }) ? planQueue : null
    const bh = await getBusinessHoursConfig()
    const now = new Date()
    const holidays = holidaysAround(now)
    return {
      queue,
      sla_deadline: addBusinessHours(now, org?.sla_config?.incident_resolution_hours ?? 24, bh, holidays),
      first_response_deadline: addBusinessHours(now, org?.sla_config?.incident_first_response_hours ?? 4, bh, holidays),
    }
  }

  // Chamado resolvido pela IA nunca esteve na fila: ao voltar ganha fila e prazos novos,
  // inclusive com a regra keep_original, cujo prazo original nunca contou. Depois de
  // gravar estes campos, quem chamou roda afterOpen.
  private static async queueEntry(orgId: string | null) {
    const org = orgId ? await prisma.organization.findUnique({ where: { id: orgId }, include: { sla_config: true } }) : null
    return { ...(await this.planTerms(org)), ai_resolved: false }
  }

  // aiResolution: a IA resolveu antes de existir atendimento. O chamado nasce
  // resolvido, fora da fila, e nada do que a abertura dispara acontece aqui; o que ficou
  // para trás roda em afterOpen se ele for reaberto. Os anexos além do primeiro são gravados
  // aqui, sem addMessage: mensagem em chamado resolvido reabre e avisa.
  static async createTicket(data: any, creatorId?: string) {
    // attachments: anexos já enviados ao blob, gravados junto com o chamado para
    // que o webhook ticket.created (que relê o chamado) já os encontre.
    const { org_id, auditNote, attachments, aiResolution, ...rest } = data

    // Chamados especiais (ex: onboarding/offboarding): a subcategoria define um
    // formulário estruturado que substitui título/descrição livres.
    const subcategoryId = sanitizeId(rest.subcategory_id ?? rest.subcategoryId)
    const subcategory = subcategoryId
      ? await prisma.subcategory.findUnique({ where: { id: subcategoryId } })
      : null

    // Subcategoria precisa pertencer à categoria do chamado. Sem categoria
    // informada, herda a da subcategoria (integrações que mandam só a sub).
    if (subcategory) {
      const categoryId = sanitizeId(rest.category_id)
      if (!categoryId) rest.category_id = subcategory.category_id
      else if (categoryId !== subcategory.category_id) {
        throw new AppError(400, 'A subcategoria não pertence à categoria informada', 'SUBCATEGORY_CATEGORY_MISMATCH')
      }
    }

    if (subcategory?.is_special) {
      const schema: Array<{
        key: string
        label: string
        required: boolean
        type?: string
        multiple?: boolean
        options?: Array<{ value: string; label: string }>
      }> =
        (subcategory.special_form_schema as any) ?? []
      const submitted = rest.special_data && typeof rest.special_data === 'object' ? rest.special_data : {}

      const missing = schema.filter((f) => {
        if (!f.required) return false
        const value = submitted[f.key]
        return Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim()
      })
      if (missing.length > 0) {
        throw new AppError(
          400,
          `Campos obrigatórios não preenchidos: ${missing.map((f) => f.label).join(', ')}`,
          'SPECIAL_FORM_MISSING_FIELDS',
        )
      }

      // Mantém apenas as chaves declaradas no formulário — evita persistir dados arbitrários.
      const cleanData: Record<string, string | string[]> = {}
      for (const f of schema) {
        if (submitted[f.key] === undefined) continue

        if (f.type === 'select') {
          if (!f.multiple && Array.isArray(submitted[f.key])) {
            throw new AppError(400, `Mais de uma opção enviada para o campo ${f.label}`, 'SPECIAL_FORM_INVALID_VALUE')
          }
          const rawValues = f.multiple
            ? submitted[f.key]
            : [submitted[f.key]]
          const values = Array.isArray(rawValues) ? rawValues : []
          const normalized = values
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim())

          if (f.multiple && !Array.isArray(submitted[f.key])) {
            throw new AppError(400, `Lista inválida para o campo ${f.label}`, 'SPECIAL_FORM_INVALID_VALUE')
          }
          if (normalized.length !== values.length || normalized.some(value => !value)) {
            throw new AppError(400, `Lista inválida para o campo ${f.label}`, 'SPECIAL_FORM_INVALID_VALUE')
          }
          if (f.options && normalized.some(value => !f.options!.some(option => option.value === value))) {
            throw new AppError(400, `Opção inválida para o campo ${f.label}`, 'SPECIAL_FORM_INVALID_OPTION')
          }
          cleanData[f.key] = f.multiple ? normalized : normalized[0]
          continue
        }

        cleanData[f.key] = String(submitted[f.key])
      }

      rest.special_data = cleanData
      rest.title = (subcategory.special_title_template || subcategory.name).replace(
        /\{(\w+)\}/g,
        (_match: string, key: string) => {
          const value = cleanData[key]
          return Array.isArray(value) ? value.join(', ') : value ?? ''
        },
      )
      rest.description = null
    } else {
      if (!rest.title || !String(rest.title).trim()) {
        throw new AppError(400, 'Título é obrigatório', 'TITLE_REQUIRED')
      }
      if (!rest.description || !String(rest.description).trim()) {
        throw new AppError(400, 'Descrição é obrigatória', 'DESCRIPTION_REQUIRED')
      }
      delete rest.special_data
    }

    // Anexo: se vier base64, sobe ao blob e guarda só o nome do blob no banco.
    rest.attachment_url = await storeAttachment(rest.attachment_url)
    // Número atômico (migration ticket_number_seq): aberturas simultâneas não
    // colidem e o número de um chamado expurgado nunca é reemitido. O laço só
    // pula ids já ocupados (ex.: chamado gravado por fora da sequência).
    const id = await this.nextTicketId()
    const numericPart = id.replace(/\D/g, '')
    const displayNumber = `INC-${numericPart}`

    // Buscar configurações de SLA da organização
    const org = org_id ? await prisma.organization.findUnique({ where: { id: org_id }, include: { sla_config: true } }) : null
    // Bloquear se o contrato/plano de SLA estiver vencido
    if (org?.expires_at && org.expires_at < new Date()) {
      throw new AppError(
        403,
        org.expiry_message || 'Abertura de chamados bloqueada: O plano de SLA desta empresa está vencido.',
        'SLA_PLAN_EXPIRED'
      )
    }
    // Fila pedida segue a mesma regra: sem Queue real, vale a padrão da empresa.
    if (rest.queue && !(await prisma.queue.findUnique({ where: { id: rest.queue }, select: { id: true } }))) rest.queue = undefined

    const terms = await this.planTerms(org)

    if (!rest.priority) {
      rest.priority = 'high'
    }

    const row = {
      ...rest,
      id,
      org_id,
      type: 'incident',
      display_number: displayNumber,
      // Só marca created_by_id quando quem abriu não é o próprio solicitante
      // (abertura em nome de cliente); caso normal permanece null.
      created_by_id: creatorId && creatorId !== rest.user_id ? creatorId : null,
      sla_deadline: terms.sla_deadline,
      ...(attachments?.length ? { attachments: { create: attachments } } : {}),
    }

    if (aiResolution) {
      const extras: { name: string; url: string }[] = aiResolution.extraAttachments ?? []
      const stored = await Promise.all(extras.map(a => storeAttachment(a.url)))
      const resolvedAt = new Date()
      // Numa transação só: chamado sem vínculo com a interação permitiria aceitar de novo.
      await prisma.$transaction([
        prisma.ticket.create({
          data: { ...row, status: 'resolved', ai_resolved: true, resolved_at: resolvedAt, resolution_details: aiResolution.details, queue: null },
        }),
        prisma.ticketEvent.create({ data: { ticket_id: id, user_id: rest.user_id, to_status: 'resolved', note: aiResolution.note } }),
        prisma.ticketMessage.createMany({
          data: extras.map((a, i) => ({
            ticket_id: id,
            user_id: rest.user_id,
            type: 'user' as const,
            text: `Anexo adicional: ${a.name}`,
            attachment_url: stored[i],
            // A conversa ordena por data: anexos na ordem de envio, antes da resolução.
            created_at: new Date(resolvedAt.getTime() - (extras.length - i)),
          })),
        }),
        prisma.aiInteraction.update({ where: { id: aiResolution.interactionId }, data: { ticket_id: id } }),
      ])
      const [resolved, reopenConfig] = await Promise.all([
        prisma.ticket.findUnique({ where: { id }, include: { category: true, subcategory: true } }),
        prisma.reopenSlaConfig.findFirst(),
      ])
      return this.mapTicket(resolved, reopenConfig)
    }

    await prisma.ticket.create({
      data: {
        ...row,
        status: 'open',
        queue: rest.queue || terms.queue,
        first_response_deadline: terms.first_response_deadline,
      }
    })

    // Auditoria da abertura: quem abriu, para quem, e quando.
    await prisma.ticketEvent.create({
      data: {
        ticket_id: id,
        user_id: creatorId || rest.user_id,
        to_status: 'open',
        note: auditNote || (creatorId && creatorId !== rest.user_id ? `Chamado aberto em nome de ${await describeRequester(rest.user_id)}` : null),
      },
    }).catch((err) => console.error('[TicketService] Erro ao registrar evento de criação:', err))

    return this.afterOpen(id)
  }

  /** Próximo número de chamado (sequência atômica; pula ids já ocupados). */
  static async nextTicketId() {
    let id: string
    do {
      const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('ticket_number_seq') AS n`
      id = `ISA-${String(n).padStart(4, '0')}`
    } while (await prisma.ticket.findUnique({ where: { id }, select: { id: true } }))
    return id
  }

  // Tudo que a entrada de um chamado na fila dispara: regras, cadeia de IA, avisos à
  // equipe, webhook e e-mail de abertura.
  private static async afterOpen(id: string) {
    await this.runTrigger(id, 'ticket_created')

    // IA (backend/src/ai): em segundo plano — não atrasa nem derruba a abertura.
    // Intake depois da triagem: no modo apply a triagem pode corrigir tipo/subcategoria,
    // que escolhem o checklist. Nenhum dos dois lança.
    void triageTicket(id)
      .catch(err => console.error('[AI:triage] falhou:', err?.message ?? err))
      .then(() => intakeTicket(id))
      .catch(err => console.error('[AI:intake] falhou:', err?.message ?? err))
      .then(() => guidanceTicket(id))
      .catch(err => console.error('[AI:guidance] falhou:', err?.message ?? err))

    const [reloaded, reopenConfig] = await Promise.all([
      prisma.ticket.findUnique({
        where: { id },
        include: { category: true, subcategory: true },
      }),
      prisma.reopenSlaConfig.findFirst()
    ])

    // Notifica agentes da fila sobre o novo chamado. Sem fila definida, notifica
    // todos os agentes/supervisores (mesma regra de visibilidade da listagem).
    if (reloaded) {
      console.log(`[new_ticket] queue="${reloaded.queue}" ticket="${reloaded.id}"`)
      const agents = await prisma.user.findMany({
        where: {
          role: { in: ['agent', 'supervisor', 'admin'] },
          ...(reloaded.queue ? { queues: { has: reloaded.queue } } : {}),
          active: true,
          deleted_at: null,
          id: { not: reloaded.user_id },
        },
        select: { id: true },
      })
      console.log(`[new_ticket] agentes encontrados: ${agents.length}`, agents.map(a => a.id))
      const queueLabel = reloaded.queue
        ? (await prisma.queue.findUnique({ where: { id: reloaded.queue }, select: { name: true } }))?.name ?? reloaded.queue
        : null
      for (const agent of agents) {
        NotificationService.create({
          userId: agent.id,
          ticketId: reloaded.id,
          type: 'new_ticket',
          title: reloaded.title,
          body: `Novo chamado aberto na fila ${queueLabel}`,
        })
      }
      // Broadcast direto ao room da fila — garante popup em tempo real mesmo sem DB match
      if (reloaded.queue) {
        NotificationService.broadcastQueueAlert({
          queueId: reloaded.queue,
          ticketId: reloaded.id,
          title: reloaded.title,
          body: `Novo chamado aberto na fila ${queueLabel}`,
          type: 'new_ticket',
          excludeUserId: reloaded.user_id,
        })
      }
    }

    const mapped = this.mapTicket(reloaded, reopenConfig)
    if (mapped) {
      this.broadcastTicketUpdate(mapped.id, 'ticket:created')
      emitWebhookEvent('ticket.created', { ticket: buildTicketPayload(mapped) })
      // E-mail de confirmação em segundo plano: falha no envio não derruba a abertura.
      void notifyTicketCreated(mapped.id).catch(err => console.error('[Email] confirmação de abertura falhou:', err?.message ?? err))
    }
    return mapped
  }

  static async getTickets(filters: any) {
    const where: any = { deleted_at: null }
    if (filters.status) where.status = filters.status
    if (filters.user_id) where.user_id = filters.user_id
    if (filters.org_id) where.org_id = filters.org_id
    if (filters.category_id) where.category_id = filters.category_id
    if (filters.queue) where.queue = filters.queue
    if (filters.is_reopened !== undefined) where.is_reopened = filters.is_reopened
    if (filters.OR) where.OR = filters.OR

    // Escopo: carteira OU envolvimento direto (mesma regra do getTicketAccess).
    // Aplicado com AND para que filtros explícitos (org_id, fila) nunca furem o escopo.
    const scope = filters.scope
    if (scope) {
      const visibility = ticketVisibilityWhere(filters.scope_user_id, scope)
      if (Object.keys(visibility).length) where.AND = [...(where.AND || []), visibility]
    }

    if (filters.supervisor_id) {
      // Find all subordinates of this supervisor
      const subordinates = await prisma.user.findMany({
        where: { manager_id: filters.supervisor_id, deleted_at: null },
        select: { id: true }
      })
      const subordinateIds = subordinates.map(s => s.id)

      // Also include the supervisor themselves if they have tickets assigned
      subordinateIds.push(filters.supervisor_id)

      where.OR = [
        { assigned_to_id: { in: subordinateIds } },
        { assigned_to_id: null },
        // Chamados onde o supervisor é participante (atuação unificada)
        { participants: { some: { agent_id: filters.supervisor_id, active: true } } },
      ]
    }

    const take = filters.limit ?? 100
    const skip = filters.offset ?? 0

    const [tickets, reopenConfig] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take,
        skip,
        include: LIST_INCLUDE,
      }),
      prisma.reopenSlaConfig.findFirst()
    ])
    return { data: tickets.map(t => this.toListRow(t, reopenConfig)) }
  }

  private static toListRow(t: any, reopenConfig: any) {
    return {
      ...this.mapTicket(t, reopenConfig),
      latestMessage: t.messages[0]
        ? { id: t.messages[0].id, userId: t.messages[0].user_id, createdAt: t.messages[0].created_at }
        : null,
    }
  }

  /**
   * Listagem paginada no servidor: filtros + busca + ordenação aplicados no banco,
   * só a página pedida trafega. `where` já vem com escopo/visibilidade aplicados.
   */
  static async getTicketsPage(where: any, opts: { page: number; pageSize: number; sort: TicketListSort; dir: 'asc' | 'desc' }) {
    const { page, pageSize, sort, dir } = opts
    const skip = (page - 1) * pageSize
    const prismaOrder = PRISMA_SORTS[sort]

    let ids: string[] | null = null
    let total: number
    if (prismaOrder) {
      total = await prisma.ticket.count({ where })
    } else {
      // Ordenações calculadas (urgência, status c/ reaberto, nome da fila, responsável
      // efetivo) não cabem em ORDER BY do Prisma: ordena linhas leves em memória.
      // Carrega id+campos de ordenação de todo o resultado filtrado; trocar por
      // SQL com CASE se o volume filtrado passar de dezenas de milhares.
      const light = await prisma.ticket.findMany({
        where,
        select: {
          id: true, status: true, priority: true, sla_deadline: true, created_at: true,
          assigned_to_id: true, queue: true, is_reopened: true,
          assigned_to: { select: { name: true } },
          participants: { where: { active: true, role: 'collaborator' }, select: { agent: { select: { name: true } } }, take: 1 },
        },
      })
      const queueNames = sort === 'queue'
        ? new Map((await prisma.queue.findMany({ select: { id: true, name: true } })).map(q => [q.id, q.name]))
        : new Map<string, string>()
      const now = Date.now()
      const key = (t: typeof light[number]): number | string | null => {
        switch (sort) {
          case 'urgency': return urgencyScore(t, now) * 1e13 + t.sla_deadline.getTime()
          case 'status': return t.is_reopened ? -1 : STATUS_ORDER[t.status]
          case 'queue': return t.queue ? queueNames.get(t.queue) ?? null : null
          case 'assignee': return t.participants[0]?.agent.name ?? t.assigned_to?.name ?? null
          case 'portal': return t.status === 'pending' ? 0 : ['open', 'in_progress'].includes(t.status) ? 1 : 2
          default: return null
        }
      }
      const sign = dir === 'desc' ? -1 : 1
      const sorted = light
        .map(t => ({ t, k: key(t) }))
        .sort((a, b) => {
          // Vazios sempre no fim; empate → mais recente primeiro
          if (a.k == null || b.k == null) return a.k == null && b.k == null ? 0 : a.k == null ? 1 : -1
          const c = typeof a.k === 'number' && typeof b.k === 'number'
            ? a.k - b.k
            : String(a.k).localeCompare(String(b.k), 'pt-BR', { numeric: true, sensitivity: 'base' })
          return c * sign || b.t.created_at.getTime() - a.t.created_at.getTime()
        })
      total = sorted.length
      ids = sorted.slice(skip, skip + pageSize).map(s => s.t.id)
    }

    const [rows, reopenConfig] = await Promise.all([
      ids
        ? prisma.ticket.findMany({ where: { id: { in: ids } }, include: LIST_INCLUDE })
        : prisma.ticket.findMany({ where, orderBy: prismaOrder!(dir), skip, take: pageSize, include: LIST_INCLUDE }),
      prisma.reopenSlaConfig.findFirst(),
    ])
    if (ids) {
      const pos = new Map(ids.map((id, i) => [id, i]))
      rows.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
    }
    return { data: rows.map(t => this.toListRow(t, reopenConfig)), total, page, pageSize }
  }

  /**
   * Contadores da sidebar: chamados ativos (aberto/em atendimento) — total, meus e por fila
   * (chave = id da fila) — mais `status_<status>` com todos os status, para os cards do portal.
   */
  static async getTicketCounts(where: any, userId: string) {
    const active = { ...where, status: { in: ['open', 'in_progress'] } }
    const [total, my, byQueue, byCollab, byStatus] = await Promise.all([
      prisma.ticket.count({ where: active }),
      prisma.ticket.count({ where: { AND: [active, mineWhere(userId)] } }),
      prisma.ticket.groupBy({ by: ['queue'], where: active, _count: { _all: true } }),
      // Fila colaboradora conta junto (mesmo critério do filtro da lista), sem contar duas vezes.
      prisma.ticket.groupBy({ by: ['collab_queue', 'queue'], where: { AND: [active, { collab_queue: { not: null } }] }, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ])
    const counts: Record<string, number> = { total, my }
    for (const g of byQueue) if (g.queue) counts[g.queue] = g._count._all
    for (const g of byCollab) if (g.collab_queue && g.collab_queue !== g.queue) counts[g.collab_queue] = (counts[g.collab_queue] ?? 0) + g._count._all
    for (const g of byStatus) counts[`status_${g.status}`] = g._count._all
    return counts
  }

  /** Contagem por status agrupada por responsável, solicitante ou empresa: `{ [id]: { [status]: n } }`. */
  static async getGroupedCounts(where: any, by: 'assignee' | 'requester' | 'org') {
    const field = ({ assignee: 'assigned_to_id', requester: 'user_id', org: 'org_id' } as const)[by]
    const groups = await prisma.ticket.groupBy({ by: [field, 'status'], where, _count: { _all: true } })
    const out: Record<string, Record<string, number>> = {}
    for (const g of groups as any[]) {
      const id = g[field]
      if (!id) continue
      ;(out[id] ??= {})[g.status] = g._count._all
    }
    return out
  }

  /**
   * Linhas leves (id, título, última mensagem) para não-lidos e sino, sem baixar a lista.
   * Janela de 30 dias / 500 chamados; ampliar se aparecer não-lido "perdido".
   */
  static async getTicketActivity(where: any) {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const rows = await prisma.ticket.findMany({
      where: { AND: [where, { updated_at: { gte: since } }] },
      orderBy: { updated_at: 'desc' },
      take: 500,
      select: {
        id: true, title: true, display_number: true,
        messages: { where: { type: { not: 'internal' } }, orderBy: { created_at: 'desc' }, take: 1, select: { id: true, user_id: true, created_at: true } },
      },
    })
    return rows.map(t => ({
      id: t.id,
      title: t.title,
      displayNumber: t.display_number,
      latestMessage: t.messages[0] ? { id: t.messages[0].id, userId: t.messages[0].user_id, createdAt: t.messages[0].created_at } : null,
    }))
  }


  static async getTicketById(id: string) {
    const [ticket, reopenConfig] = await Promise.all([
      prisma.ticket.findUnique({
        where: { id },
        include: {
          category: true,
          subcategory: true,
          user: { select: { id: true, name: true, email: true, avatar: true } },
          created_by: { select: { id: true, name: true, email: true, avatar: true } },
          org: { include: { sla_config: true } },
          assigned_to: { select: { id: true, name: true, avatar: true } },
          // Ponte chamado ↔ task: o que o detalhe mostra do vínculo (o solicitante só vê o prazo — ver redactForRequester).
          project_task: {
            select: { id: true, seq: true, key: true, title: true, due_date: true, project_id: true, project: { select: { name: true } }, status: { select: { name: true, category: true } } },
          },
          messages: {
            orderBy: { created_at: 'asc' },
            include: { user: { select: { id: true, name: true, avatar: true } } },
          },
          attachments: true,
          participants: {
            where: { active: true },
            include: { agent: { select: { id: true, name: true, avatar: true } } },
          },
          events: {
            orderBy: { created_at: 'desc' },
            include: { user: { select: { id: true, name: true } } },
          },
          survey_instance: true,
        },
      }),
      prisma.reopenSlaConfig.findFirst()
    ])
    // Excluído (na Lixeira) não existe para o resto do sistema.
    if (!ticket || ticket.deleted_at) return null
    if (ticket.events) ticket.events = await resolveLegacyOnBehalfNotes(ticket.events)
    return this.mapTicket(ticket, reopenConfig)
  }

  static async broadcastTicketUpdate(ticketId: string, event: 'ticket:created' | 'ticket:updated' = 'ticket:updated', oldQueue?: string | null, oldAssigneeId?: string | null) {
    try {
      const ticket = await this.getTicketById(ticketId)
      if (!ticket) return

      const io = getIo()
      if (!io) return

      const rooms = new Set<string>()
      rooms.add(`ticket:${ticketId}`)
      rooms.add(`queue:${ticket.queue}`)
      if (oldQueue && oldQueue !== ticket.queue) rooms.add(`queue:${oldQueue}`)
      if (ticket.user_id) rooms.add(`user:${ticket.user_id}`)
      if (ticket.userId) rooms.add(`user:${ticket.userId}`)
      if (ticket.assigned_to_id) rooms.add(`user:${ticket.assigned_to_id}`)
      if (ticket.assignedToId) rooms.add(`user:${ticket.assignedToId}`)
      // Notifica também o responsável ANTERIOR para que a contagem
      // de "Meus Chamados" dele decremente em tempo real ao perder o chamado.
      if (oldAssigneeId) rooms.add(`user:${oldAssigneeId}`)
      rooms.add('role:supervisor')
      rooms.add('role:manager')
      rooms.add('role:admin')

      // Entrega por socket: só quem tem acesso ao chamado recebe, e o solicitante
      // recebe sem notas internas. Quem perdeu o acesso (fila/responsável
      // anterior) recebe só a remoção, para o chamado sair da lista dele.
      const { allowed, denied, requesterView } = await socketsByTicketAccess(io, [...rooms], ticket)
      const forRequester = redactForRequester(ticket)
      const forStaff = withoutSurveyToken(ticket)
      for (const s of allowed) s.emit(event, requesterView.has(s) ? forRequester : s.data.userId === ticket.user_id ? ticket : forStaff)
      const leftRooms = [oldQueue && oldQueue !== ticket.queue && `queue:${oldQueue}`, oldAssigneeId && `user:${oldAssigneeId}`].filter(Boolean) as string[]
      for (const s of denied) {
        if (s.rooms.has(`ticket:${ticketId}`)) s.leave?.(`ticket:${ticketId}`)
        if (leftRooms.some(r => s.rooms.has(r))) s.emit('ticket:deleted', { id: ticketId })
      }
    } catch (err) {
      console.error(`[Socket] Error broadcasting ticket ${ticketId}:`, err)
    }
  }

  // Sala do chamado: acesso reavaliado na entrega, porque a sala só confere quem entra
  // (ticket:join) e a pessoa pode perder o acesso com o chamado aberto. O custo acompanha
  // os poucos sockets com este chamado aberto. Quem perdeu o acesso sai da sala; nota
  // interna não vai para quem vê como cliente.
  private static async emitToTicketRoom(ticket: TicketLike, event: string, payload: unknown, internal = false) {
    const io = getIo()
    if (!io) return
    const room = `ticket:${ticket.id}`
    try {
      const { allowed, denied, requesterView } = await socketsByTicketAccess(io, [room], ticket)
      for (const s of denied) s.leave?.(room)
      for (const s of allowed) if (!internal || !requesterView.has(s)) s.emit(event, payload)
    } catch (err) {
      console.error(`[Socket] Error emitting ${event} on ${room}:`, err)
    }
  }

  // Avisa o solicitante por e-mail (status e respostas), agrupando o que
  // acontecer em sequência num único e-mail. Não avisa quando o próprio
  // solicitante causou a atualização (ex.: ele mesmo reabriu ou respondeu).
  static notifyRequester(ticket: { id: string; user_id: string }, actorId: string, update: RequesterUpdate) {
    if (actorId === ticket.user_id) return
    if (update.kind === 'status' && update.from === update.to) return
    queueRequesterUpdate(ticket.id, update)
  }

  // Regras de automação nunca derrubam a operação que as disparou.
  private static async runTrigger(ticketId: string, trigger: RoutingTrigger) {
    try {
      await runRoutingRules(ticketId, trigger)
    } catch (err) {
      console.error(`[TicketService] Erro ao aplicar regras (${trigger}):`, err)
    }
  }

  // opts.origin 'routing': alteração feita por regra de automação — não reavalia
  // o gatilho "chamado atualizado" (evita loop) nem limpa a marca de reaberto.
  // opts.origin 'escalation': aplicada por regra de escalonamento — quem pode escalonar já
  // foi checado (EscalationService) e o destino ganha acesso pelo escalonamento, então
  // não vale a trava de "só o responsável altera" nem a carteira do novo responsável.
  static async updateTicket(id: string, actorId: string, actorRole: string, data: any, opts: { origin?: 'routing' | 'escalation' } = {}) {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { category: true, subcategory: true, assigned_to: { select: { name: true } }, user: { select: { name: true } } }
    })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')

    // Admin tem acesso somente leitura a chamados — não atua sobre eles.
    if (actorRole === 'admin') throw adminReadOnly()

    // Analista resolve (regras de responsável/colaborador mais abaixo). Ticket Manager
    // (supervisor) e Gerente (manager) atendem como o analista: resolvem o chamado que
    // assumiram (inclusive assumindo na mesma ação). Apenas TM e Gerente fecham manualmente.
    // Admin é somente leitura — não resolve nem fecha.
    // 'system' (jobs automáticos, API externa) já é tratado como confiável mais abaixo para 'closed' — reconhecido aqui também.
    if (data.status === 'resolved') {
      if (actorRole === 'supervisor' || actorRole === 'manager') {
        const assignee = data.assigned_to_id !== undefined ? data.assigned_to_id : ticket.assigned_to_id
        if (assignee !== actorId) {
          throw forbidden('ROLE_CANNOT_RESOLVE', `Como ${roleLabel(actorRole)} você resolve os chamados que assumiu (responsável: ${ticket.assigned_to?.name ?? 'ninguém'}). Assuma o chamado atribuindo-o a você, ou deixe o responsável resolver.`)
        }
      } else if (actorRole !== 'agent' && actorRole !== 'system') {
        throw forbidden('ROLE_CANNOT_RESOLVE', `Seu perfil é ${roleLabel(actorRole)} e não resolve chamados.`)
      }
    }
    if (data.status === 'closed') {
      if (actorRole !== 'supervisor' && actorRole !== 'manager' && actorRole !== 'system') {
        throw forbidden('ROLE_CANNOT_CLOSE', `Só Ticket Manager e Gerente fecham chamados manualmente. Seu perfil é ${roleLabel(actorRole)}: marque o chamado como resolvido e o fechamento é feito pelo gestor ou automaticamente.`)
      }
    }

    const { status, priority, assigned_to_id, queue, note, categoryId, category_id, subcategoryId, subcategory_id, resolution_details, reopen_sla_enabled, reopen_sla_limit_hours, sla_deadline, chat_enabled, pending_reason, pending_evidence_url, pending_schedule_at, client_forecast_at, type, requesterId } = data
    const updateData: any = {}

    let newRequester: { id: string; name: string; org_id: string | null } | null = null

    if (reopen_sla_enabled !== undefined || reopen_sla_limit_hours !== undefined || sla_deadline !== undefined) {
      if (actorRole !== 'admin') {
        throw forbidden('SLA_NOT_EDITABLE', 'O SLA e os prazos do chamado são calculados pelo plano de SLA da empresa e não podem ser ajustados no atendimento. Para mudar os tempos, o administrador ajusta o plano da empresa em Planos & SLA.')
      }
    }

    if (sla_deadline !== undefined) {
      if (!sla_deadline) {
        throw new AppError(400, 'O prazo de SLA não pode ser vazio', 'BAD_REQUEST')
      }
      updateData.sla_deadline = new Date(sla_deadline)
    }

    // Nova previsão para o cliente: não mexe no prazo do plano nem nos números de SLA.
    if (client_forecast_at !== undefined) {
      const date = client_forecast_at ? new Date(client_forecast_at) : null
      if (date && date.getTime() <= Date.now()) throw new AppError(400, 'A previsão precisa ser uma data futura', 'FORECAST_IN_PAST')
      if (['resolved', 'closed'].includes(ticket.status)) throw new AppError(400, 'Chamado encerrado não recebe nova previsão', 'TICKET_FINISHED')
      updateData.client_forecast_at = date
    }

    // Troca de tipo de chamado: não mexe em priority. Lógica
    // compartilhada com as regras de automação (./routing) em ./ticketTypeChange.
    if (type && type !== ticket.type) {
      const change = await computeTicketTypeChange(ticket, type)
      updateData.type = change.type
      updateData.display_number = change.display_number
      updateData.first_response_deadline = change.first_response_deadline
      // Só recalcula o prazo se o chamador não tiver enviado um sla_deadline
      // explícito no mesmo payload — evita que a troca de tipo sobrescreva
      // silenciosamente um ajuste manual de prazo feito pelo admin.
      if (sla_deadline === undefined) {
        updateData.sla_deadline = change.sla_deadline
      }
    }

    // Colaborador ativo (escalonado) é co-responsável: mesmas permissões do
    // responsável, exceto trocar o responsável principal. Agente não envolvido
    // só pode assumir o chamado (autoatribuição) e mudar o status junto.
    if (actorRole === 'agent' && actorId !== ticket.assigned_to_id && opts.origin !== 'escalation') {
      const collaborator = await prisma.ticketParticipant.findUnique({
        where: { ticket_id_agent_id: { ticket_id: id, agent_id: actorId } },
      })
      const isCollaborator = collaborator && collaborator.active && collaborator.role === 'collaborator'
      const ownerName = ticket.assigned_to?.name ?? 'sem responsável'

      if (!isCollaborator) {
        const isSelfAssign = assigned_to_id === actorId
        const touchesOtherFields =
          priority !== undefined || queue !== undefined ||
          categoryId !== undefined || category_id !== undefined ||
          subcategoryId !== undefined || subcategory_id !== undefined ||
          reopen_sla_enabled !== undefined || reopen_sla_limit_hours !== undefined ||
          client_forecast_at !== undefined || type !== undefined || requesterId !== undefined

        if (!isSelfAssign || touchesOtherFields) {
          throw forbidden('NOT_TICKET_OWNER', `Você não é o responsável nem colaborador deste chamado (responsável: ${ownerName}). Para alterá-lo, assuma o chamado atribuindo-o a você, ou peça para ser escalonado como colaborador.`)
        }
      } else if (assigned_to_id !== undefined && assigned_to_id !== ticket.assigned_to_id) {
        throw forbidden('COLLABORATOR_CANNOT_REASSIGN', `Como colaborador você pode alterar e resolver este chamado, mas não trocar o responsável principal (${ownerName}). Peça ao responsável ou a um gestor.`)
      }
    }

    if (requesterId !== undefined) {
      if (actorRole !== 'agent' && actorRole !== 'supervisor' && actorRole !== 'manager') {
        throw roleDenied(['agent', 'supervisor', 'manager'], actorRole, 'Trocar o requisitante')
      }
      if (ticket.status === 'closed') {
        throw new AppError(400, 'Chamado fechado não permite troca de requisitante', 'TICKET_CLOSED_REQUESTER_LOCKED')
      }
      const candidate = await prisma.user.findFirst({
        where: { id: requesterId, role: 'user', active: true, deleted_at: null },
        select: { id: true, name: true, org_id: true },
      })
      if (!candidate) {
        throw new AppError(404, 'Novo requisitante não encontrado', 'REQUESTER_NOT_FOUND')
      }
      const scope = await getEffectiveScope(actorId, actorRole)
      if (!canSeeOrg(scope, candidate.org_id)) {
        const candidateOrg = candidate.org_id ? await prisma.organization.findUnique({ where: { id: candidate.org_id }, select: { name: true } }) : null
        throw forbidden('REQUESTER_OUT_OF_SCOPE', `O novo requisitante é da empresa ${candidateOrg?.name ?? '(sem empresa)'}, que não está na sua carteira. Só é possível trocar para clientes das empresas que você atende.`)
      }
      newRequester = candidate
      updateData.user_id = candidate.id
      updateData.org_id = candidate.org_id
    }

    const pendingReasonChange = status === 'pending' && ticket.status === 'pending' && !!pending_reason && pending_reason !== ticket.pending_reason
    // Resolvido pela IA: voltando à ativa, entra na fila; enquanto não volta, nada avisa ninguém.
    const entersQueue = ticket.ai_resolved && ['open', 'in_progress', 'pending'].includes(status)
    const quiet = ticket.ai_resolved && !entersQueue
    if (status) {
      if (['open', 'in_progress', 'pending'].includes(status) && ['resolved', 'closed'].includes(ticket.status)) {
        const reopenConfig = await prisma.reopenSlaConfig.findFirst()
        const enabled = ticket.reopen_sla_enabled !== null ? ticket.reopen_sla_enabled : (reopenConfig?.enabled ?? true)
        const limitHours = ticket.reopen_sla_limit_hours !== null ? ticket.reopen_sla_limit_hours : (reopenConfig?.reopen_limit_hours ?? 24)
        if (enabled) {
          const referenceDate = ticket.resolved_at || ticket.closed_at || ticket.updated_at
          if (referenceDate) {
            const elapsedHours = (Date.now() - new Date(referenceDate).getTime()) / 3600000
            if (elapsedHours > limitHours) {
              throw new AppError(400, 'O prazo limite de reabertura deste chamado expirou.', 'BAD_REQUEST')
            }
          }
        }
      }

      // Mandatory resolution details for agents closing/resolving
      if ((status === 'resolved' || status === 'closed') && actorRole === 'agent') {
        if (!resolution_details || resolution_details.trim().length < 10) {
          throw new AppError(400, 'Detalhamento da resolução é obrigatório (mínimo 10 caracteres)', 'BAD_REQUEST')
        }
      }

      updateData.status = status
      if (entersQueue) Object.assign(updateData, await this.queueEntry(ticket.org_id), { resolved_at: null, closed_at: null })

      // ── SLA Pause tracking ──────────────────────────────────────────────
      // Ao entrar em "pending": registrar o instante da pausa. Exige tipo de
      // pendência, justificativa e evidência para rastreabilidade.
      // Troca de subpendência (já pendente, outro tipo): mesmas exigências,
      // mas a pausa de SLA continua desde a entrada original.
      if ((status === 'pending' && ticket.status !== 'pending') || pendingReasonChange) {
        if (!pending_reason) {
          throw new AppError(400, 'Selecione o tipo de pendência', 'BAD_REQUEST')
        }
        if (!note || note.trim().length === 0) {
          throw new AppError(400, 'Justificativa é obrigatória ao colocar o chamado como pendente', 'BAD_REQUEST')
        }
        let scheduleDate: Date | null = null
        if (pending_reason === 'pending_schedule') {
          scheduleDate = pending_schedule_at ? new Date(pending_schedule_at) : null
          if (!scheduleDate || isNaN(scheduleDate.getTime())) {
            throw new AppError(400, 'Informe a data/hora do agendamento', 'BAD_REQUEST')
          }
          if (scheduleDate.getTime() <= Date.now()) {
            throw new AppError(400, 'A data/hora do agendamento deve estar no futuro', 'BAD_REQUEST')
          }
        }
        if (!pendingReasonChange) updateData.sla_paused_at = new Date()
        updateData.pending_reason = pending_reason
        updateData.pending_schedule_at = scheduleDate
      }

      // Ao sair de "pending": estender o prazo de SLA pelo tempo útil pausado
      // e acumular o total de minutos pausados para auditoria.
      if (ticket.status === 'pending' && status !== 'pending') {
        updateData.sla_paused_at = null
        updateData.pending_reason = null
        updateData.pending_schedule_at = null
        const lastPendingEvent = await prisma.ticketEvent.findFirst({
          where: {
            ticket_id: id,
            to_status: 'pending',
            // Ignora pending→pending (troca de subpendência, prioridade etc.): a pausa começou na entrada.
            OR: [{ from_status: null }, { from_status: { not: 'pending' } }],
          },
          orderBy: {
            created_at: 'desc'
          }
        })
        if (lastPendingEvent) {
          const bh = await getBusinessHoursConfig()
          const now = new Date()
          const holidays = holidaysAround(now)
          const businessMinutes = getBusinessMinutesBetween(lastPendingEvent.created_at, now, bh, holidays)
          updateData.total_paused_minutes = (ticket.total_paused_minutes ?? 0) + businessMinutes
          if (businessMinutes > 0) {
            const businessHours = businessMinutes / 60
            updateData.sla_deadline = addBusinessHours(ticket.sla_deadline, businessHours, bh, holidays)
            if (ticket.first_response_deadline) {
              updateData.first_response_deadline = addBusinessHours(ticket.first_response_deadline, businessHours, bh, holidays)
            }
          }
        }
      }

      if (status === 'resolved' && ticket.status !== 'resolved') {
        updateData.resolved_at = new Date()
        updateData.resolution_details = resolution_details

        if (!quiet) {
          // Garante a geração do token/instância de pesquisa de forma síncrona
          // para que a relação survey_instance esteja disponível no banco
          try {
            await SurveyService.getSurveyTokenForTicket(id)
          } catch (err) {
            console.error('[TicketService] Erro ao criar SurveyInstance:', err)
          }

          // Dispara as comunicações (e-mail e chat) de forma assíncrona para não travar a resposta/testes
          if (process.env.NODE_ENV !== 'test') {
            SurveyService.triggerAutoSurvey(id).catch(err => {
              console.error('[TicketService] Erro ao disparar Survey:', err)
            })
          }
        }
      }
      
      if (status === 'closed' && ticket.status !== 'closed') {
        updateData.closed_at = new Date()
        if (resolution_details) updateData.resolution_details = resolution_details
      }
    }

    // Fila e responsável validados antes de gravar (tela, API externa e automações passam aqui).
    if (queue && queue !== ticket.queue && !(await prisma.queue.findUnique({ where: { id: queue }, select: { id: true } }))) {
      throw new AppError(400, `A fila "${queue}" não existe.`, 'QUEUE_NOT_FOUND')
    }
    const newAssigneeId = assigned_to_id !== undefined ? sanitizeId(assigned_to_id) : null
    if (newAssigneeId && newAssigneeId !== ticket.assigned_to_id) {
      await assertValidAssignee({ ...ticket, queue: queue || ticket.queue }, newAssigneeId, { skipScope: opts.origin === 'escalation' })
    }

    if (priority) updateData.priority = priority
    if (assigned_to_id !== undefined) updateData.assigned_to_id = sanitizeId(assigned_to_id)
    if (queue) {
      updateData.queue = queue
      // Ao mover o chamado para uma fila que o responsável atual (analista)
      // não participa, ele deixa de ser o responsável (fica sem atribuição). Se a fila
      // de destino for uma que ele participa, a atribuição é mantida. Não se aplica quando
      // a atribuição já está sendo definida explicitamente nesta mesma requisição.
      if (queue !== ticket.queue && ticket.assigned_to_id && assigned_to_id === undefined) {
        const assignee = await prisma.user.findUnique({
          where: { id: ticket.assigned_to_id },
          select: { role: true, queues: true },
        })
        if (assignee && assignee.role === 'agent' && !(assignee.queues ?? []).includes(queue)) {
          updateData.assigned_to_id = null
        }
      }
    }
    if (reopen_sla_enabled !== undefined) updateData.reopen_sla_enabled = reopen_sla_enabled
    if (reopen_sla_limit_hours !== undefined) updateData.reopen_sla_limit_hours = reopen_sla_limit_hours === null ? null : Number(reopen_sla_limit_hours)
    
    const catId = sanitizeId(categoryId || category_id)
    if (catId) updateData.category_id = catId
    
    // Subcategoria enviada vazia = "Geral" (limpa). Trocar só a categoria também
    // limpa: a subcategoria antiga pertence à categoria anterior.
    const subCatId = sanitizeId(subcategoryId || subcategory_id)
    if (subcategoryId !== undefined || subcategory_id !== undefined) updateData.subcategory_id = subCatId
    else if (catId && catId !== ticket.category_id) updateData.subcategory_id = null
    if (updateData.subcategory_id) {
      const sub = await prisma.subcategory.findUnique({ where: { id: updateData.subcategory_id }, select: { category_id: true } })
      if (!sub || sub.category_id !== (updateData.category_id ?? ticket.category_id)) {
        throw new AppError(400, 'A subcategoria não pertence à categoria informada', 'SUBCATEGORY_CATEGORY_MISMATCH')
      }
    }

    // Categoria desligada para a empresa: vale quando a categoria ou a empresa (troca de
    // solicitante) muda por ação de pessoa — regra de roteamento e integração (system) não quebram.
    const effOrgId = 'org_id' in updateData ? updateData.org_id : ticket.org_id
    const catChanged = !!updateData.category_id && updateData.category_id !== ticket.category_id
    const orgChanged = effOrgId !== ticket.org_id
    if ((catChanged || orgChanged) && opts.origin !== 'routing' && actorRole !== 'system') {
      await assertCategoryNotBlocked(effOrgId, updateData.category_id ?? ticket.category_id)
    }

    if (chat_enabled !== undefined) updateData.chat_enabled = chat_enabled

    // Map system actor to fixed UUID
    const effectiveActorId = actorId === 'system' ? SYSTEM_USER_ID : actorId

    if (ticket.is_reopened && actorRole !== 'user' && opts.origin !== 'routing') {
      updateData.is_reopened = false
    }

    // Trava otimista na troca de status: se outra pessoa mudou o status desde a
    // leitura (ex.: dois "Resolver" ao mesmo tempo), não grava a transição duas vezes.
    const updated = await prisma.ticket.update({
      where: status && status !== ticket.status ? { id, status: ticket.status } : { id },
      data: updateData,
      include: {
        category: true,
        subcategory: true,
        assigned_to: { select: { id: true, name: true, avatar: true } },
        survey_instance: true,
      }
    }).catch((err) => {
      if (err?.code === 'P2025') throw new AppError(409, 'O chamado foi alterado por outra pessoa enquanto você editava. Recarregue e tente de novo.', 'TICKET_CHANGED')
      throw err
    })

    // Log auditoria
    await createAuditLog({
      userId: actorId === 'system' ? undefined : actorId,
      action: 'UPDATE_TICKET',
      resource: 'TICKET',
      details: { 
        ticketId: id, 
        changes: updateData,
        before: Object.fromEntries(Object.keys(updateData).map(k => [k, (ticket as any)[k]])),
        statusChange: status && status !== ticket.status ? { from: ticket.status, to: status } : undefined
      }
    })

    // Correção humana de campo decidido pela triagem IA (nunca lança).
    await recordTriageFeedback(id, ticket, updated, actorId, actorRole)

    // Gerar nota interna automática se houver mudanças importantes (Audit Log)
    const changes: string[] = []
    const statusMap: any = {
      open: 'Aberto',
      in_progress: 'Em atendimento',
      pending: 'Pendente',
      resolved: 'Resolvido',
      closed: 'Fechado'
    }

    if (status && status !== ticket.status) {
      changes.push(`• **Status**: ${statusMap[ticket.status as string] || ticket.status} ➔ ${statusMap[status as string] || status}`)
    }

    if (queue && queue !== ticket.queue) {
      const oldQueue = ticket.queue ? await prisma.queue.findUnique({ where: { id: ticket.queue } }) : null
      const newQueue = await prisma.queue.findUnique({ where: { id: queue } })
      changes.push(`• **Fila**: ${oldQueue?.name || (ticket.queue ? ticket.queue : 'Nenhuma')} ➔ ${newQueue?.name || queue}`)
    }

    const newCatId = categoryId || category_id
    if (newCatId && newCatId !== ticket.category_id) {
      changes.push(`• **Categoria**: ${ticket.category?.name || 'Nenhum'} ➔ ${updated.category?.name || 'Nenhum'}`)
    }

    const newSubCatId = subcategoryId || subcategory_id
    if (newSubCatId && newSubCatId !== ticket.subcategory_id) {
      changes.push(`• **Subcategoria**: ${ticket.subcategory?.name || 'Nenhum'} ➔ ${updated.subcategory?.name || 'Nenhum'}`)
    }

    /* Comentado para evitar que logs operacionais poluam a Conversa Interna
    if (changes.length > 0) {
      const auditNote = resolution_details ? `\n\n**Resolução**: ${resolution_details}` : `\n\n**Observação**: ${note || 'Nenhuma observação fornecida.'}`
      const text = `**[ALTERAÇÃO DE CHAMADO]**\n${changes.join('\n')}${auditNote}`
      await prisma.ticketMessage.create({
        data: {
          ticket_id: id,
          user_id: effectiveActorId,
          type: 'internal',
          text
        }
      })
    }
    */

    // 1. Mudança de Status
    if (status && (status !== ticket.status || pendingReasonChange)) {
      const defaultNote = `Mudança de status: de ${statusMap[ticket.status] || ticket.status} para ${statusMap[status] || status}.`
      const storedEvidenceUrl = status === 'pending' ? await storeAttachment(pending_evidence_url) : null
      await prisma.ticketEvent.create({
        data: {
          ticket_id: id,
          user_id: effectiveActorId,
          from_status: ticket.status as any,
          to_status: status as any,
          note: note || resolution_details || defaultNote,
          pending_reason: status === 'pending' ? (pending_reason as any) : null,
          pending_schedule_at: status === 'pending' ? (updateData.pending_schedule_at ?? null) : null,
          attachment_url: storedEvidenceUrl,
        },
      })
    }

    // 2. Alteração de Prioridade
    if (priority && priority !== ticket.priority) {
      const priorityMap: any = { low: 'Baixa', medium: 'Média', high: 'Alta' }
      await prisma.ticketEvent.create({
        data: {
          ticket_id: id,
          user_id: effectiveActorId,
          from_status: updated.status as any,
          to_status: updated.status as any,
          note: `Alteração de prioridade: de ${priorityMap[ticket.priority] || ticket.priority} para ${priorityMap[priority] || priority}.`,
        },
      })
    }

    // 2b. Alteração de Tipo
    if (type && type !== ticket.type) {
      const typeMap: any = { incident: 'Incidente', request: 'Requisição', problem: 'Problema', change: 'Mudança' }
      await prisma.ticketEvent.create({
        data: {
          ticket_id: id,
          user_id: effectiveActorId,
          from_status: updated.status as any,
          to_status: updated.status as any,
          note: `Alteração de tipo: de ${typeMap[ticket.type] || ticket.type} para ${typeMap[type] || type}.`,
        },
      })
    }

    // 2c. Alteração de Fila / Categoria — registradas no histórico por qualquer
    // caminho (modal dedicado, "Responder ao Cliente", API, automação).
    if (queue && queue !== ticket.queue) {
      const [oldQ, newQ] = await Promise.all([
        ticket.queue ? prisma.queue.findUnique({ where: { id: ticket.queue }, select: { name: true } }) : null,
        prisma.queue.findUnique({ where: { id: queue }, select: { name: true } }),
      ])
      await prisma.ticketEvent.create({
        data: {
          ticket_id: id,
          user_id: effectiveActorId,
          from_status: updated.status as any,
          to_status: updated.status as any,
          note: `Alteração de fila: de ${oldQ?.name || ticket.queue || 'Nenhuma'} para ${newQ?.name || queue}.`,
        },
      })
    }
    if (updated.category_id !== ticket.category_id || updated.subcategory_id !== ticket.subcategory_id) {
      const catLabel = (c?: { name: string } | null, s?: { name: string } | null) => c ? (s ? `${c.name} / ${s.name}` : c.name) : 'Nenhuma'
      await prisma.ticketEvent.create({
        data: {
          ticket_id: id,
          user_id: effectiveActorId,
          from_status: updated.status as any,
          to_status: updated.status as any,
          note: `Alteração de categoria: de ${catLabel(ticket.category, ticket.subcategory)} para ${catLabel(updated.category, updated.subcategory)}.`,
        },
      })
    }

    // 3. Alteração de Responsável
    const prevAssignedId = ticket.assigned_to_id ?? null
    const nextAssignedId = updated.assigned_to_id ?? null
    if (prevAssignedId !== nextAssignedId) {
      const oldName = ticket.assigned_to?.name || 'Ninguém'
      const newName = updated.assigned_to?.name || 'Ninguém'
      await prisma.ticketEvent.create({
        data: {
          ticket_id: id,
          user_id: effectiveActorId,
          from_status: updated.status as any,
          to_status: updated.status as any,
          note: `Alteração de responsável: de ${oldName} para ${newName}.`,
        },
      })
    }

    // 3a. Nova previsão para o cliente
    if (updateData.client_forecast_at !== undefined && updated.client_forecast_at?.getTime() !== ticket.client_forecast_at?.getTime()) {
      const when = updated.client_forecast_at?.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
      await prisma.ticketEvent.create({
        data: {
          ticket_id: id, user_id: effectiveActorId, from_status: updated.status as any, to_status: updated.status as any,
          note: when ? `Nova previsão para o cliente: ${when}.` : 'Previsão para o cliente removida.',
        },
      })
    }

    // 3b. Alteração de Requisitante
    if (newRequester) {
      const oldRequesterName = ticket.user?.name || 'Desconhecido'
      await prisma.ticketEvent.create({
        data: {
          ticket_id: id,
          user_id: effectiveActorId,
          from_status: updated.status as any,
          to_status: updated.status as any,
          note: `Requisitante alterado de "${oldRequesterName}" para "${newRequester.name}".`,
        },
      })
    }

    // Notificação: chamado atribuído ao novo agente (evita notificar se o próprio agente se auto-atribuir)
    const newAssignedId = updateData.assigned_to_id
    if (newAssignedId && newAssignedId !== ticket.assigned_to_id && newAssignedId !== actorId) {
      NotificationService.create({
        userId: newAssignedId,
        ticketId: id,
        type: 'ticket_assigned',
        title: ticket.title,
        body: 'Chamado atribuído a você',
      })
    }

    // Notificação: chamado movido para nova fila
    if (queue && queue !== ticket.queue) {
      const queueLabel = (await prisma.queue.findUnique({ where: { id: queue }, select: { name: true } }))?.name ?? queue
      const agentsInNewQueue = await prisma.user.findMany({
        where: {
          role: { in: ['agent', 'supervisor', 'admin'] },
          queues: { has: queue },
          active: true,
          deleted_at: null,
          id: { not: actorId },
        },
        select: { id: true },
      })
      for (const agent of agentsInNewQueue) {
        NotificationService.create({
          userId: agent.id,
          ticketId: id,
          type: 'ticket_queue_moved',
          title: ticket.title,
          body: `Chamado movido para a fila ${queueLabel}`,
        })
      }
      NotificationService.broadcastQueueAlert({
        queueId: queue,
        ticketId: id,
        title: ticket.title,
        body: `Chamado movido para a fila ${queueLabel}`,
        type: 'ticket_queue_moved',
        excludeUserId: actorId,
      })
    }

    if (entersQueue) await this.afterOpen(id)

    const reopenConfig = await prisma.reopenSlaConfig.findFirst()
    const mappedTicket = this.mapTicket(updated, reopenConfig)
    if (mappedTicket) {
      // Passa o responsável anterior para que sua contagem atualize ao perder o chamado
      const assigneeChanged = updateData.assigned_to_id !== undefined && ticket.assigned_to_id !== updated.assigned_to_id
      this.broadcastTicketUpdate(mappedTicket.id, 'ticket:updated', ticket.queue, assigneeChanged ? ticket.assigned_to_id : null)

      // Webhooks de saída — deriva os eventos das variáveis já calculadas acima
      if (!quiet) {
        const webhookData = { ticket: buildTicketPayload(mappedTicket) }
        emitWebhookEvent('ticket.updated', webhookData)
        if (status && status !== ticket.status) {
          emitWebhookEvent('ticket.status_changed', { ...webhookData, from: ticket.status, to: updated.status })
          this.notifyRequester(ticket, actorId, { kind: 'status', from: ticket.status, to: updated.status })
          if (updated.status === 'resolved') emitWebhookEvent('ticket.resolved', webhookData)
          if (updated.status === 'closed') {
            emitWebhookEvent('ticket.closed', webhookData)
            // Base de resoluções: o chamado fechado vira cartão (em segundo plano, nunca lança).
            void distillTicket(id)
          }
        }
        if (prevAssignedId !== nextAssignedId) {
          emitWebhookEvent('ticket.assigned', { ...webhookData, previous_assigned_to_id: prevAssignedId, assigned_to_id: nextAssignedId })
        }
      }
    }

    const relevantChange =
      updated.status !== ticket.status || updated.queue !== ticket.queue ||
      updated.priority !== ticket.priority || prevAssignedId !== nextAssignedId
    if (relevantChange && opts.origin !== 'routing' && !quiet) {
      await this.runTrigger(id, 'ticket_updated')
    }
    // Chamado filho concluído: o pai fica sabendo (nota interna + aviso ao responsável).
    if (updated.status !== ticket.status) await notifyParentOfChildStatus(id, updated.status, effectiveActorId)

    return mappedTicket
  }

  // Resolvido/fechado há mais tempo que o limite de reabertura (do chamado ou o
  // global): nova mensagem do cliente não reabre mais. Sem limite ligado, sempre reabre.
  static async reopenWindowExpired(ticket: { resolved_at: Date | null; closed_at: Date | null; updated_at: Date; reopen_sla_enabled: boolean | null; reopen_sla_limit_hours: number | null }) {
    const reopenConfig = await prisma.reopenSlaConfig.findFirst()
    const enabled = ticket.reopen_sla_enabled !== null ? ticket.reopen_sla_enabled : (reopenConfig?.enabled ?? true)
    const limitHours = ticket.reopen_sla_limit_hours !== null ? ticket.reopen_sla_limit_hours : (reopenConfig?.reopen_limit_hours ?? 24)
    if (!enabled) return false
    const referenceDate = ticket.resolved_at || ticket.closed_at || ticket.updated_at
    return Boolean(referenceDate) && (Date.now() - new Date(referenceDate).getTime()) / 3600000 > limitHours
  }

  // opts.skipRequesterEmail: o cliente já recebeu o conteúdo por outro caminho
  // (ex.: analista respondeu pelo Outlook com o cliente em cópia).
  static async addMessage(ticketId: string, userId: string, text: string, type: string, attachmentUrl?: string, dispatchChannel?: string, isRealtime: boolean = false, opts: { skipRequesterEmail?: boolean } = {}) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { org: { include: { sla_config: true } }, user: true } })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')

    // Fechado é definitivo (o /reopen também recusa): resposta pública não entra
    // nem reabre. Nota interna e e-mail de integração seguem permitidos.
    if (ticket.status === 'closed' && (type === 'user' || type === 'agent')) {
      throw new AppError(400, 'Este chamado está fechado e não recebe novas mensagens. Se o problema persistir, abra um novo chamado.', 'TICKET_CLOSED')
    }

    // Anexo da mensagem: base64 → blob (guarda só o nome do blob).
    attachmentUrl = (await storeAttachment(attachmentUrl)) ?? undefined

    const effectiveUserId = userId === 'system' ? SYSTEM_USER_ID : userId

    const message = await prisma.ticketMessage.create({
      data: {
        ticket_id: ticketId,
        user_id: effectiveUserId,
        type: type as any,
        text,
        attachment_url: attachmentUrl || null,
        is_realtime: isRealtime,
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })

    // Agente intake: a 1ª resposta do solicitante a um chamado marcado como incompleto complementa a descrição.
    if (type === 'user' && userId === ticket.user_id && ticket.intake_status === 'incomplete') {
      const complemented = await appendComplement(ticketId, ticket.description, text)
        .catch(err => { console.error('[AI:intake] complemento falhou:', err?.message ?? err); return false })
      // Agente guidance esperava o complemento para orientar com o relato completo.
      if (complemented) void guidanceTicket(ticketId).catch(err => console.error('[AI:guidance] falhou:', err?.message ?? err))
    }

    // Chat em tempo real não dispara e-mail (evita spam por mensagem ao vivo)
    if (type !== 'internal' && !isRealtime && !opts.skipRequesterEmail) {
      this.notifyRequester(ticket, userId, { kind: 'reply', text, attachment: attachmentUrl ?? null })
    }

    // Resposta pública do analista também avisa no Teams (chat pessoal do bot). Sem esperar.
    notifyAgentReply({
      ticket, authorId: effectiveUserId, authorName: message.user?.name, type, text, isRealtime,
      skipRequester: opts.skipRequesterEmail,
    }).catch(err => console.error('[Teams:bot] aviso de resposta falhou:', err?.message ?? err))

    if (dispatchChannel) {
      try {
        const instance = await prisma.surveyInstance.findUnique({
          where: { ticket_id: ticketId }
        })
        if (instance) {
          await prisma.surveyDispatch.create({
            data: {
              instance_id: instance.id,
              canal: dispatchChannel as any,
              disparado_por: userId === 'system' ? null : userId,
              status_envio: 'enviado',
              disparado_em: new Date()
            }
          })
        }
      } catch (err) {
        console.error('[TicketService] Falha ao registrar despacho de pesquisa:', err)
      }
    }

    // Reabertura no MESMO chamado: uma nova mensagem (não interna) em um chamado
    // resolvido/fechado reativa o próprio chamado — nunca cria um novo. Isso
    // evita duplicidade e mantém todo o histórico centralizado.
    const isReopenByMessage =
      ticket.status === 'resolved' &&
      type !== 'internal' && type !== 'email' && userId !== 'system'

    // Se o chamado estiver 'aberto', ele passa para 'em atendimento' no primeiro contato.
    // Se estiver 'pendente' (aguardando usuário) e o usuário responder, ele volta para 'em atendimento'.
    // Só resposta pública da equipe tira de "Aberto": mensagem do próprio
    // cliente ou nota interna não é atendimento (senão o chamado some da fila
    // de abertos sem ninguém ter respondido). Nota interna também não tira de
    // "Pendente": quando o analista é o próprio solicitante, o log interno da
    // mudança para pendente reabria o chamado na hora.
    // Quando a equipe atende o próprio chamado, vale o papel em que escreveu: resposta
    // de atendimento ('agent') tira de Aberto e não conta como retorno do solicitante.
    const isAttendantReply = type === 'agent' && userId !== 'system'
    const shouldStatusChange =
      (ticket.status === 'open' && type !== 'internal' && userId !== 'system' && (userId !== ticket.user_id || isAttendantReply)) ||
      (ticket.status === 'pending' && type !== 'internal' && userId === ticket.user_id && !isAttendantReply)

    if (isReopenByMessage) {
      const reopenConfig = await prisma.reopenSlaConfig.findFirst()
      if (await this.reopenWindowExpired(ticket)) {
        throw new AppError(400, 'Este chamado está encerrado definitivamente e não pode ser reaberto.', 'BAD_REQUEST')
      }

      const bh = await getBusinessHoursConfig()
      const newDeadline = this.calculateReopenDeadline(ticket, reopenConfig, bh)
      const entry = ticket.ai_resolved ? await this.queueEntry(ticket.org_id) : null
      // Sem responsável não há atendimento em curso: resolvido pela IA volta como aberto.
      const reopenedTo = entry ? 'open' : 'in_progress'
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status: reopenedTo,
          is_reopened: true,
          resolved_at: null,
          closed_at: null,
          sla_deadline: newDeadline,
          ...entry,
        },
      })
      const statusLabel = ticket.status === 'closed' ? 'Fechado' : 'Resolvido'
      await prisma.ticketEvent.create({
        data: {
          ticket_id: ticketId,
          user_id: effectiveUserId,
          from_status: ticket.status as any,
          to_status: reopenedTo as any,
          note: `Reabertura automática: nova mensagem reativou o chamado (de ${statusLabel}).`,
        },
      })
      // Os avisos desta mensagem, mais abaixo, vão para a fila em que o chamado entrou.
      if (entry) ticket.queue = (await this.afterOpen(ticketId))?.queue ?? null
      emitWebhookEvent('ticket.status_changed', {
        ticket: buildTicketPayload({ ...ticket, status: reopenedTo }),
        from: ticket.status,
        to: reopenedTo,
        reason: 'reopened_by_message',
      })
      this.notifyRequester(ticket, userId, { kind: 'status', from: ticket.status, to: reopenedTo })
      /* Comentado para evitar log repetido em conversa interna
      await prisma.ticketMessage.create({
        data: {
          ticket_id: ticketId,
          user_id: effectiveUserId,
          type: 'internal',
          text: '**[CHAMADO REABERTO]** Reaberto automaticamente por nova interação no chat.',
        },
      })
      */
    } else if (shouldStatusChange) {
      let updateData: any = { status: 'in_progress', is_reopened: false }
      let transitionNote = `Status alterado de ${ticket.status === 'open' ? 'Aberto' : 'Pendente'} para Em atendimento por nova mensagem.`

      if (ticket.status === 'pending') {
        // ── SLA Resume via mensagem ────────────────────────────────────
        updateData.sla_paused_at = null
        updateData.pending_reason = null
        updateData.pending_schedule_at = null
        const lastPendingEvent = await prisma.ticketEvent.findFirst({
          where: {
            ticket_id: ticketId,
            to_status: 'pending',
            // Ignora pending→pending (troca de subpendência, prioridade etc.): a pausa começou na entrada.
            OR: [{ from_status: null }, { from_status: { not: 'pending' } }],
          },
          orderBy: {
            created_at: 'desc'
          }
        })
        if (lastPendingEvent) {
          const bh = await getBusinessHoursConfig()
          const now = new Date()
          const holidays = holidaysAround(now)
          const businessMinutes = getBusinessMinutesBetween(lastPendingEvent.created_at, now, bh, holidays)
          updateData.total_paused_minutes = (ticket.total_paused_minutes ?? 0) + businessMinutes
          if (businessMinutes > 0) {
            const businessHours = businessMinutes / 60
            updateData.sla_deadline = addBusinessHours(ticket.sla_deadline, businessHours, bh, holidays)
            if (ticket.first_response_deadline) {
              updateData.first_response_deadline = addBusinessHours(ticket.first_response_deadline, businessHours, bh, holidays)
            }
          }
        }
      }

      await prisma.ticket.update({
        where: { id: ticketId },
        data: updateData
      })

      await prisma.ticketEvent.create({
        data: {
          ticket_id: ticketId,
          user_id: effectiveUserId,
          from_status: ticket.status as any,
          to_status: 'in_progress' as any,
          note: transitionNote
        }
      })
      emitWebhookEvent('ticket.status_changed', {
        ticket: buildTicketPayload({ ...ticket, status: 'in_progress' }),
        from: ticket.status,
        to: 'in_progress',
        reason: 'message_activity',
      })
      this.notifyRequester(ticket, userId, { kind: 'status', from: ticket.status, to: 'in_progress' })
    } else if (ticket.is_reopened && userId !== ticket.user_id && userId !== 'system') {
      await prisma.ticket.update({ where: { id: ticketId }, data: { is_reopened: false } })
    }

    if (userId !== 'system') {
      await createAuditLog({
        userId,
        action: 'ADD_MESSAGE',
        resource: 'TICKET',
        details: { ticketId, type, text: text.substring(0, 100) + (text.length > 100 ? '...' : '') }
      })
    }

    // Webhook de saída: nova mensagem pública em um chamado
    if (type !== 'internal') {
      const messageWebhookData = {
        ticket: buildTicketPayload(ticket),
        message: buildMessagePayload(message),
      }
      emitWebhookEvent('ticket.message_created', messageWebhookData)
      // Eventos derivados por lado de quem enviou (usuário solicitante vs. analista/atendente)
      if (userId !== 'system') {
        emitWebhookEvent(
          userId === ticket.user_id ? 'ticket.message_created_by_user' : 'ticket.message_created_by_agent',
          messageWebhookData,
        )
      }
    }

    // Notifica via Socket.IO. Mensagem do sistema (ex.: pergunta do assistente) chega ao chat
    // de quem está com o chamado aberto, mas não gera toast nem sino.
    if (type !== 'internal') {
      // Atualiza o chat em tempo real para todos que estão com o chamado aberto
      await this.emitToTicketRoom(ticket, 'ticket:message', {
        id: message.id,
        ticketId,
        userId: message.user_id,
        text,
        type,
        attachmentUrl: presentAttachment(attachmentUrl),
        isRealtime: message.is_realtime,
        createdAt: message.created_at,
        user: message.user,
      })
    }

    if (type !== 'internal' && userId !== 'system') {
      const io = getIo()
      if (io) {
        // Popup toast (não persistente) para quem NÃO está com o chamado aberto
        const notifPayload = {
          ticketId,
          ticketNumber: ticket.display_number,
          title: ticket.title,
          senderName: message.user.name,
          text: text.substring(0, 120),
          type,
        }

        // Notifica o criador do ticket (se não for o remetente)
        if (ticket.user_id !== effectiveUserId) {
          io.to(`user:${ticket.user_id}`).emit('ticket:new_message', notifPayload)
        }

        // Responsável e participantes ativos: só quem ainda enxerga o chamado
        // (ex.: Chamados desligado depois da atribuição não recebe o trecho).
        const realtimeParticipants = await prisma.ticketParticipant.findMany({
          where: { ticket_id: ticketId, active: true },
          select: { agent_id: true },
        })
        const staffIds = [...new Set([ticket.assigned_to_id, ...realtimeParticipants.map(p => p.agent_id)])]
          .filter((uid): uid is string => !!uid && uid !== effectiveUserId)
        if (staffIds.length) {
          const { allowed } = await socketsByTicketAccess(io, staffIds.map(uid => `user:${uid}`), ticket)
          for (const s of allowed) if (staffIds.includes(s.data.userId)) s.emit('ticket:new_message', notifPayload)
        }

        // Se não há agente atribuído, notifica os agentes da fila que enxergam o chamado
        if (!ticket.assigned_to_id && ticket.queue) {
          const { allowed } = await socketsByTicketAccess(io, [`queue:${ticket.queue}`], ticket)
          for (const s of allowed) if (s.data.userId !== effectiveUserId) s.emit('ticket:new_message', notifPayload)
        }
      }

      // Notificações persistentes (bell) para nova mensagem ou novo anexo
      const notifType = attachmentUrl ? 'new_attachment' : 'new_message'
      const notifBody = attachmentUrl
        ? `${message.user.name} enviou um arquivo`
        : `${message.user.name}: ${text.substring(0, 100)}`

      const recipients = new Set<string>()
      if (ticket.user_id !== effectiveUserId) recipients.add(ticket.user_id)
      if (ticket.assigned_to_id && ticket.assigned_to_id !== effectiveUserId) recipients.add(ticket.assigned_to_id)

      // Atuação unificada: notifica também os agentes participantes ativos
      const activeParticipants = await prisma.ticketParticipant.findMany({
        where: { ticket_id: ticketId, active: true },
        select: { agent_id: true },
      })
      activeParticipants.forEach(p => {
        if (p.agent_id !== effectiveUserId) recipients.add(p.agent_id)
      })

      if (!ticket.assigned_to_id) {
        // Sem agente — notifica todos da fila via DB
        const agentsInQueue = await prisma.user.findMany({
          where: {
            role: { in: ['agent', 'supervisor', 'admin'] },
            ...(ticket.queue ? { queues: { has: ticket.queue } } : {}),
            active: true,
            deleted_at: null,
            id: { not: effectiveUserId },
          },
          select: { id: true },
        })
        agentsInQueue.forEach(a => recipients.add(a.id))
      }

      for (const recipientId of recipients) {
        NotificationService.create({
          userId: recipientId,
          ticketId,
          type: notifType,
          title: ticket.title,
          body: notifBody,
          senderName: message.user.name,
        })
      }
    }

    this.broadcastTicketUpdate(ticketId, 'ticket:updated')

    if (isReopenByMessage) await this.runTrigger(ticketId, 'ticket_reopened')
    if (userId === ticket.user_id && type !== 'internal') await this.runTrigger(ticketId, 'client_message')

    return {
      ...message,
      ticketId: message.ticket_id,
      userId: message.user_id,
      attachmentUrl: presentAttachment(message.attachment_url),
      isRealtime: message.is_realtime,
      createdAt: message.created_at,
    }
  }

  /** Só quem abriu confirma, e só com o chamado resolvido. */
  static async confirmResolution(id: string, userId: string) {
    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { user_id: true, status: true, deleted_at: true } })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
    if (ticket.user_id !== userId) throw forbidden('NOT_REQUESTER', 'Só quem abriu o chamado confirma que ele foi resolvido.')
    if (ticket.status !== 'resolved') throw new AppError(400, 'Apenas chamados resolvidos podem ser confirmados', 'BAD_REQUEST')
    return this.updateTicket(id, userId, 'system', { status: 'closed', note: 'Solução confirmada pelo solicitante.' })
  }

  static async reopenTicket(id: string, actorId: string, reason: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { org: { include: { sla_config: true } } },
    })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
    if (ticket.status !== 'resolved') throw new AppError(400, 'Apenas chamados resolvidos podem ser reabertos', 'BAD_REQUEST')

    const reopenConfig = await prisma.reopenSlaConfig.findFirst()
    const enabled = ticket.reopen_sla_enabled !== null ? ticket.reopen_sla_enabled : (reopenConfig?.enabled ?? true)
    const limitHours = ticket.reopen_sla_limit_hours !== null ? ticket.reopen_sla_limit_hours : (reopenConfig?.reopen_limit_hours ?? 24)
    if (enabled) {
      const referenceDate = ticket.resolved_at || ticket.closed_at || ticket.updated_at
      if (referenceDate) {
        const elapsedHours = (Date.now() - new Date(referenceDate).getTime()) / 3600000
        if (elapsedHours > limitHours) {
          throw new AppError(400, 'O prazo limite de reabertura deste chamado expirou.', 'BAD_REQUEST')
        }
      }
    }

    const bh = await getBusinessHoursConfig()
    const newDeadline = this.calculateReopenDeadline(ticket, reopenConfig, bh)

    const entry = ticket.ai_resolved ? await this.queueEntry(ticket.org_id) : null

    const updated = await prisma.ticket.update({
      where: { id },
      data: { status: 'open', resolved_at: null, sla_deadline: newDeadline, is_reopened: true, ...entry },
    })

    /* Comentado para não poluir conversa interna
    await prisma.ticketMessage.create({
      data: {
        ticket_id: id,
        user_id: actorId,
        type: 'internal',
        text: `**[CHAMADO REABERTO]**\nReaberto pelo solicitante. Motivo: ${reason}`,
      },
    })
    */

    await prisma.ticketEvent.create({
      data: {
        ticket_id: id,
        user_id: actorId,
        from_status: 'resolved' as any,
        to_status: 'open' as any,
        note: `Reabertura de chamado. Motivo: ${reason}`,
      },
    })

    await createAuditLog({
      userId: actorId,
      action: 'REOPEN_TICKET',
      resource: 'TICKET',
      details: { ticketId: id, reason },
    })
    this.notifyRequester(ticket, actorId, { kind: 'status', from: 'resolved', to: 'open' })
    if (entry) await this.afterOpen(id)

    const mappedTicket = this.mapTicket(updated, reopenConfig)
    if (mappedTicket) {
      this.broadcastTicketUpdate(mappedTicket.id, 'ticket:updated')
    }

    await this.runTrigger(id, 'ticket_reopened')

    return mappedTicket
  }

  static async getMessages(ticketId: string) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')

    const messages = await prisma.ticketMessage.findMany({
      where: { ticket_id: ticketId },
      orderBy: { created_at: 'asc' },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })

    return messages.map(m => ({
      ...m,
      ticketId: m.ticket_id,
      userId: m.user_id,
      attachmentUrl: presentAttachment(m.attachment_url),
      isRealtime: m.is_realtime,
      createdAt: m.created_at,
    }))
  }

  static async updateMessage(ticketId: string, messageId: string, userId: string, canModerate: boolean, text: string) {
    const message = await prisma.ticketMessage.findUnique({ where: { id: messageId }, include: { ticket: { select: MESSAGE_TICKET_SELECT } } })
    if (!message || message.ticket.deleted_at) throw new AppError(404, 'Mensagem não encontrada', 'NOT_FOUND')
    if (message.ticket_id !== ticketId) throw new AppError(400, 'Mensagem não pertence ao chamado informado', 'BAD_REQUEST')

    // Autor da mensagem, ou quem tem a opção tickets.messages.moderate.
    // Admin é somente leitura e não modera mensagens de terceiros.
    if (message.user_id !== userId && !canModerate) {
      throw forbidden('MESSAGE_NOT_OWNER', 'Você só pode editar mensagens que você mesmo enviou. Mexer em mensagens de outras pessoas exige a opção "Editar mensagens de outras pessoas" na sua ficha.')
    }
    assertMessageEditable(message, canModerate)

    const updated = await prisma.ticketMessage.update({
      where: { id: messageId },
      data: { text },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })

    const mapped = {
      ...updated,
      ticketId: updated.ticket_id,
      userId: updated.user_id,
      attachmentUrl: presentAttachment(updated.attachment_url),
      isRealtime: updated.is_realtime,
      createdAt: updated.created_at,
    }

    await createAuditLog({
      userId,
      action: 'UPDATE_MESSAGE',
      resource: 'TICKET',
      details: { ticketId, messageId, type: message.type, authorId: message.user_id, before: message.text.substring(0, 500) },
    })

    await this.emitToTicketRoom(message.ticket, 'ticket:message:updated', mapped, message.type === 'internal')

    return mapped;
  }

  static async deleteTicket(id: string, audit: AuditInfo) {
    const ticket = await prisma.ticket.findUnique({ where: { id } })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')

    await prisma.ticket.update({ where: { id }, data: { deleted_at: new Date(), deleted_by_id: audit.actorId ?? null } })

    await createAuditLog({
      userId: audit.actorId,
      action: 'DELETE_TICKET',
      resource: 'TICKET',
      details: { ticketId: id, displayNumber: ticket.display_number, title: ticket.title, status: ticket.status },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })

    const io = getIo()
    if (io) {
      const rooms = [`ticket:${id}`, `user:${ticket.user_id}`, 'role:supervisor', 'role:manager', 'role:admin']
      if (ticket.queue) rooms.push(`queue:${ticket.queue}`)
      if (ticket.assigned_to_id) rooms.push(`user:${ticket.assigned_to_id}`)
      if (audit.actorId) rooms.push(`user:${audit.actorId}`)
      io.to(rooms).emit('ticket:deleted', { id })
    }
  }

  static async deleteMessage(ticketId: string, messageId: string, userId: string, canModerate: boolean) {
    const message = await prisma.ticketMessage.findUnique({ where: { id: messageId }, include: { ticket: { select: MESSAGE_TICKET_SELECT } } })
    if (!message || message.ticket.deleted_at) throw new AppError(404, 'Mensagem não encontrada', 'NOT_FOUND')
    if (message.ticket_id !== ticketId) throw new AppError(400, 'Mensagem não pertence ao chamado informado', 'BAD_REQUEST')

    // Autor da mensagem, ou quem tem a opção tickets.messages.moderate.
    // Admin é somente leitura e não modera mensagens de terceiros.
    if (message.user_id !== userId && !canModerate) {
      throw forbidden('MESSAGE_NOT_OWNER', 'Você só pode excluir mensagens que você mesmo enviou. Mexer em mensagens de outras pessoas exige a opção "Editar mensagens de outras pessoas" na sua ficha.')
    }
    assertMessageEditable(message, canModerate)

    await prisma.ticketMessage.delete({
      where: { id: messageId }
    })

    await createAuditLog({
      userId,
      action: 'DELETE_MESSAGE',
      resource: 'TICKET',
      details: { ticketId, messageId, type: message.type, authorId: message.user_id, before: message.text.substring(0, 500) },
    })

    await this.emitToTicketRoom(message.ticket, 'ticket:message:deleted', { ticketId, messageId }, message.type === 'internal')

    return { ticketId, messageId }
  }
}
