// Ponte chamado ↔ task (criar do chamado, lote, previsão,
// previsão vencida, ação de roteamento). Prisma real — banco descartável:
//   DATABASE_URL=postgresql://isa:isa@127.0.0.1:5434/isa DIRECT_URL=$DATABASE_URL npx vitest run --fileParallelism=false --test-timeout=30000 src/services/ticketTaskBridge.test.ts
// Cleanup restrito aos IDs criados aqui.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import prisma from '../config/prisma'
import { SYSTEM_USER_ID } from '../utils/constants'
import { createTaskFromTicket, linkTicketsBulk, alertOverdueForecasts } from './ticketTaskLink'
import { updateTask } from './tasks'
import { TicketService } from './tickets'
import { createRoutingRule, routingRuleSchema, runRoutingRules, updateRoutingRule } from './routing'
import { getSlaExpiring } from './dashboard'
import { summarizeUpdates } from './email/ticketUpdateDigest'
import { buildTicketUpdateTemplate } from './email/templates/ticketUpdate'

const S = `ttb-${Date.now()}`
const ids = { users: [] as string[], tickets: [] as string[], rules: [] as string[], orgId: '', projectId: '', systemCreated: false }
let agent = { sub: '', role: 'agent' }
let outsider = { sub: '', role: 'agent' }
let requesterId = ''
let typeBug = ''
let openStatusId = ''

async function newTicket(status: 'in_progress' | 'resolved' = 'in_progress', title = 'Chamado ponte') {
  const n = ids.tickets.length
  const id = `TKT-${S}-${n}`
  await prisma.ticket.create({
    data: {
      id, display_number: `ISA-${S}-${n}`, title, description: 'Detalhe do cliente', priority: 'high',
      user_id: requesterId, org_id: ids.orgId, assigned_to_id: agent.sub, queue: 'geral', status,
      sla_deadline: new Date(Date.now() + 8 * 3_600_000), first_response_deadline: new Date(Date.now() + 3_600_000),
    },
  })
  ids.tickets.push(id)
  return id
}
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

beforeAll(async () => {
  if (!(await prisma.user.findUnique({ where: { id: SYSTEM_USER_ID } }))) {
    await prisma.user.create({ data: { id: SYSTEM_USER_ID, name: 'Sistema', email: `system-${S}@t.local`, role: 'admin' } })
    ids.systemCreated = true
  }
  const org = await prisma.organization.create({ data: { name: `Org ${S}`, tier: 'bronze' } })
  ids.orgId = org.id
  const a = await prisma.user.create({ data: { name: 'Analista Ponte', email: `a-${S}@t.local`, role: 'agent', org_id: org.id, module_projects: true } })
  const o = await prisma.user.create({ data: { name: 'Fora', email: `o-${S}@t.local`, role: 'agent', module_projects: true } })
  const r = await prisma.user.create({ data: { name: 'Cliente', email: `r-${S}@t.local`, role: 'user', org_id: org.id } })
  ids.users.push(a.id, o.id, r.id)
  agent = { sub: a.id, role: 'agent' }
  outsider = { sub: o.id, role: 'agent' }
  requesterId = r.id
  const project = await prisma.project.create({ data: { name: `Projeto ${S}`, owner_id: a.id, members: { create: { user_id: a.id, role: 'owner' } } } })
  ids.projectId = project.id
  openStatusId = (await prisma.projectStatus.create({ data: { project_id: project.id, name: 'A Fazer', color: '#999', category: 'open', position: 0 } })).id
  await prisma.projectStatus.create({ data: { project_id: project.id, name: 'Concluído', color: '#0a0', category: 'done', position: 1 } })
  typeBug = (await prisma.taskType.create({ data: { project_id: project.id, name: 'Bug', prefix: 'BUG', icon: 'Bug', color: '#f00', position: 0 } })).id
})

afterAll(async () => {
  await prisma.routingRule.deleteMany({ where: { id: { in: ids.rules } } })
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ids.tickets } } })
  await prisma.notification.deleteMany({ where: { OR: [{ ticket_id: { in: ids.tickets } }, { user_id: { in: ids.users } }] } })
  await prisma.ticket.deleteMany({ where: { id: { in: ids.tickets } } })
  await prisma.project.deleteMany({ where: { id: ids.projectId } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids.users } } })
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } })
  await prisma.organization.deleteMany({ where: { id: ids.orgId } })
  if (ids.systemCreated) await prisma.user.deleteMany({ where: { id: SYSTEM_USER_ID } })
})

describe('criar task a partir do chamado (ID 1.1)', () => {
  it('cria a task com ID do tipo, dados do chamado e já vinculada', async () => {
    const ticketId = await newTicket()
    const { task } = await createTaskFromTicket(ids.projectId, agent, { ticket: ticketId, taskTypeId: typeBug, dueDate: inDays(5) })
    expect(task.key).toMatch(/^BUG-\d+$/)
    expect(task.title).toBe('Chamado ponte')
    expect(task.description).toContain(`Origem: chamado ISA-${S}`)
    expect(task.priority).toBe('high')
    expect(task.status_id).toBe(openStatusId)
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })
    expect(t).toMatchObject({ status: 'pending', pending_reason: 'pending_project', project_task_id: task.id })
    const ev = await prisma.ticketEvent.findFirstOrThrow({ where: { ticket_id: ticketId, to_status: 'pending' } })
    expect(ev.note).toContain(task.key!)
    expect(ev.note).toContain('task criada a partir do chamado')
  })

  it('valida antes de criar: chamado resolvido, sem acesso ou admin não geram task', async () => {
    const before = await prisma.task.count({ where: { project_id: ids.projectId } })
    const resolved = await newTicket('resolved')
    await expect(createTaskFromTicket(ids.projectId, agent, { ticket: resolved, taskTypeId: typeBug, dueDate: inDays(5) })).rejects.toMatchObject({ code: 'TICKET_NOT_ACTIVE' })
    const open = await newTicket()
    await expect(createTaskFromTicket(ids.projectId, outsider, { ticket: open, taskTypeId: typeBug, dueDate: inDays(5) })).rejects.toMatchObject({ statusCode: 403 })
    await expect(createTaskFromTicket(ids.projectId, { sub: agent.sub, role: 'admin' }, { ticket: open, taskTypeId: typeBug, dueDate: inDays(5) })).rejects.toMatchObject({ statusCode: 403 })
    await expect(createTaskFromTicket(ids.projectId, agent, { ticket: open, taskTypeId: typeBug, dueDate: inDays(-3) })).rejects.toMatchObject({ code: 'DUE_DATE_IN_PAST' })
    expect(await prisma.task.count({ where: { project_id: ids.projectId } })).toBe(before)
  })
})

describe('vincular vários chamados (ID 1.2)', () => {
  it('vincula os válidos e relata os que falharam, sem desfazer os demais', async () => {
    const { task } = await createTaskFromTicket(ids.projectId, agent, { ticket: await newTicket(), taskTypeId: typeBug, dueDate: inDays(7) })
    const a = await newTicket()
    const b = await newTicket()
    const resolved = await newTicket('resolved')
    const res = await linkTicketsBulk(ids.projectId, task.id, [`ISA-${S}-${ids.tickets.indexOf(a)}`, b, b, resolved, 'ISA-NAO-EXISTE'], agent)
    expect(res.linked).toHaveLength(2)
    expect(res.failed.map((f) => f.ref)).toEqual([resolved, 'ISA-NAO-EXISTE'])
    expect(res.failed[0].error).toMatch(/em andamento/)
    expect(await prisma.ticket.count({ where: { project_task_id: task.id, status: 'pending' } })).toBe(3)
  })
})

describe('previsão comunicada e vigiada (ID 1.3 e 1.4)', () => {
  it('mudar o prazo da task anota no chamado e avisa o cliente com a nova previsão', async () => {
    const ticketId = await newTicket()
    const { task } = await createTaskFromTicket(ids.projectId, agent, { ticket: ticketId, taskTypeId: typeBug, dueDate: inDays(5) })
    await prisma.ticket.update({ where: { id: ticketId }, data: { project_forecast_alerted_at: new Date() } })
    const spy = vi.spyOn(TicketService, 'notifyRequester')
    await updateTask(task.id, agent.sub, { dueDate: inDays(12) })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: ticketId }), agent.sub, expect.objectContaining({ kind: 'forecast' }))
    spy.mockRestore()
    const ev = await prisma.ticketEvent.findFirstOrThrow({ where: { ticket_id: ticketId, note: { startsWith: 'Previsão alterada' } } })
    expect(ev.note).toContain(task.key!)
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).project_forecast_alerted_at).toBeNull()
  })

  it('previsão vencida avisa uma vez (chamado, responsável da task, gestão) e entra no SLA em risco', async () => {
    const ticketId = await newTicket()
    const { task } = await createTaskFromTicket(ids.projectId, agent, { ticket: ticketId, taskTypeId: typeBug, dueDate: inDays(1), assigneeId: agent.sub })
    await prisma.task.update({ where: { id: task.id }, data: { due_date: new Date(Date.now() - 2 * 86_400_000) } })

    const first = await alertOverdueForecasts()
    expect(first.alerted).toBeGreaterThanOrEqual(1)
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })
    expect(t.project_forecast_alerted_at).not.toBeNull()
    expect(await prisma.ticketEvent.count({ where: { ticket_id: ticketId, note: { startsWith: 'Previsão vencida' } } })).toBe(1)
    expect(await prisma.notification.count({ where: { task_id: task.id, user_id: agent.sub, type: 'project_forecast' } })).toBe(1)

    await alertOverdueForecasts()
    expect(await prisma.ticketEvent.count({ where: { ticket_id: ticketId, note: { startsWith: 'Previsão vencida' } } })).toBe(1)

    const risk = await getSlaExpiring('admin', agent.sub, {})
    expect(risk.forecastOverdue.map((r) => r.id)).toContain(ticketId)
    expect(risk.forecastOverdue.find((r) => r.id === ticketId)).toMatchObject({ task: { key: task.key }, overdueDays: 2 })
  })

  it('e-mail ao cliente: a última previsão vence e vira assunto quando é a única novidade', () => {
    const s = summarizeUpdates([{ kind: 'forecast', to: '2026-10-20T15:00:00.000Z' }, { kind: 'forecast', to: '2026-10-25T15:00:00.000Z' }])
    expect(s.forecast).toBe('2026-10-25T15:00:00.000Z')
    const tpl = buildTicketUpdateTemplate({ clientName: 'Ana', ticketNumber: 'ISA-1', ticketTitle: 'x', status: null, replies: [], forecast: s.forecast, ticketUrl: 'https://x' })
    expect(tpl.subject).toBe('Chamado [ISA-1]: nova previsão 25/10/2026')
    expect(tpl.html).toContain('Previsão de conclusão')
  })
})

describe('ação de roteamento cria e vincula a task (ID 1.5)', () => {
  const tpl = () => JSON.stringify({ projectId: ids.projectId, taskTypeId: typeBug, dueInDays: 3 })
  const ruleInput = (actions: Array<{ type: string; value: string }>) => routingRuleSchema.parse({
    name: `R ${S}`, priority: -100, conditions: [{ field: 'subject_contains', operator: 'contains', value: S }], actions,
  })

  it('rejeita configuração inválida e quem não é membro do projeto', async () => {
    expect(routingRuleSchema.safeParse({ name: 'x', priority: 1, conditions: [{ field: 'priority', operator: 'equals', value: 'high' }], actions: [{ type: 'create_project_task', value: '{"projectId":"x"}' }] }).success).toBe(false)
    await expect(createRoutingRule(ruleInput([{ type: 'create_project_task', value: tpl() }]), outsider.sub)).rejects.toMatchObject({ statusCode: 400 })
    const noDue = await prisma.task.create({ data: { project_id: ids.projectId, status_id: openStatusId, seq: 9999, title: 'sem prazo', creator_id: agent.sub } })
    await expect(createRoutingRule(ruleInput([{ type: 'link_project_task', value: noDue.id }]), agent.sub)).rejects.toThrow(/prazo/)
  })

  it('regra salva por membro: outro gestor edita o resto sem perder a ação', async () => {
    const rule = await createRoutingRule({ ...ruleInput([{ type: 'create_project_task', value: tpl() }]), enabled: false }, agent.sub)
    ids.rules.push(rule.id)
    await expect(updateRoutingRule(rule.id, { name: 'Renomeada', actions: rule.actions as any }, outsider.sub)).resolves.toMatchObject({ name: 'Renomeada' })
  })

  it('chamado criado que casa a regra ganha task nova vinculada, criada pelo sistema', async () => {
    const rule = await createRoutingRule(ruleInput([{ type: 'create_project_task', value: tpl() }]), agent.sub)
    ids.rules.push(rule.id)
    const ticketId = await newTicket('in_progress', `Pedido de melhoria ${S}`)
    await runRoutingRules(ticketId, 'ticket_created')
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { project_task: true } })
    expect(t).toMatchObject({ status: 'pending', pending_reason: 'pending_project' })
    expect(t.project_task).toMatchObject({ project_id: ids.projectId, creator_id: SYSTEM_USER_ID, title: `Pedido de melhoria ${S}` })
    expect(t.project_task!.key).toMatch(/^BUG-/)
    const ev = await prisma.ticketEvent.findFirstOrThrow({ where: { ticket_id: ticketId, routing_rule_id: rule.id } })
    expect(ev.note).toContain('Criar task no projeto e vincular')
    expect(ev.note).not.toContain('ignorada')
    await prisma.routingRule.update({ where: { id: rule.id }, data: { enabled: false } })
  })

  it('vincular a task existente; chamado já vinculado fica registrado como ignorado', async () => {
    const { task } = await createTaskFromTicket(ids.projectId, agent, { ticket: await newTicket(), taskTypeId: typeBug, dueDate: inDays(9) })
    const rule = await createRoutingRule(ruleInput([{ type: 'link_project_task', value: task.id }]), agent.sub)
    ids.rules.push(rule.id)
    const ticketId = await newTicket('in_progress', `Mesmo problema ${S}`)
    await runRoutingRules(ticketId, 'ticket_created')
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).project_task_id).toBe(task.id)

    const other = await createTaskFromTicket(ids.projectId, agent, { ticket: await newTicket('in_progress', `Outro ${S}`), taskTypeId: typeBug, dueDate: inDays(9) })
    const linkedElsewhere = ids.tickets[ids.tickets.length - 1]
    await runRoutingRules(linkedElsewhere, 'ticket_created')
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: linkedElsewhere } })).project_task_id).toBe(other.task.id)
    const ev = await prisma.ticketEvent.findFirstOrThrow({ where: { ticket_id: linkedElsewhere, routing_rule_id: rule.id } })
    expect(ev.note).toMatch(/ignorada: .*outra task/)
    await prisma.routingRule.update({ where: { id: rule.id }, data: { enabled: false } })
  })
})
