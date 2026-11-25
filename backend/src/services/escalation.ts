import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { adminReadOnly, forbidden } from '../utils/denials'
import { createAuditLog } from './audit'
import { assertCategoryNotBlocked } from './orgCategoryAccess'
import { TicketService } from './tickets'
import { NotificationService } from './notifications'
import { emitWebhookEvent, buildTicketPayload } from './webhookEvents'
import { getEffectiveModules } from './moduleAccess'
import { computeTicketTypeChange } from './ticketTypeChange'

/**
 * Regras de escalonamento — o que cada tipo faz com o chamado:
 * - transfer: o chamado vai para a fila de destino (sem responsável, ou com o analista
 *   escolhido/fixo). Quem transferiu sai, a menos que a regra mantenha a origem.
 * - same_ticket: atuação conjunta — o chamado vai para a fila da regra, o responsável fica
 *   e um segundo analista (ou qualquer um da fila) atua junto no MESMO chamado.
 * - child_ticket: abre um chamado filho vinculado na fila de destino; o pai segue com a origem.
 * - category_change: muda a categoria e registra a nota automática.
 * O destino ganha acesso pelo escalonamento, mesmo sem a empresa na carteira
 * (ticketAccess: responsável, colaborador, fila colaboradora ou fila escalonada).
 */
export const ESCALATION_TYPES = ['transfer', 'same_ticket', 'child_ticket', 'category_change'] as const
export const TARGET_MODES = ['queue', 'agent_pick', 'agent_fixed'] as const
const PRIORITIES = ['low', 'medium', 'high']
const STAFF_ROLES: ('agent' | 'supervisor' | 'manager')[] = ['agent', 'supervisor', 'manager']

export type EscalationType = typeof ESCALATION_TYPES[number]
export type TargetMode = typeof TARGET_MODES[number]

export interface RuleInput {
  name: string
  type: EscalationType
  target_queue_id?: string | null
  target_category_id?: string | null
  auto_description?: string | null
  active?: boolean
  target_mode?: TargetMode
  target_agent_id?: string | null
  keep_origin?: boolean
  require_note?: boolean
  target_priority?: string | null
  source_queue_ids?: string[]
}

const invalid = (msg: string) => new AppError(400, msg, 'VALIDATION_ERROR')

/** A regra precisa ter para onde mandar o chamado, conforme o tipo e o modo de destino. */
async function validateRule(r: RuleInput) {
  if (!r.name?.trim()) throw invalid('Nome é obrigatório')
  if (!ESCALATION_TYPES.includes(r.type)) throw invalid('Tipo inválido. Use transfer, same_ticket, child_ticket ou category_change')
  const mode = r.target_mode ?? 'queue'
  if (!TARGET_MODES.includes(mode)) throw invalid('Destino inválido. Use queue, agent_pick ou agent_fixed')

  if (r.type === 'transfer' && !r.target_queue_id) throw invalid('A regra de transferência precisa de uma fila de destino')
  if (r.type === 'child_ticket' && !r.target_queue_id) throw invalid('A regra de chamado filho precisa da fila onde o filho será aberto')
  if (r.type === 'same_ticket' && !r.target_queue_id) throw invalid('A atuação conjunta precisa da fila para onde o chamado vai')
  if (r.type === 'category_change' && !r.target_category_id) throw invalid('Escolha a categoria de destino')
  if (r.type !== 'category_change' && mode === 'agent_fixed' && !r.target_agent_id) throw invalid('Escolha o analista de destino')

  if (r.target_priority && !PRIORITIES.includes(r.target_priority)) throw invalid('Prioridade inválida. Use low, medium ou high')
  if (r.target_queue_id && !(await prisma.queue.findUnique({ where: { id: r.target_queue_id }, select: { id: true } }))) {
    throw invalid('A fila de destino não existe')
  }
  if (r.target_category_id && !(await prisma.category.findUnique({ where: { id: r.target_category_id }, select: { id: true } }))) {
    throw invalid('A categoria de destino não existe')
  }
  if (r.type !== 'category_change' && mode === 'agent_fixed') await assertTargetAgent(r.target_agent_id!)
}

/** Analista de destino: da equipe, ativo e com Chamados ligado. A carteira NÃO importa: o escalonamento dá o acesso. */
async function assertTargetAgent(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, active: true, deleted_at: true } })
  if (!u || u.deleted_at || !u.active) throw new AppError(400, 'Analista de destino não encontrado ou inativo', 'BAD_REQUEST')
  if (!(STAFF_ROLES as string[]).includes(u.role)) throw new AppError(400, `${u.name} não é da equipe de atendimento`, 'BAD_REQUEST')
  if (!(await getEffectiveModules(u.id, u.role)).tickets) {
    throw new AppError(400, `${u.name} está com o módulo Chamados desligado`, 'BAD_REQUEST')
  }
  return u
}

/** Campos da regra normalizados (o que não vale para o tipo vira null). */
function normalize(r: RuleInput): RuleInput {
  // Sem modo informado (API antiga): atuação conjunta sem fila sempre foi "analista escolhido na hora".
  const fallback: TargetMode = r.type === 'same_ticket' && !r.target_queue_id ? 'agent_pick' : 'queue'
  const mode: TargetMode = r.type === 'category_change' ? 'queue' : (r.target_mode ?? fallback)
  return {
    ...r,
    name: r.name.trim(),
    target_mode: mode,
    target_queue_id: r.type === 'category_change' ? null : (r.target_queue_id || null),
    target_agent_id: mode === 'agent_fixed' ? (r.target_agent_id || null) : null,
    keep_origin: (r.type === 'transfer' || r.type === 'child_ticket') ? !!r.keep_origin : false,
    target_category_id: r.target_category_id || null,
    auto_description: r.auto_description?.trim() || null,
    target_priority: r.target_priority || null,
    source_queue_ids: [...new Set(r.source_queue_ids ?? [])],
  }
}

/**
 * Quem pode escalonar: gestor (Ticket Manager/Gerente), o responsável, um colaborador
 * ativo ou — com o chamado sem responsável — qualquer analista que o acessa.
 * O acesso ao chamado já foi checado no controller.
 */
async function assertCanEscalate(ticket: { id: string; assigned_to_id: string | null; assigned_to?: { name: string } | null }, actorId: string, actorRole: string) {
  if (actorRole === 'supervisor' || actorRole === 'manager' || actorRole === 'system') return
  if (!ticket.assigned_to_id || ticket.assigned_to_id === actorId) return
  const p = await prisma.ticketParticipant.findUnique({ where: { ticket_id_agent_id: { ticket_id: ticket.id, agent_id: actorId } } })
  if (p?.active) return
  throw forbidden('NOT_TICKET_OWNER', `Só o responsável (${ticket.assigned_to?.name ?? 'sem responsável'}), um colaborador ou um gestor escalona este chamado. Peça ao responsável ou assuma o chamado.`)
}

async function queueName(id: string | null | undefined) {
  if (!id) return null
  return (await prisma.queue.findUnique({ where: { id }, select: { name: true } }))?.name ?? id
}

async function notifyQueue(queueId: string, ticketId: string, title: string, body: string, actorId: string) {
  const agents = await prisma.user.findMany({
    where: { role: { in: STAFF_ROLES }, queues: { has: queueId }, active: true, deleted_at: null, id: { not: actorId } },
    select: { id: true },
  })
  for (const a of agents) NotificationService.create({ userId: a.id, ticketId, type: 'ticket_queue_moved', title, body })
  NotificationService.broadcastQueueAlert({ queueId, ticketId, title, body, type: 'ticket_queue_moved', excludeUserId: actorId })
}

async function addCollaborator(ticketId: string, agentId: string, addedBy: string) {
  await prisma.ticketParticipant.upsert({
    where: { ticket_id_agent_id: { ticket_id: ticketId, agent_id: agentId } },
    update: { role: 'collaborator', active: true, removed_at: null, added_by_id: addedBy },
    create: { ticket_id: ticketId, agent_id: agentId, role: 'collaborator', added_by_id: addedBy },
  })
}

export class EscalationService {
  /** Agente da fila colaboradora/escalonada entra no chamado como colaborador (co-responsável). */
  static async joinAsCollaborator(ticketId: string, actorId: string) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true, status: true, assigned_to_id: true, deleted_at: true } })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
    if (['resolved', 'closed'].includes(ticket.status)) {
      throw new AppError(400, 'Este chamado já está resolvido ou fechado — não é possível entrar como colaborador.', 'TICKET_FINISHED')
    }
    if (ticket.assigned_to_id === actorId) {
      throw new AppError(400, 'Você já é o responsável principal deste chamado.', 'ALREADY_OWNER')
    }
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
    await prisma.ticketParticipant.upsert({
      where: { ticket_id_agent_id: { ticket_id: ticketId, agent_id: actorId } },
      update: { role: 'collaborator', active: true, removed_at: null, added_by_id: actorId },
      create: { ticket_id: ticketId, agent_id: actorId, role: 'collaborator', added_by_id: actorId },
    })
    await prisma.ticketEvent.create({
      data: {
        ticket_id: ticketId,
        user_id: actorId,
        from_status: ticket.status,
        to_status: ticket.status,
        note: `${actor?.name ?? 'Agente'} assumiu como colaborador (atuação unificada).`,
      },
    })
    TicketService.broadcastTicketUpdate(ticketId, 'ticket:updated')
    return { ok: true }
  }

  static async listRules() {
    return prisma.escalationRule.findMany({ orderBy: { created_at: 'asc' } })
  }

  static async createRule(data: RuleInput) {
    const r = normalize({ ...data, name: data.name ?? '' })
    await validateRule(r)
    return prisma.escalationRule.create({ data: { ...(r as any), active: data.active ?? true } })
  }

  static async updateRule(id: string, data: Partial<RuleInput>) {
    const rule = await prisma.escalationRule.findUnique({ where: { id } })
    if (!rule) throw new AppError(404, 'Regra de escalonamento não encontrada', 'NOT_FOUND')
    const merged = normalize({ ...(rule as any), ...data } as RuleInput)
    await validateRule(merged)
    const { id: _id, created_at: _c, updated_at: _u, ...fields } = merged as any
    return prisma.escalationRule.update({ where: { id }, data: fields })
  }

  static async deleteRule(id: string) {
    const rule = await prisma.escalationRule.findUnique({ where: { id } })
    if (!rule) throw new AppError(404, 'Regra de escalonamento não encontrada', 'NOT_FOUND')
    await prisma.escalationRule.delete({ where: { id } })
  }

  static async executeEscalation(
    ticketId: string,
    ruleId: string,
    actorId: string,
    targetAgentId?: string | null,
    actorRole?: string,
    opts: { note?: string | null } = {},
  ) {
    const [ticket, rule] = await Promise.all([
      prisma.ticket.findUnique({ where: { id: ticketId }, include: { org: { include: { sla_config: true } }, assigned_to: { select: { id: true, name: true } } } }),
      prisma.escalationRule.findUnique({ where: { id: ruleId } }),
    ])

    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
    if (!rule || !rule.active) throw new AppError(404, 'Regra de escalonamento não encontrada ou inativa', 'NOT_FOUND')

    // Admin tem acesso somente leitura a chamados — não atua sobre chamados via escalonamento.
    const role = actorRole ?? 'agent'
    if (role === 'admin') throw adminReadOnly()
    if (['resolved', 'closed'].includes(ticket.status)) {
      throw new AppError(400, 'Não é possível escalonar um chamado resolvido ou fechado', 'BAD_REQUEST')
    }
    if (rule.source_queue_ids.length && !(ticket.queue && rule.source_queue_ids.includes(ticket.queue))) {
      throw new AppError(400, `A regra "${rule.name}" não vale para a fila em que o chamado está`, 'RULE_NOT_FOR_QUEUE')
    }
    await assertCanEscalate(ticket, actorId, role)

    const note = opts.note?.trim() || null
    if (rule.require_note && (!note || note.length < 5)) {
      throw new AppError(400, 'Esta regra exige uma justificativa (mínimo 5 caracteres)', 'ESCALATION_NOTE_REQUIRED')
    }

    // Categoria desligada para a empresa: o escalonamento (ação de pessoa) não pode
    // movê-la para uma categoria bloqueada. Antes de qualquer escrita.
    if (rule.target_category_id && rule.target_category_id !== ticket.category_id) {
      await assertCategoryNotBlocked(ticket.org_id, rule.target_category_id)
    }

    // Destino pessoa: fixo na regra ou escolhido agora.
    const mode = (rule.target_mode || 'queue') as TargetMode
    let targetAgent: { id: string; name: string } | null = null
    if (rule.type !== 'category_change') {
      if (mode === 'agent_fixed') targetAgent = await assertTargetAgent(rule.target_agent_id!)
      else if (mode === 'agent_pick') {
        if (!targetAgentId) throw new AppError(400, 'Escolha o analista que vai receber o chamado', 'BAD_REQUEST')
        targetAgent = await assertTargetAgent(targetAgentId)
      }
    }

    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
    const noteLine = note ? `\n\n**Justificativa:** ${note}` : ''
    const autoLine = rule.auto_description ? ` ${rule.auto_description}` : ''
    let result: any = {}
    let eventNote = `Escalonamento aplicado: ${rule.name}`
    // Prioridade e categoria da regra entram pelo mesmo caminho da edição (linha do tempo, webhooks).
    const extra: any = {}
    if (rule.target_priority && rule.target_priority !== ticket.priority) extra.priority = rule.target_priority
    if (rule.target_category_id && rule.target_category_id !== ticket.category_id) extra.category_id = rule.target_category_id

    if (rule.type === 'transfer') {
      // O chamado vai para a fila de destino; `escalated` + fila libera a fila de destino mesmo
      // sem a empresa na carteira (ticketAccess). Marcado ANTES da troca para que o aviso da
      // fila e o tempo real (filtrados por acesso) já alcancem o destino.
      const targetQueueId = rule.target_queue_id!
      if (targetQueueId === ticket.queue && (!targetAgent || targetAgent.id === ticket.assigned_to_id)) {
        throw new AppError(400, 'O chamado já está na fila de destino desta regra', 'BAD_REQUEST')
      }
      const [fromQ, toQ] = await Promise.all([queueName(ticket.queue), queueName(targetQueueId)])
      const originName = `${fromQ || 'sem fila'} / ${ticket.assigned_to?.name || 'sem responsável'}`
      const destName = `fila ${toQ}${targetAgent ? ` / ${targetAgent.name}` : ''}`

      await prisma.ticket.update({ where: { id: ticketId }, data: { escalated: true } })
      try {
        await TicketService.updateTicket(ticketId, actorId, role, {
          ...extra,
          ...(targetQueueId !== ticket.queue ? { queue: targetQueueId } : {}),
          assigned_to_id: targetAgent?.id ?? null,
        }, { origin: 'escalation' })
      } catch (err) {
        await prisma.ticket.update({ where: { id: ticketId }, data: { escalated: ticket.escalated } })
        throw err
      }
      // Ninguém da origem continua vinculado — salvo quando a regra mantém quem transferiu.
      await prisma.ticketParticipant.updateMany({ where: { ticket_id: ticketId, active: true }, data: { active: false, removed_at: new Date() } })
      await prisma.ticket.update({ where: { id: ticketId }, data: { collab_queue: null } })
      const keeps = rule.keep_origin && actorId !== targetAgent?.id
      if (keeps) await addCollaborator(ticketId, actorId, actorId)

      await prisma.ticketMessage.create({
        data: {
          ticket_id: ticketId,
          user_id: actorId,
          type: 'internal',
          text: `**[ESCALONAMENTO]** Transferência (regra "${rule.name}") — origem: ${originName}; destino: ${destName}. ${keeps ? `${actor?.name ?? 'Quem transferiu'} segue como colaborador.` : 'Quem transferiu deixa de ser responsável.'}${autoLine}${noteLine}`,
        },
      })
      if (targetAgent && targetAgent.id !== actorId) {
        NotificationService.create({ userId: targetAgent.id, ticketId, type: 'ticket_assigned', title: ticket.title, body: `Chamado transferido para você (${rule.name})` })
      }
      eventNote = `Escalonamento (transferência): de ${originName} para ${destName}.`
      result = { type: 'transfer', originName, destName, targetQueueId, targetAgentId: targetAgent?.id ?? null, keptOrigin: keeps }
    } else if (rule.type === 'same_ticket') {
      // Atuação conjunta: o chamado vai para a fila da regra, o responsável continua (owner)
      // e o destino entra no MESMO chamado — um analista como colaborador, ou a fila inteira.
      const originName = ticket.assigned_to?.name || 'Não atribuído'
      if (targetAgent && targetAgent.id === ticket.assigned_to_id) {
        throw new AppError(400, 'O analista escolhido já é o responsável do chamado', 'BAD_REQUEST')
      }
      const targetQueueId = rule.target_queue_id
      const moves = !!targetQueueId && targetQueueId !== ticket.queue
      const [fromQ, toQ] = await Promise.all([queueName(ticket.queue), queueName(targetQueueId)])

      // Marcado antes da troca: a fila de destino passa a enxergar o chamado sem a empresa na carteira.
      await prisma.ticket.update({ where: { id: ticketId }, data: { escalated: true } })
      try {
        if (moves || Object.keys(extra).length) {
          // assigned_to_id explícito: trocar de fila tiraria o responsável que não é da fila nova.
          await TicketService.updateTicket(ticketId, actorId, role, {
            ...extra,
            ...(moves ? { queue: targetQueueId, assigned_to_id: ticket.assigned_to_id } : {}),
          }, { origin: 'escalation' })
        }
      } catch (err) {
        await prisma.ticket.update({ where: { id: ticketId }, data: { escalated: ticket.escalated } })
        throw err
      }

      if (ticket.assigned_to_id) {
        await prisma.ticketParticipant.upsert({
          where: { ticket_id_agent_id: { ticket_id: ticketId, agent_id: ticket.assigned_to_id } },
          update: { role: 'owner', active: true, removed_at: null },
          create: { ticket_id: ticketId, agent_id: ticket.assigned_to_id, role: 'owner', added_by_id: actorId },
        })
      }

      let destName = ''
      if (targetAgent) {
        await addCollaborator(ticketId, targetAgent.id, actorId)
        destName = targetAgent.name
        if (targetAgent.id !== actorId) {
          NotificationService.create({ userId: targetAgent.id, ticketId, type: 'ticket_assigned', title: ticket.title, body: `Você foi escalonado para atuar no chamado ${ticket.id}` })
        }
      } else {
        await prisma.ticket.update({ where: { id: ticketId }, data: { collab_queue: targetQueueId } })
        destName = `fila ${toQ}`
        // Com a troca de fila o aviso à fila já saiu pelo updateTicket.
        if (!moves) await notifyQueue(targetQueueId!, ticketId, ticket.title, 'Chamado escalonado para atuação conjunta na sua fila', actorId)
      }

      // Quem escalonou sem ser o responsável continua no chamado (a fila mudou e ele perderia o acesso).
      if (moves && role === 'agent' && actorId !== ticket.assigned_to_id && actorId !== targetAgent?.id) {
        await addCollaborator(ticketId, actorId, actorId)
      }

      await prisma.ticketMessage.create({
        data: {
          ticket_id: ticketId,
          user_id: actorId,
          type: 'internal',
          text: `**[ESCALONAMENTO]** Atuação conjunta (regra "${rule.name}") — ${moves ? `chamado movido de ${fromQ || 'sem fila'} para ${toQ}; ` : ''}responsável: ${originName}; atua junto: ${destName}.${autoLine}${noteLine}`,
        },
      })
      eventNote = `Escalonamento (atuação conjunta): ${moves ? `fila ${fromQ || 'sem fila'} → ${toQ}; ` : ''}responsável ${originName}, atua junto ${destName}.`
      result = { type: 'same_ticket', originName, destName, movedTo: moves ? targetQueueId : null, targetAgentId: targetAgent?.id ?? null, targetQueueId: targetAgent ? null : targetQueueId }
    } else if (rule.type === 'child_ticket') {
      const child = await EscalationService.createChildTicket(ticket, rule, actorId, targetAgent, note)
      const destName = `fila ${await queueName(rule.target_queue_id)}${targetAgent ? ` / ${targetAgent.name}` : ''}`
      await prisma.ticketMessage.create({
        data: {
          ticket_id: ticketId,
          user_id: actorId,
          type: 'internal',
          text: `**[ESCALONAMENTO]** Chamado filho ${child.id} aberto (regra "${rule.name}") — destino: ${destName}. Este chamado segue com ${ticket.assigned_to?.name ?? 'a equipe atual'}.${autoLine}${noteLine}`,
        },
      })
      eventNote = `Escalonamento (chamado filho): ${child.id} aberto para ${destName}.`
      result = { type: 'child_ticket', childTicketId: child.id, destName }
    } else if (rule.type === 'category_change') {
      if (Object.keys(extra).length) await TicketService.updateTicket(ticketId, actorId, role, extra, { origin: 'escalation' })
      await prisma.ticketMessage.create({
        data: { ticket_id: ticketId, user_id: actorId, type: 'internal', text: `**[ESCALONAMENTO]** Regra aplicada: "${rule.name}".${autoLine}${noteLine}` },
      })
      result = { type: 'category_change', message: rule.auto_description }
    } else {
      throw new AppError(400, `Tipo de regra desconhecido: ${rule.type}`, 'BAD_REQUEST')
    }

    await prisma.ticketEvent.create({
      data: { ticket_id: ticketId, user_id: actorId, from_status: ticket.status as any, to_status: ticket.status as any, note: eventNote },
    })
    await createAuditLog({
      userId: actorId,
      action: 'ESCALATE_TICKET',
      resource: 'TICKET',
      details: { ticketId, ruleId, ruleName: rule.name, result, note },
    })

    const updated = await prisma.ticket.findUnique({ where: { id: ticketId } })
    TicketService.broadcastTicketUpdate(ticketId, 'ticket:updated', ticket.queue)
    emitWebhookEvent('ticket.escalated', {
      ticket: buildTicketPayload(updated),
      trigger: 'manual_rule',
      rule: { id: ruleId, name: rule.name, type: rule.type },
    })
    return { ticket: TicketService['mapTicket'](updated), ...result }
  }

  /**
   * Chamado filho: mesmo solicitante e empresa (SLA do plano da empresa), aberto direto na
   * fila de destino e marcado como escalonado — a fila de destino atua sem a empresa na
   * carteira. Não passa pela triagem/roteamento da abertura: o destino já foi decidido.
   */
  private static async createChildTicket(
    parent: any,
    rule: { id: string; name: string; target_queue_id: string | null; target_category_id: string | null; target_priority: string | null; keep_origin: boolean },
    actorId: string,
    targetAgent: { id: string; name: string } | null,
    note: string | null,
  ) {
    const id = await TicketService.nextTicketId()
    const terms = await TicketService['planTerms'](parent.org)
    const categoryId = rule.target_category_id ?? parent.category_id
    const child = await prisma.ticket.create({
      data: {
        id,
        display_number: `INC-${id.replace(/\D/g, '')}`,
        type: 'incident',
        title: parent.title,
        description: [
          `Chamado filho de ${parent.id}, aberto por escalonamento (regra "${rule.name}").`,
          note ? `Justificativa: ${note}` : null,
          '',
          'Descrição original:',
          parent.description ?? '',
        ].filter(l => l !== null).join('\n'),
        status: targetAgent ? 'in_progress' : 'open',
        priority: (rule.target_priority as any) ?? parent.priority,
        category_id: categoryId,
        subcategory_id: categoryId === parent.category_id ? parent.subcategory_id : null,
        user_id: parent.user_id,
        org_id: parent.org_id,
        created_by_id: actorId,
        queue: rule.target_queue_id,
        assigned_to_id: targetAgent?.id ?? null,
        escalated: true,
        channel: parent.channel,
        sla_deadline: terms.sla_deadline,
        first_response_deadline: terms.first_response_deadline,
      },
    })
    if (parent.type && parent.type !== 'incident') {
      const change = await computeTicketTypeChange(child, parent.type).catch(() => null)
      if (change) await prisma.ticket.update({ where: { id }, data: change as any })
    }
    await prisma.ticketLink.create({ data: { ticket_id: id, related_id: parent.id, kind: 'child', created_by_id: actorId } })
    await prisma.ticketEvent.create({
      data: { ticket_id: id, user_id: actorId, to_status: child.status, note: `Chamado filho aberto a partir de ${parent.id} (regra "${rule.name}").` },
    })
    if (rule.keep_origin && actorId !== targetAgent?.id) await addCollaborator(id, actorId, actorId)

    if (targetAgent && targetAgent.id !== actorId) {
      NotificationService.create({ userId: targetAgent.id, ticketId: id, type: 'ticket_assigned', title: child.title, body: `Chamado filho de ${parent.id} atribuído a você` })
    } else if (!targetAgent) {
      await notifyQueue(rule.target_queue_id!, id, child.title, `Chamado filho de ${parent.id} aberto na sua fila`, actorId)
    }
    TicketService.broadcastTicketUpdate(id, 'ticket:created')
    const fresh = await prisma.ticket.findUnique({ where: { id } })
    emitWebhookEvent('ticket.created', { ticket: buildTicketPayload(fresh), parent_ticket_id: parent.id })
    return fresh!
  }

  // Reverte uma atuação unificada: remove (soft) o agente colaborador
  // escalonado e/ou limpa a fila de colaboração, registrando o evento no log.
  // Apenas o responsável principal do chamado ou supervisor/admin podem reverter.
  static async revertUnifiedEscalation(
    ticketId: string,
    params: { agentId?: string | null },
    actorId: string,
    actorRole: string,
  ) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { assigned_to: { select: { id: true, name: true } } },
    })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')

    // Admin tem acesso somente leitura a chamados — não atua sobre chamados via escalonamento.
    if (actorRole === 'admin') throw adminReadOnly()

    const isManager = actorRole === 'supervisor' || actorRole === 'manager'
    if (!isManager && ticket.assigned_to_id !== actorId) {
      throw forbidden('REVERT_NOT_ALLOWED', `Só o responsável principal (${ticket.assigned_to?.name ?? 'sem responsável'}) ou um gestor (Ticket Manager/Gerente) pode reverter o escalonamento. Como colaborador, você pode continuar atuando ou pedir a reversão ao responsável.`)
    }

    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
    let removedName = ''

    if (params.agentId) {
      const participant = await prisma.ticketParticipant.findUnique({
        where: { ticket_id_agent_id: { ticket_id: ticketId, agent_id: params.agentId } },
        include: { agent: { select: { name: true } } },
      })
      if (!participant || !participant.active || participant.role === 'owner') {
        throw new AppError(404, 'Participante colaborador não encontrado neste chamado', 'NOT_FOUND')
      }
      await prisma.ticketParticipant.update({
        where: { id: participant.id },
        data: { active: false, removed_at: new Date() },
      })
      removedName = participant.agent?.name || 'agente'
    } else if (ticket.collab_queue) {
      await prisma.ticket.update({ where: { id: ticketId }, data: { collab_queue: null } })
      removedName = 'fila de colaboração'
    } else {
      throw new AppError(400, 'Nada para reverter neste chamado', 'BAD_REQUEST')
    }

    // Se não restarem colaboradores ativos nem fila, limpa a flag de escalonamento.
    const remainingCollabs = await prisma.ticketParticipant.count({
      where: { ticket_id: ticketId, role: 'collaborator', active: true },
    })
    const fresh = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { collab_queue: true } })
    if (remainingCollabs === 0 && !fresh?.collab_queue) {
      await prisma.ticket.update({ where: { id: ticketId }, data: { escalated: false } })
    }

    await prisma.ticketMessage.create({
      data: {
        ticket_id: ticketId,
        user_id: actorId,
        type: 'internal',
        text: `**[ESCALONAMENTO]** Atuação unificada revertida — ${removedName} removido por ${actor?.name || 'gestor'}.`,
      },
    })
    await prisma.ticketEvent.create({
      data: {
        ticket_id: ticketId,
        user_id: actorId,
        from_status: ticket.status as any,
        to_status: ticket.status as any,
        note: `Escalonamento revertido: ${removedName} removido por ${actor?.name || 'gestor'}.`,
      },
    })
    await createAuditLog({
      userId: actorId,
      action: 'REVERT_ESCALATION',
      resource: 'TICKET',
      details: { ticketId, agentId: params.agentId || null, removedName },
    })

    const updated = await prisma.ticket.findUnique({ where: { id: ticketId } })
    TicketService.broadcastTicketUpdate(ticketId, 'ticket:updated', ticket.queue)
    return { ticket: TicketService['mapTicket'](updated), removedName }
  }
}
