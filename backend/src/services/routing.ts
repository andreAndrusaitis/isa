import prisma from '../config/prisma'
import { effectiveProjectRole, isSystemAdmin } from './projectAccess'
import { z } from 'zod'
import { createAuditLog } from './audit'
import { computeTicketTypeChange } from './ticketTypeChange'
import { TicketService } from './tickets'
import { NotificationService } from './notifications'
import { emitWebhookEvent, buildTicketPayload } from './webhookEvents'
import { getBusinessHoursConfig } from './businessHours'
import { buildTicketVars, renderTemplate } from './templateVariables'
import { AppError } from '../middlewares/errorHandler'
import { SYSTEM_USER_ID } from '../utils/constants'
import { isBusinessTime } from '../utils/businessHours'
import { DOMAIN_REGEX, sanitizeDomain } from '../utils/domainValidation'
import { routingTaskTemplateSchema, linkTicketBySystem, createTaskForRoutedTicket } from './ticketTaskLink'
import { getEffectiveScope, canSeeOrg, type EffectiveScope } from './scope'
import { assertValidAssignee, getTicketAccess, TICKET_ACCESS_SELECT } from './ticketAccess'
import { can } from '../access/can'
import { CAPABILITIES, type CapabilityKey } from '../access/capabilities'
import { forbidden } from '../utils/denials'

// ── Catálogo ──────────────────────────────────────────────────────────────────
// Fonte única de gatilhos, campos, operadores e ações. Exposto por
// GET /routing/schema (funções `get` somem no JSON) e usado na validação.

type Option = { id: string; label: string }
// Tipo do valor: 'text' = livre, 'enum' = `options` fixas, 'none' = sem valor,
// demais = id de uma entidade que o painel lista (fila, empresa, usuário…).
// project_task = id de task; project_task_template = JSON {projectId, taskTypeId, dueInDays}.
type ValueKind = 'text' | 'enum' | 'none' | 'queue' | 'org' | 'tier' | 'category' | 'subcategory' | 'requester' | 'staff' | 'agent' | 'macro' | 'webhook' | 'project_task' | 'project_task_template'

const PRIORITY_OPTIONS: Option[] = [{ id: 'low', label: 'Baixa' }, { id: 'medium', label: 'Média' }, { id: 'high', label: 'Alta' }]
const TYPE_OPTIONS: Option[] = [{ id: 'incident', label: 'Incidente' }, { id: 'request', label: 'Requisição' }, { id: 'problem', label: 'Problema' }, { id: 'change', label: 'Mudança' }]
const STATUS_OPTIONS: Option[] = [{ id: 'open', label: 'Aberto' }, { id: 'in_progress', label: 'Em atendimento' }, { id: 'pending', label: 'Pendente' }, { id: 'resolved', label: 'Resolvido' }, { id: 'closed', label: 'Fechado' }]
const YES_NO: Option[] = [{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }]

export const ROUTING_TRIGGERS = [
  { id: 'ticket_created',  label: 'Chamado criado' },
  { id: 'ticket_updated',  label: 'Chamado atualizado (status, fila, prioridade ou responsável)' },
  { id: 'client_message',  label: 'Nova mensagem do cliente' },
  { id: 'ticket_idle',     label: 'Chamado parado há X horas', needsHours: true },
  { id: 'ticket_reopened', label: 'Chamado reaberto' },
] as const
export type RoutingTrigger = (typeof ROUTING_TRIGGERS)[number]['id']

export const ROUTING_OPERATORS = [
  { id: 'equals',       label: 'é igual a' },
  { id: 'not_equals',   label: 'não é' },
  { id: 'contains',     label: 'contém' },
  { id: 'not_contains', label: 'não contém' },
  { id: 'starts_with',  label: 'começa com' },
  { id: 'in',           label: 'está em', multi: true },
  { id: 'not_in',       label: 'não está em', multi: true },
  { id: 'is_empty',     label: 'está vazio', noValue: true },
  { id: 'is_not_empty', label: 'não está vazio', noValue: true },
] as const
// Regex ficou de fora (ReDoS em descrição livre); avaliar com timeout/RE2 se pedirem.

const TEXT_OPS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'in', 'not_in', 'is_empty', 'is_not_empty']
const ALWAYS_SET_TEXT_OPS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'in', 'not_in']
const REF_OPS = ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty']
const ENUM_OPS = ['equals', 'not_equals', 'in', 'not_in']
const BOOL_OPS = ['equals']

type RoutingTicket = NonNullable<Awaited<ReturnType<typeof loadTicket>>>
type EvalCtx = { businessHours: boolean }
type FieldDef = { id: string; label: string; kind: ValueKind; operators: string[]; options?: Option[]; get: (t: RoutingTicket, ctx: EvalCtx) => unknown }

export const ROUTING_FIELDS: FieldDef[] = [
  { id: 'email_domain',     label: 'Domínio do e-mail',      kind: 'text',        operators: ALWAYS_SET_TEXT_OPS, get: t => t.user.email.split('@')[1] },
  { id: 'email',            label: 'E-mail do solicitante',  kind: 'text',        operators: ALWAYS_SET_TEXT_OPS, get: t => t.user.email },
  { id: 'requester',        label: 'Solicitante',            kind: 'requester',   operators: ENUM_OPS,  get: t => t.user_id },
  { id: 'created_by',       label: 'Aberto em nome do cliente por', kind: 'staff', operators: REF_OPS, get: t => t.created_by_id },
  { id: 'org_tier',         label: 'Plano da empresa',       kind: 'tier',        operators: ENUM_OPS,  get: t => t.org?.tier },
  { id: 'organization',     label: 'Empresa',                kind: 'org',         operators: REF_OPS,   get: t => t.org_id },
  { id: 'category',         label: 'Categoria',              kind: 'category',    operators: REF_OPS,   get: t => t.category_id },
  { id: 'subcategory',      label: 'Subcategoria',           kind: 'subcategory', operators: REF_OPS,   get: t => t.subcategory_id },
  { id: 'subject_contains', label: 'Assunto',                kind: 'text',        operators: TEXT_OPS,  get: t => t.title },
  { id: 'description',      label: 'Descrição',              kind: 'text',        operators: TEXT_OPS,  get: t => t.description },
  { id: 'priority',         label: 'Prioridade',             kind: 'enum',        operators: ENUM_OPS,  options: PRIORITY_OPTIONS, get: t => t.priority },
  { id: 'queue',            label: 'Fila',                   kind: 'queue',       operators: REF_OPS,   get: t => t.queue },
  { id: 'ticket_type',      label: 'Tipo de chamado',        kind: 'enum',        operators: ENUM_OPS,  options: TYPE_OPTIONS, get: t => t.type },
  { id: 'status',           label: 'Status',                 kind: 'enum',        operators: ENUM_OPS,  options: STATUS_OPTIONS, get: t => t.status },
  { id: 'assignee',         label: 'Responsável',            kind: 'agent',       operators: REF_OPS,   get: t => t.assigned_to_id },
  { id: 'business_hours',   label: 'Horário comercial',      kind: 'enum',        operators: BOOL_OPS,  options: YES_NO, get: (_t, ctx) => (ctx.businessHours ? 'yes' : 'no') },
  { id: 'is_reopened',      label: 'Chamado reaberto',       kind: 'enum',        operators: BOOL_OPS,  options: YES_NO, get: t => (t.is_reopened ? 'yes' : 'no') },
]

type ActionDef = { id: string; label: string; kind: ValueKind; options?: Option[] }
export const ROUTING_ACTIONS: ActionDef[] = [
  { id: 'set_queue',       label: 'Encaminhar para fila',      kind: 'queue' },
  { id: 'set_priority',    label: 'Definir prioridade',        kind: 'enum', options: PRIORITY_OPTIONS },
  { id: 'set_type',        label: 'Definir tipo de chamado',   kind: 'enum', options: TYPE_OPTIONS },
  // 'pending' fica de fora: exige motivo, justificativa e evidência.
  { id: 'set_status',      label: 'Mudar status',              kind: 'enum', options: STATUS_OPTIONS.filter(s => s.id !== 'pending') },
  { id: 'set_category',    label: 'Mudar categoria',           kind: 'category' },
  { id: 'set_subcategory', label: 'Mudar subcategoria',        kind: 'subcategory' },
  { id: 'assign_agent',    label: 'Atribuir ao analista',      kind: 'agent' },
  { id: 'add_participant', label: 'Adicionar participante',    kind: 'agent' },
  { id: 'send_macro',      label: 'Enviar mensagem com macro', kind: 'macro' },
  { id: 'notify_user',     label: 'Notificar usuário',         kind: 'staff' },
  { id: 'notify_queue',    label: 'Notificar fila',            kind: 'queue' },
  { id: 'send_webhook',    label: 'Disparar webhook',          kind: 'webhook' },
  { id: 'create_project_task', label: 'Criar task no projeto e vincular', kind: 'project_task_template' },
  { id: 'link_project_task',   label: 'Vincular a uma task de projeto',   kind: 'project_task' },
  { id: 'delete_ticket',   label: 'Excluir chamado (Lixeira)', kind: 'none' },
  { id: 'stop',            label: 'Parar de avaliar as próximas regras', kind: 'none' },
]

const FIELD_BY_ID = Object.fromEntries(ROUTING_FIELDS.map(f => [f.id, f]))
const ACTION_BY_ID = Object.fromEntries(ROUTING_ACTIONS.map(a => [a.id, a]))
const OPERATOR_BY_ID: Record<string, { label: string; multi?: boolean; noValue?: boolean }> = Object.fromEntries(ROUTING_OPERATORS.map(o => [o.id, o]))
const TRIGGER_LABEL: Record<string, string> = Object.fromEntries(ROUTING_TRIGGERS.map(t => [t.id, t.label]))

export function getRoutingSchema() {
  return { triggers: ROUTING_TRIGGERS, operators: ROUTING_OPERATORS, fields: ROUTING_FIELDS, actions: ROUTING_ACTIONS }
}

// ── Validação ─────────────────────────────────────────────────────────────────

const ids = (list: { id: string }[]) => list.map(x => x.id) as [string, ...string[]]
const splitList = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean)

export const routingConditionSchema = z.object({
  field: z.enum(ids(ROUTING_FIELDS)),
  operator: z.enum(ids([...ROUTING_OPERATORS])),
  value: z.string().max(2000).default(''),
}).superRefine((cond, ctx) => {
  const field = FIELD_BY_ID[cond.field]
  const op = OPERATOR_BY_ID[cond.operator]
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
  if (!field.operators.includes(cond.operator)) return issue('operator', `Operador "${op.label}" não se aplica a ${field.label}`)
  if (op.noValue) return
  const values = op.multi ? splitList(cond.value) : [cond.value.trim()].filter(Boolean)
  if (!values.length) return issue('value', `Informe o valor da condição "${field.label}"`)
  if (field.options) {
    const bad = values.find(v => !field.options!.some(o => o.id === v))
    if (bad) issue('value', `Valor "${bad}" inválido para ${field.label}`)
  }
  // Domínio exato precisa ser válido; contains/starts_with aceitam trecho.
  if (cond.field === 'email_domain' && ['equals', 'not_equals', 'in', 'not_in'].includes(cond.operator)) {
    for (const raw of values) {
      const sanitized = sanitizeDomain(raw)
      if (!sanitized || !DOMAIN_REGEX.test(sanitized)) {
        issue('value', `Domínio de e-mail inválido: "${raw}". Informe apenas o domínio com ponto e TLD válido (ex: suaempresa.com.br).`)
      }
    }
  }
}).transform((cond) => {
  if (OPERATOR_BY_ID[cond.operator].noValue) return { ...cond, value: '' }
  if (cond.field === 'email_domain' && ['equals', 'not_equals', 'in', 'not_in'].includes(cond.operator)) {
    return { ...cond, value: splitList(cond.value).map(sanitizeDomain).filter(Boolean).join(', ') }
  }
  return cond
})

export const routingActionSchema = z.object({
  type: z.enum(ids(ROUTING_ACTIONS)),
  value: z.string().max(200).default(''),
}).superRefine((a, ctx) => {
  const def = ACTION_BY_ID[a.type]
  if (def.kind === 'none') return
  if (!a.value.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: `Informe o valor da ação "${def.label}"` })
  } else if (def.options && !def.options.some(o => o.id === a.value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: `Valor "${a.value}" inválido para ${def.label}` })
  } else if (def.kind === 'project_task_template' && !parseTaskTemplate(a.value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: `Ação "${def.label}": escolha projeto, tipo e prazo (1 a 365 dias)` })
  }
})

function parseTaskTemplate(value: string) {
  try { return routingTaskTemplateSchema.parse(JSON.parse(value)) } catch { return null }
}

const ruleShape = z.object({
  name: z.string().min(1, 'Nome da regra é obrigatório'),
  enabled: z.boolean().default(true),
  priority: z.number().int(),
  conditions: z.array(routingConditionSchema).min(1, 'Ao menos uma condição é obrigatória'),
  matchType: z.enum(['all', 'any']).default('all'),
  actions: z.array(routingActionSchema).min(1, 'Ao menos uma ação é obrigatória'),
  elseActions: z.array(routingActionSchema).optional(),
  trigger: z.enum(ids([...ROUTING_TRIGGERS])).default('ticket_created'),
  triggerHours: z.number().int().min(1).max(720).nullable().optional(),
  stopProcessing: z.boolean().default(true),
})

export const routingRuleSchema = ruleShape.superRefine((r, ctx) => {
  if (r.trigger === 'ticket_idle' && !r.triggerHours) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['triggerHours'], message: 'Informe após quantas horas parado a regra dispara' })
  }
})
export const routingRulePatchSchema = ruleShape.partial()

type RuleInput = z.infer<typeof routingRuleSchema>
type Action = { type: string; value: string }
type Condition = { field: string; operator: string; value: string }

// Motivo pelo qual o analista não pode receber o chamado, ou null se pode.
async function agentProblem(agentId: string, queueId: string | null): Promise<string | null> {
  const agent = await prisma.user.findFirst({
    where: { id: agentId, active: true, deleted_at: null },
    select: { name: true, role: true, queues: true },
  })
  if (!agent || agent.role !== 'agent') return 'analista não encontrado ou inativo'
  if (queueId && !(agent.queues ?? []).includes(queueId)) return `${agent.name} não pertence à fila do chamado`
  return null
}

// Motivo pelo qual a ação de projeto não vale, ou null. Projetos só são visíveis
// aos membros: quem configura precisa editar no projeto (ações já salvas na regra
// passam sem essa checagem, para outro gestor poder editar o resto da regra).
async function projectActionProblem(a: Action, actorId: string | undefined, kept: boolean): Promise<string | null> {
  let projectId: string
  if (a.type === 'link_project_task') {
    const task = await prisma.task.findFirst({
      where: { id: a.value, archived_at: null, project: { archived_at: null } },
      select: { project_id: true, due_date: true, status: { select: { category: true } } },
    })
    if (!task) return 'task não encontrada ou arquivada'
    if (!task.due_date) return 'a task precisa ter prazo (o chamado segue esse prazo)'
    if (task.status.category === 'done' || task.status.category === 'cancelled') return 'task concluída ou cancelada'
    projectId = task.project_id
  } else {
    const tpl = parseTaskTemplate(a.value)!
    const type = await prisma.taskType.findFirst({ where: { id: tpl.taskTypeId, project_id: tpl.projectId, is_active: true, project: { archived_at: null } } })
    if (!type) return 'projeto arquivado ou tipo de task inexistente nele'
    projectId = tpl.projectId
  }
  if (kept || !actorId) return null
  const role = await effectiveProjectRole(projectId, actorId)
  return role && role !== 'viewer' ? null : 'você precisa ser membro do projeto (com edição) para usá-lo numa regra'
}

// Checagens que dependem do banco: analista existe e, se a mesma regra move
// o chamado de fila, pertence à fila de destino; ação de projeto aponta para algo válido.
async function assertActionRefs(actions: Action[] | undefined, actorId?: string, existing: Action[] = []) {
  if (!actions) return
  const targetQueue = actions.find(a => a.type === 'set_queue')?.value ?? null
  for (const a of actions) {
    let problem: string | null = null
    if (a.type === 'assign_agent' || a.type === 'add_participant') {
      problem = await agentProblem(a.value, a.type === 'assign_agent' ? targetQueue : null)
    } else if (a.type === 'link_project_task' || a.type === 'create_project_task') {
      problem = await projectActionProblem(a, actorId, existing.some(e => e.type === a.type && e.value === a.value))
    }
    if (problem) throw new AppError(400, `Ação "${ACTION_BY_ID[a.type].label}": ${problem}.`, 'INVALID_ROUTING_ACTION')
  }
}

// ── Quem salva a regra ────────────────────────────────────────────────────────
// A regra roda como sistema em todos os chamados, então o limite de quem a escreve
// é checado aqui, na escrita. Regras já salvas seguem executando como estão.

export type RuleAuthor = { sub: string; role: string; permissions?: string[] | null }
type RuleReach = { conditions: Condition[]; matchType: string; actions: Action[]; elseActions: Action[]; trigger: string; triggerHours: number | null }

// Feitas à mão, estas ações exigem permissão que routing.manage não dá.
const ACTION_CAPABILITY: Record<string, CapabilityKey> = { delete_ticket: 'tickets.delete', send_webhook: 'integrations.manage' }

const sameAction = (a: Action, b: Action) => a.type === b.type && (a.value ?? '') === (b.value ?? '')
const conditionKey = (c: Condition) => [c.field, c.operator, c.value ?? ''].join('\0')

// O formulário reenvia a regra inteira: mudança é valor diferente, não campo presente.
// Campo a campo porque o jsonb não preserva a ordem das chaves.
function retargeted(next: RuleReach, saved: RuleReach) {
  return next.matchType !== saved.matchType || next.trigger !== saved.trigger || next.triggerHours !== saved.triggerHours
    || next.conditions.map(conditionKey).join('\n') !== saved.conditions.map(conditionKey).join('\n')
}

// Em "all" toda condição precisa valer, então uma condição de empresa da carteira limita a regra.
function limitedToScope(rule: RuleReach, scope: EffectiveScope) {
  return rule.matchType === 'all' && rule.conditions.some(c => {
    if (c.field !== 'organization' || !['equals', 'in'].includes(c.operator)) return false
    const orgIds = c.operator === 'in' ? splitList(c.value) : [c.value.trim()]
    return orgIds.length > 0 && orgIds.every(id => canSeeOrg(scope, id))
  })
}

/**
 * Ação já salva passa quando se edita outra parte da regra (mesmo padrão de
 * projectActionProblem), mas não quando muda onde ela age: reescrever as condições
 * de uma regra com "excluir chamado" daria a exclusão a quem não tem a permissão.
 */
async function assertRuleAuthor(author: RuleAuthor | undefined, next: RuleReach, saved?: RuleReach) {
  if (!author || author.role === 'admin') return
  const moved = !saved || retargeted(next, saved)
  const kept = (branch: 'actions' | 'elseActions', a: Action) => !!saved && saved[branch].some(e => sameAction(e, a))

  for (const branch of ['actions', 'elseActions'] as const) {
    for (const a of next[branch]) {
      const capability = ACTION_CAPABILITY[a.type]
      if (!capability || can(author, capability) || (!moved && kept(branch, a))) continue
      throw forbidden('PERMISSION_REQUIRED', `A ação "${ACTION_BY_ID[a.type].label}" exige a permissão "${CAPABILITIES[capability].label}", que só o administrador concede.`)
    }
  }

  const added = next.actions.some(a => !kept('actions', a)) || next.elseActions.some(a => !kept('elseActions', a))
  if (!moved && !added) return
  const scope = await getEffectiveScope(author.sub, author.role)
  if (scope.scopeAll) return
  // O senão roda em todo chamado que não casa, ou seja, justamente nas outras empresas.
  if (next.elseActions.length > 0) {
    throw forbidden('ROUTING_ELSE_OUT_OF_SCOPE', 'Com carteira restrita a regra não pode ter ações em "senão": elas rodariam em chamados de outras empresas.')
  }
  if (!limitedToScope(next, scope)) {
    throw forbidden('ROUTING_SCOPE_REQUIRED', 'A regra precisa valer só para a sua carteira: use "todas as condições" com a condição Empresa (é igual a ou está em) apontando para empresas da sua carteira.')
  }
}

/** Projetos onde o usuário edita, com tipos e tasks vinculáveis — opções das ações de projeto. */
export async function listProjectTargets(userId: string) {
  const projects = await prisma.project.findMany({
    where: { archived_at: null, ...((await isSystemAdmin(userId)) ? {} : { members: { some: { user_id: userId, role: { in: ['owner', 'manager', 'member'] } } } }) },
    select: {
      id: true, name: true,
      task_types: { where: { is_active: true }, select: { id: true, name: true, prefix: true }, orderBy: { position: 'asc' } },
      tasks: {
        where: { archived_at: null, due_date: { not: null }, status: { category: { notIn: ['done', 'cancelled'] } } },
        select: { id: true, key: true, seq: true, title: true, due_date: true },
        orderBy: { due_date: 'asc' },
        take: 300,
      },
    },
    orderBy: { name: 'asc' },
  })
  return projects.map(p => ({
    id: p.id, name: p.name,
    taskTypes: p.task_types,
    tasks: p.tasks.map(t => ({ id: t.id, key: t.key ?? `#${t.seq}`, title: t.title, dueDate: t.due_date })),
  }))
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

type RuleRow = Awaited<ReturnType<typeof prisma.routingRule.findFirstOrThrow>>

function toDto(r: RuleRow) {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    conditions: r.conditions,
    matchType: r.match_type,
    actions: r.actions,
    elseActions: r.else_actions ?? [],
    trigger: r.trigger,
    triggerHours: r.trigger_hours,
    stopProcessing: r.stop_processing,
  }
}

export async function listRoutingRules() {
  const rules = await prisma.routingRule.findMany({ orderBy: { priority: 'asc' } })
  return rules.map(toDto)
}

export async function createRoutingRule(data: RuleInput, actorId?: string, author?: RuleAuthor) {
  await assertRuleAuthor(author, {
    conditions: data.conditions, matchType: data.matchType, actions: data.actions, elseActions: data.elseActions ?? [],
    trigger: data.trigger, triggerHours: data.trigger === 'ticket_idle' ? data.triggerHours ?? null : null,
  })
  await assertActionRefs(data.actions, actorId)
  await assertActionRefs(data.elseActions, actorId)
  const rule = await prisma.routingRule.create({
    data: {
      name: data.name,
      priority: data.priority,
      enabled: data.enabled,
      conditions: data.conditions as any,
      match_type: data.matchType,
      actions: data.actions as any,
      else_actions: data.elseActions as any,
      trigger: data.trigger,
      trigger_hours: data.trigger === 'ticket_idle' ? data.triggerHours : null,
      stop_processing: data.stopProcessing,
    }
  })

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'CREATE_ROUTING_RULE',
      resource: 'ROUTING',
      details: { ruleId: rule.id, name: rule.name }
    })
  }

  return toDto(rule)
}

export async function updateRoutingRule(id: string, data: Partial<RuleInput>, actorId?: string, author?: RuleAuthor) {
  const current = await prisma.routingRule.findUnique({ where: { id } })
  if (!current) throw new AppError(404, 'Regra não encontrada', 'NOT_FOUND')

  const trigger = data.trigger ?? current.trigger
  const triggerHours = data.triggerHours !== undefined ? data.triggerHours : current.trigger_hours
  if (trigger === 'ticket_idle' && !triggerHours) {
    throw new AppError(400, 'Informe após quantas horas parado a regra dispara', 'INVALID_ROUTING_RULE')
  }
  const saved = { ...ruleOf(current), trigger: current.trigger as string, triggerHours: current.trigger_hours }
  await assertRuleAuthor(author, {
    conditions: data.conditions ?? saved.conditions,
    matchType: data.matchType ?? saved.matchType,
    actions: data.actions ?? saved.actions,
    elseActions: data.elseActions ?? saved.elseActions,
    trigger,
    triggerHours: trigger === 'ticket_idle' ? triggerHours ?? null : null,
  }, saved)
  const kept = [...(current.actions as Action[]), ...((current.else_actions ?? []) as Action[])]
  await assertActionRefs(data.actions, actorId, kept)
  await assertActionRefs(data.elseActions, actorId, kept)

  const updateData: any = {}
  if (data.name !== undefined)           updateData.name = data.name
  if (data.enabled !== undefined)        updateData.enabled = data.enabled
  if (data.priority !== undefined)       updateData.priority = data.priority
  if (data.conditions !== undefined)     updateData.conditions = data.conditions
  if (data.matchType !== undefined)      updateData.match_type = data.matchType
  if (data.actions !== undefined)        updateData.actions = data.actions
  if (data.elseActions !== undefined)    updateData.else_actions = data.elseActions
  if (data.stopProcessing !== undefined) updateData.stop_processing = data.stopProcessing
  if (data.trigger !== undefined || data.triggerHours !== undefined) {
    updateData.trigger = trigger
    updateData.trigger_hours = trigger === 'ticket_idle' ? triggerHours : null
  }

  const rule = await prisma.routingRule.update({
    where: { id },
    data: updateData,
  })

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'UPDATE_ROUTING_RULE',
      resource: 'ROUTING',
      details: { ruleId: id, changes: data }
    })
  }

  return toDto(rule)
}

export async function deleteRoutingRule(id: string, actorId?: string) {
  const result = await prisma.routingRule.delete({ where: { id } })

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'DELETE_ROUTING_RULE',
      resource: 'ROUTING',
      details: { ruleId: id }
    })
  }

  return result
}

export async function reorderRoutingRules(ids: string[], actorId?: string) {
  const updates = ids.map((id, index) =>
    prisma.routingRule.update({
      where: { id },
      data: { priority: index + 1 },
    })
  )
  const result = await prisma.$transaction(updates)

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'REORDER_ROUTING_RULES',
      resource: 'ROUTING',
      details: { ids }
    })
  }

  return result
}

// ── Avaliação ─────────────────────────────────────────────────────────────────

function loadTicket(id: string) {
  return prisma.ticket.findUnique({ where: { id }, include: { org: true, user: true } })
}

async function buildCtx(): Promise<EvalCtx> {
  return { businessHours: isBusinessTime(new Date(), await getBusinessHoursConfig()) }
}

export function testCondition(c: Condition, t: RoutingTicket, ctx: EvalCtx): boolean {
  const field = FIELD_BY_ID[c.field]
  if (!field) return false
  const actual = String(field.get(t, ctx) ?? '').trim().toLowerCase()
  const expected = String(c.value ?? '').trim().toLowerCase()
  const list = splitList(expected)
  switch (c.operator) {
    case 'equals':       return actual === expected
    case 'not_equals':   return actual !== expected
    case 'contains':     return actual.includes(expected)
    case 'not_contains': return !actual.includes(expected)
    case 'starts_with':  return actual.startsWith(expected)
    case 'in':           return list.includes(actual)
    case 'not_in':       return !list.includes(actual)
    case 'is_empty':     return actual === ''
    case 'is_not_empty': return actual !== ''
    default:             return false
  }
}

function matches(rule: { conditions: Condition[]; matchType: string }, t: RoutingTicket, ctx: EvalCtx) {
  const results = rule.conditions.map(c => testCondition(c, t, ctx))
  return rule.matchType === 'any' ? results.some(Boolean) : results.every(Boolean)
}

// Rótulo legível de um valor (id → nome) para histórico e teste de regra.
async function valueLabel(kind: ValueKind, value: string | null | undefined, options?: Option[]): Promise<string> {
  if (!value) return '—'
  if (options) return options.find(o => o.id === value)?.label ?? value
  const id = value
  let row: { name?: string; title?: string } | null = null
  if (kind === 'queue') row = await prisma.queue.findUnique({ where: { id }, select: { name: true } })
  if (kind === 'org') row = await prisma.organization.findUnique({ where: { id }, select: { name: true } })
  if (kind === 'category') row = await prisma.category.findUnique({ where: { id }, select: { name: true } })
  if (kind === 'subcategory') row = await prisma.subcategory.findUnique({ where: { id }, select: { name: true } })
  if (kind === 'requester' || kind === 'staff' || kind === 'agent') row = await prisma.user.findUnique({ where: { id }, select: { name: true } })
  if (kind === 'macro') row = await prisma.macro.findUnique({ where: { id }, select: { title: true } })
  if (kind === 'webhook') row = await prisma.webhookEndpoint.findUnique({ where: { id }, select: { name: true } })
  if (kind === 'project_task') {
    const task = await prisma.task.findUnique({ where: { id }, select: { key: true, seq: true, title: true, project: { select: { name: true } } } })
    return task ? `${task.project.name} › ${task.key ?? `#${task.seq}`} ${task.title}` : value
  }
  if (kind === 'project_task_template') {
    const tpl = parseTaskTemplate(value)
    if (!tpl) return value
    const [project, type] = await Promise.all([
      prisma.project.findUnique({ where: { id: tpl.projectId }, select: { name: true } }),
      prisma.taskType.findUnique({ where: { id: tpl.taskTypeId }, select: { name: true } }),
    ])
    return `${project?.name ?? 'projeto'} · ${type?.name ?? 'tipo'} · prazo ${tpl.dueInDays} dia(s)`
  }
  return row?.name ?? row?.title ?? value
}

const listLabel = (kind: ValueKind, value: string, options?: Option[]) =>
  Promise.all(splitList(value).map(v => valueLabel(kind, v, options))).then(l => l.join(', '))

async function describeAction(a: Action): Promise<string> {
  const def = ACTION_BY_ID[a.type]
  if (!def) return a.type
  return def.kind === 'none' ? def.label : `${def.label}: ${await valueLabel(def.kind, a.value, def.options)}`
}

// ── Execução ──────────────────────────────────────────────────────────────────

// Grava direto no chamado, sem passar pelo updateTicket: vale a mesma regra de quem
// atribui à mão, na fila em que o chamado vai ficar. Sem empresa não há carteira a respeitar.
async function assignProblem(agentId: string, t: RoutingTicket, targetQueue: string | null): Promise<string | null> {
  const problem = await agentProblem(agentId, targetQueue)
  if (problem || !t.org_id) return problem
  try {
    await assertValidAssignee({ ...t, queue: targetQueue }, agentId)
    return null
  } catch (err: any) {
    return err?.message ?? String(err)
  }
}

const ruleOf = (r: RuleRow) => ({
  id: r.id,
  name: r.name,
  conditions: r.conditions as Condition[],
  matchType: r.match_type,
  actions: r.actions as Action[],
  elseActions: (r.else_actions ?? []) as Action[],
  stopProcessing: r.stop_processing,
})

/**
 * Executa as ações de uma regra. Campos do chamado vão num único update direto
 * (sem disparar gatilhos); mudança de status passa pelo updateTicket com
 * origin 'routing' para manter pausa de SLA/pesquisa sem reentrar no gatilho
 * "chamado atualizado". Cada ação inválida é pulada e registrada no histórico.
 */
async function executeActions(actions: Action[], t: RoutingTicket, rule: { id: string; name: string }, trigger: RoutingTrigger) {
  const patch: Record<string, unknown> = {}
  const notes: string[] = []
  const after: Action[] = []
  let stop = false
  let deleted = false
  const targetQueue = actions.find(a => a.type === 'set_queue')?.value ?? t.queue

  for (const a of actions) {
    const label = await describeAction(a)
    try {
      switch (a.type) {
        case 'set_queue':    patch.queue = a.value; break
        case 'set_priority': patch.priority = a.value; break
        case 'set_category':
          patch.category_id = a.value
          if (!('subcategory_id' in patch)) patch.subcategory_id = null
          break
        case 'set_subcategory': {
          const sub = await prisma.subcategory.findUnique({ where: { id: a.value }, select: { category_id: true } })
          if (!sub) throw new Error('subcategoria não encontrada')
          patch.subcategory_id = a.value
          patch.category_id = sub.category_id
          break
        }
        case 'assign_agent': {
          const problem = await assignProblem(a.value, t, targetQueue)
          if (problem) throw new Error(problem)
          patch.assigned_to_id = a.value
          break
        }
        case 'set_type': {
          if (a.value === t.type) break
          const change = await computeTicketTypeChange(t, a.value)
          Object.assign(patch, {
            type: change.type,
            display_number: change.display_number,
            sla_deadline: change.sla_deadline,
            first_response_deadline: change.first_response_deadline,
          })
          break
        }
        case 'stop':          stop = true; break
        case 'delete_ticket': deleted = true; break
        default:              after.push(a); continue // executadas depois do update
      }
      notes.push(label)
    } catch (err: any) {
      notes.push(`${label} (ignorada: ${err?.message ?? err})`)
    }
  }

  if (Object.keys(patch).length > 0) {
    await prisma.ticket.update({ where: { id: t.id }, data: patch as any })
  }

  for (const a of after) {
    const label = await describeAction(a)
    try {
      switch (a.type) {
        case 'set_status':
          if (a.value !== t.status) {
            await TicketService.updateTicket(t.id, 'system', 'system', { status: a.value, note: `Regra de automação "${rule.name}".` }, { origin: 'routing' })
          }
          break
        case 'add_participant': {
          const problem = await agentProblem(a.value, null)
          if (problem) throw new Error(problem)
          await prisma.ticketParticipant.upsert({
            where: { ticket_id_agent_id: { ticket_id: t.id, agent_id: a.value } },
            update: { role: 'collaborator', active: true, removed_at: null },
            create: { ticket_id: t.id, agent_id: a.value, role: 'collaborator' },
          })
          break
        }
        case 'send_macro': {
          const macro = await prisma.macro.findFirst({ where: { id: a.value, active: true }, select: { content: true } })
          if (!macro) throw new Error('macro não encontrada ou inativa')
          // {{link_pesquisa}} fica vazio aqui (gerar o token cria a pesquisa); entra se pedirem.
          const vars = await buildTicketVars(t.id, { analystId: t.assigned_to_id ?? undefined })
          await TicketService.addMessage(t.id, 'system', renderTemplate(macro.content, vars), 'agent')
          break
        }
        case 'notify_user':
          await NotificationService.create({ userId: a.value, ticketId: t.id, type: 'routing_alert', title: t.title, body: `Regra de automação "${rule.name}"` })
          break
        case 'notify_queue': {
          const members = await prisma.user.findMany({
            where: { role: { in: ['agent', 'supervisor'] }, queues: { has: a.value }, active: true, deleted_at: null },
            select: { id: true },
          })
          for (const m of members) {
            await NotificationService.create({ userId: m.id, ticketId: t.id, type: 'routing_alert', title: t.title, body: `Regra de automação "${rule.name}"` })
          }
          break
        }
        case 'link_project_task':
          await linkTicketBySystem(a.value, t.id, rule.name)
          break
        case 'create_project_task': {
          const tpl = parseTaskTemplate(a.value)
          if (!tpl) throw new Error('configuração da task inválida')
          await createTaskForRoutedTicket(t.id, tpl, rule.name)
          break
        }
        case 'send_webhook': {
          const fresh = await prisma.ticket.findUnique({ where: { id: t.id } })
          emitWebhookEvent('ticket.updated', { ticket: buildTicketPayload(fresh), routing_rule: { id: rule.id, name: rule.name, trigger } }, a.value)
          break
        }
      }
      notes.push(label)
    } catch (err: any) {
      notes.push(`${label} (ignorada: ${err?.message ?? err})`)
    }
  }

  // Histórico no chamado (antes da exclusão, para ficar na Lixeira com o motivo).
  const current = await prisma.ticket.findUnique({ where: { id: t.id }, select: { status: true } })
  await prisma.ticketEvent.create({
    data: {
      ticket_id: t.id,
      user_id: SYSTEM_USER_ID,
      from_status: current?.status ?? t.status,
      to_status: current?.status ?? t.status,
      note: `Regra de automação "${rule.name}" (${TRIGGER_LABEL[trigger]}): ${notes.join('; ')}.`,
      routing_rule_id: rule.id,
    },
  })

  if (deleted) {
    await TicketService.deleteTicket(t.id, { actorId: SYSTEM_USER_ID })
  } else if (trigger !== 'ticket_created' && Object.keys(patch).length > 0) {
    // Na criação o próprio createTicket transmite o chamado já roteado.
    TicketService.broadcastTicketUpdate(t.id, 'ticket:updated', t.queue, 'assigned_to_id' in patch ? t.assigned_to_id : null)
  }

  return { stop: stop || deleted, deleted, changes: patch }
}

async function applyRules(ticketId: string, rules: RuleRow[], trigger: RoutingTrigger) {
  const ctx = await buildCtx()
  const changes: Record<string, unknown> = {}
  for (const row of rules) {
    const rule = ruleOf(row)
    const t = await loadTicket(ticketId) // recarrega: a regra anterior pode ter mudado o chamado
    if (!t || t.deleted_at) break
    const matched = matches(rule, t, ctx)
    const branch = matched ? rule.actions : rule.elseActions
    if (!matched && branch.length === 0) continue
    const res = await executeActions(branch, t, rule, trigger)
    Object.assign(changes, res.changes)
    if (res.stop || rule.stopProcessing) break
  }
  return changes
}

/** Roda as regras ativas do gatilho, em ordem de prioridade. Nunca deve derrubar o chamador. */
export async function runRoutingRules(ticketId: string, trigger: RoutingTrigger) {
  const rules = await prisma.routingRule.findMany({ where: { enabled: true, trigger }, orderBy: { priority: 'asc' } })
  if (rules.length === 0) return {}
  return applyRules(ticketId, rules, trigger)
}

// ── Simulação (triagem IA) ───────────────────────────────────────────────────

export type SimulatedField = 'type' | 'category' | 'subcategory' | 'priority'
export type SimulatedOutcome = Partial<Record<SimulatedField, { value: string | null; rule: { id: string; name: string } }>>
export type TicketFieldsPatch = Partial<{ type: string; category_id: string | null; subcategory_id: string | null; priority: string }>

/**
 * Ações de campo (tipo, categoria, subcategoria, prioridade) que as regras do gatilho
 * aplicariam, sem gravar: mesma ordem e semântica de applyRules (ramo senão, parar
 * avaliação), e cada ação atualiza o chamado simulado como na execução real.
 */
async function simulateTrigger(t: RoutingTicket, trigger: RoutingTrigger, ctx: EvalCtx) {
  const rules = await prisma.routingRule.findMany({ where: { enabled: true, trigger }, orderBy: { priority: 'asc' } })
  const out: SimulatedOutcome = {}
  for (const row of rules) {
    const rule = ruleOf(row)
    const matched = matches(rule, t, ctx)
    const branch = matched ? rule.actions : rule.elseActions
    if (!matched && branch.length === 0) continue
    const ref = { id: rule.id, name: rule.name }
    for (const a of branch) {
      if (a.type === 'set_priority') {
        t = { ...t, priority: a.value as any }
        out.priority = { value: a.value, rule: ref }
      } else if (a.type === 'set_type') {
        t = { ...t, type: a.value as any }
        out.type = { value: a.value, rule: ref }
      } else if (a.type === 'set_category') {
        t = { ...t, category_id: a.value, subcategory_id: null }
        out.category = { value: a.value, rule: ref }
        out.subcategory = { value: null, rule: ref }
      } else if (a.type === 'set_subcategory') {
        const sub = await prisma.subcategory.findUnique({ where: { id: a.value }, select: { category_id: true } })
        if (!sub) continue // a execução real também ignora subcategoria inexistente
        t = { ...t, subcategory_id: a.value, category_id: sub.category_id }
        out.subcategory = { value: a.value, rule: ref }
        out.category = { value: sub.category_id, rule: ref }
      }
    }
    if (rule.stopProcessing || branch.some(a => a.type === 'stop' || a.type === 'delete_ticket')) break
  }
  return { t, out }
}

/**
 * O que as regras definiriam se o chamado tivesse os campos de `patch` (classificação da
 * triagem IA): `created` = regras de abertura reavaliadas com a classificação nova;
 * `updated` = regras de "chamado atualizado" sobre o resultado. Nada é gravado.
 */
export async function simulateRuleFields(ticketId: string, patch: TicketFieldsPatch) {
  const t = await loadTicket(ticketId)
  if (!t) return null
  const ctx = await buildCtx()
  const created = await simulateTrigger({ ...t, ...patch } as RoutingTicket, 'ticket_created', ctx)
  const updated = await simulateTrigger(created.t, 'ticket_updated', ctx)
  return { created: created.out, updated: updated.out }
}

/**
 * A triagem IA mudou a categoria depois da criação: reavalia as regras de
 * "chamado criado" com a mesma ordem/semântica de applyRules, mas aplica SÓ as
 * ações set_queue (nada de notificar, macro, prioridade etc.). Sem regra que
 * defina fila: se a fila atual veio de regra, volta à fila padrão da empresa;
 * se foi escolhida por pessoa, fica. Devolve {from,to} ou null se nada mudou.
 */
export async function rerouteQueueAfterReclassification(ticketId: string): Promise<{ from: string | null; to: string | null } | null> {
  const original = await loadTicket(ticketId)
  if (!original || original.deleted_at) return null
  const rules = await prisma.routingRule.findMany({ where: { enabled: true, trigger: 'ticket_created' }, orderBy: { priority: 'asc' } })
  const ctx = await buildCtx()
  let t = original
  let target: { queue: string; rule: { id: string; name: string } } | null = null
  for (const row of rules) {
    const rule = ruleOf(row)
    const matched = matches(rule, t, ctx)
    const branch = matched ? rule.actions : rule.elseActions
    if (!matched && branch.length === 0) continue
    const setQueue = branch.filter(a => a.type === 'set_queue').at(-1)
    if (setQueue) {
      target = { queue: setQueue.value, rule }
      t = { ...t, queue: setQueue.value } // regras seguintes enxergam a fila simulada
    }
    if (rule.stopProcessing || branch.some(a => a.type === 'stop' || a.type === 'delete_ticket')) break
  }
  const from = original.queue
  // Nenhuma regra define fila para a nova classificação, mas a fila atual veio de uma
  // regra de abertura (que não vale mais): volta para a fila padrão da empresa, como
  // numa abertura com a categoria certa. Fila escolhida por pessoa fica como está.
  let to: string | null | undefined = target?.queue
  if (!target && from && await queueSetByRule(ticketId)) to = await orgDefaultQueue(original.org_id)
  if (to === undefined || to === from) return null

  await prisma.ticket.update({ where: { id: ticketId }, data: { queue: to } })
  const [fromName, toName] = await Promise.all([valueLabel('queue', from), to ? valueLabel('queue', to) : 'sem fila'])
  await prisma.ticketEvent.create({
    data: {
      ticket_id: ticketId,
      user_id: SYSTEM_USER_ID,
      from_status: original.status,
      to_status: original.status,
      note: `Triagem IA reclassificou o chamado: fila ${fromName} → ${toName} (${target ? `regra "${target.rule.name}"` : 'fila padrão da empresa'})`,
      routing_rule_id: target?.rule.id ?? null,
    },
  })
  TicketService.broadcastTicketUpdate(ticketId, 'ticket:updated', from)
  return { from, to }
}

/** A fila atual foi posta por uma regra de automação (evento "Encaminhar para fila")? */
async function queueSetByRule(ticketId: string): Promise<boolean> {
  const label = ACTION_BY_ID.set_queue.label
  return !!(await prisma.ticketEvent.findFirst({
    where: { ticket_id: ticketId, routing_rule_id: { not: null }, note: { contains: label } }, select: { id: true },
  }))
}

/** Fila padrão do plano da empresa, a mesma regra do createTicket (só se a fila existir). */
async function orgDefaultQueue(orgId: string | null): Promise<string | null> {
  if (!orgId) return null
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { sla_config: { select: { default_queue: true } } } })
  const q = org?.sla_config?.default_queue
  return q && (await prisma.queue.findUnique({ where: { id: q }, select: { id: true } })) ? q : null
}

/**
 * Gatilho "chamado parado há X horas": chamado aberto sem atualização nem
 * mensagem desde o corte. Dispara uma vez por período parado (o evento da regra
 * no histórico marca que já rodou). Cada regra de inatividade é avaliada
 * isoladamente, pois cada uma tem seu próprio prazo.
 */
export async function runIdleRoutingRules(now = new Date()) {
  const rules = await prisma.routingRule.findMany({
    where: { enabled: true, trigger: 'ticket_idle', trigger_hours: { gt: 0 } },
    orderBy: { priority: 'asc' },
  })
  let fired = 0
  for (const rule of rules) {
    const cutoff = new Date(now.getTime() - rule.trigger_hours! * 3600_000)
    // 200 por execução, os que pararam mais recentemente primeiro; backlog antigo fica de fora.
    const candidates = await prisma.ticket.findMany({
      where: {
        deleted_at: null,
        status: { notIn: ['resolved', 'closed'] },
        updated_at: { lt: cutoff },
        messages: { none: { created_at: { gte: cutoff } } },
      },
      select: {
        id: true,
        updated_at: true,
        messages: { select: { created_at: true }, orderBy: { created_at: 'desc' }, take: 1 },
        events: { where: { routing_rule_id: rule.id }, select: { created_at: true }, orderBy: { created_at: 'desc' }, take: 1 },
      },
      orderBy: { updated_at: 'desc' },
      take: 200,
    })
    for (const c of candidates) {
      const lastActivity = Math.max(c.updated_at.getTime(), c.messages[0]?.created_at.getTime() ?? 0)
      if (c.events[0] && c.events[0].created_at.getTime() >= lastActivity) continue
      try {
        await applyRules(c.id, [rule], 'ticket_idle')
        fired++
      } catch (err) {
        console.error(`[routing] Erro na regra de inatividade ${rule.id} no chamado ${c.id}:`, err)
      }
    }
  }
  return { rules: rules.length, evaluated: fired }
}

// ── Teste de regra (sem aplicar) ──────────────────────────────────────────────

// O teste devolve os nomes a quem configura: quem não enxerga o projeto ou o
// webhook vê só o nome da ação.
async function canReadActionTarget(a: Action, viewer: RuleAuthor) {
  if (a.type === 'send_webhook') return can(viewer, 'integrations.manage')
  if (a.type !== 'link_project_task' && a.type !== 'create_project_task') return true
  const projectId = a.type === 'create_project_task'
    ? parseTaskTemplate(a.value)?.projectId
    : (await prisma.task.findUnique({ where: { id: a.value }, select: { project_id: true } }))?.project_id
  return !!projectId && !!(await effectiveProjectRole(projectId, viewer.sub))
}

export async function testRoutingRule(rule: RuleInput, ticketRef: string, viewer?: RuleAuthor) {
  const ref = ticketRef.trim()
  const found = await prisma.ticket.findFirst({
    where: { deleted_at: null, OR: [{ id: ref }, { display_number: ref.toUpperCase() }] },
    select: TICKET_ACCESS_SELECT,
  })
  if (found && viewer) {
    // O resultado traz descrição, e-mail e nomes do chamado: mesma regra de abri-lo.
    const access = await getTicketAccess(found, viewer)
    if (!access.allowed) throw forbidden(access.code, access.message)
  }
  const t = found && await loadTicket(found.id)
  if (!t) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')

  const ctx = await buildCtx()
  const conditions = await Promise.all(rule.conditions.map(async c => {
    const field = FIELD_BY_ID[c.field]
    const op = OPERATOR_BY_ID[c.operator]
    const actual = field.get(t, ctx)
    return {
      field: field.label,
      operator: op.label,
      expected: op.noValue ? '' : await listLabel(field.kind, c.value, field.options),
      actual: field.kind === 'text' ? String(actual ?? '—') : await valueLabel(field.kind, actual as string, field.options),
      result: testCondition(c, t, ctx),
    }
  }))
  const matched = matches(rule, t, ctx)
  const branchActions = matched ? rule.actions : (rule.elseActions ?? [])
  const targetQueue = branchActions.find(a => a.type === 'set_queue')?.value ?? t.queue

  const actions = await Promise.all(branchActions.map(async a => ({
    description: viewer && !(await canReadActionTarget(a, viewer)) ? ACTION_BY_ID[a.type].label : await describeAction(a),
    warning: a.type === 'assign_agent' ? await assignProblem(a.value, t, targetQueue)
      : a.type === 'add_participant' ? await agentProblem(a.value, null)
      : null,
  })))

  return {
    ticket: { id: t.id, displayNumber: t.display_number, title: t.title },
    matched,
    branch: matched ? 'then' : branchActions.length ? 'else' : null,
    conditions,
    actions,
  }
}
