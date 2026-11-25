import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { routingRuleSchema, runIdleRoutingRules, runRoutingRules, testRoutingRule, createRoutingRule } from './routing'

const SUFFIX = `auto-${Date.now()}`
const QUEUE = `q-${SUFFIX}`
let orgId: string, reqId: string, agentInId: string, agentOutId: string
const ruleIds: string[] = []

async function rule(data: Record<string, unknown>) {
  const r = await prisma.routingRule.create({
    data: { name: `R ${SUFFIX}`, priority: -100, enabled: true, match_type: 'all', ...data } as any,
  })
  ruleIds.push(r.id)
  return r
}
const newTicket = (title: string) =>
  TicketService.createTicket({ title: `${title} ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId })
const ruleEvents = (ticketId: string, ruleId: string) =>
  prisma.ticketEvent.count({ where: { ticket_id: ticketId, routing_rule_id: ruleId } })

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  agentInId = (await prisma.user.create({ data: { name: `In ${SUFFIX}`, email: `in-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [QUEUE] } })).id
  agentOutId = (await prisma.user.create({ data: { name: `Out ${SUFFIX}`, email: `out-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [] } })).id
})

afterAll(async () => {
  await prisma.routingRule.deleteMany({ where: { id: { in: ruleIds } } })
  await prisma.ticket.deleteMany({ where: { user_id: reqId } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentInId, agentOutId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('validação contra o catálogo', () => {
  const base = { name: 'x', priority: 1, conditions: [{ field: 'priority', operator: 'equals', value: 'high' }], actions: [{ type: 'set_priority', value: 'low' }] }

  it('aceita regra válida e assume gatilho "chamado criado"', () => {
    const r = routingRuleSchema.parse(base)
    expect(r.trigger).toBe('ticket_created')
    expect(r.stopProcessing).toBe(true)
  })

  it('rejeita campo, operador, ação e valor de enum inválidos', () => {
    expect(routingRuleSchema.safeParse({ ...base, conditions: [{ field: 'nope', operator: 'equals', value: 'x' }] }).success).toBe(false)
    expect(routingRuleSchema.safeParse({ ...base, conditions: [{ field: 'priority', operator: 'regex', value: 'x' }] }).success).toBe(false)
    expect(routingRuleSchema.safeParse({ ...base, conditions: [{ field: 'priority', operator: 'contains', value: 'h' }] }).success).toBe(false)
    expect(routingRuleSchema.safeParse({ ...base, conditions: [{ field: 'priority', operator: 'equals', value: 'urgent' }] }).success).toBe(false)
    expect(routingRuleSchema.safeParse({ ...base, actions: [{ type: 'explode', value: '' }] }).success).toBe(false)
    expect(routingRuleSchema.safeParse({ ...base, trigger: 'ticket_idle' }).success).toBe(false)
  })

  it('rejeita analista fora da fila definida pela própria regra', async () => {
    const data = routingRuleSchema.parse({ ...base, actions: [{ type: 'set_queue', value: QUEUE }, { type: 'assign_agent', value: agentOutId }] })
    await expect(createRoutingRule(data)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('gatilhos', () => {
  it('chamado atualizado: aplica uma vez, sem loop, e registra TicketEvent', async () => {
    const r = await rule({
      trigger: 'ticket_updated',
      conditions: [{ field: 'subject_contains', operator: 'contains', value: `upd ${SUFFIX}` }],
      actions: [{ type: 'set_status', value: 'in_progress' }, { type: 'set_priority', value: 'low' }],
    })
    const t = await newTicket('upd')
    await TicketService.updateTicket(t.id, 'system', 'system', { priority: 'medium' })

    const after = await prisma.ticket.findUnique({ where: { id: t.id } })
    expect(after?.status).toBe('in_progress')
    expect(after?.priority).toBe('low')
    expect(await ruleEvents(t.id, r.id)).toBe(1)
  })

  it('nova mensagem do cliente dispara; mensagem do analista não', async () => {
    const r = await rule({
      trigger: 'client_message',
      conditions: [{ field: 'subject_contains', operator: 'contains', value: `msg ${SUFFIX}` }],
      actions: [{ type: 'set_priority', value: 'low' }],
    })
    const t = await newTicket('msg')
    await TicketService.addMessage(t.id, 'system', 'resposta automática', 'agent')
    expect(await ruleEvents(t.id, r.id)).toBe(0)
    await TicketService.addMessage(t.id, reqId, 'oi', 'user')
    expect(await ruleEvents(t.id, r.id)).toBe(1)
  })

  it('chamado reaberto dispara e a regra enxerga is_reopened', async () => {
    const r = await rule({
      trigger: 'ticket_reopened',
      conditions: [{ field: 'is_reopened', operator: 'equals', value: 'yes' }, { field: 'subject_contains', operator: 'contains', value: `reo ${SUFFIX}` }],
      actions: [{ type: 'set_priority', value: 'high' }],
    })
    const t = await newTicket('reo')
    await prisma.ticket.update({ where: { id: t.id }, data: { status: 'resolved', resolved_at: new Date(), priority: 'low' } })
    await TicketService.reopenTicket(t.id, reqId, 'não resolveu')
    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))?.priority).toBe('high')
    expect(await ruleEvents(t.id, r.id)).toBe(1)
  })

  it('chamado parado há X horas dispara uma vez por período parado', async () => {
    const r = await rule({
      trigger: 'ticket_idle', trigger_hours: 2,
      conditions: [{ field: 'subject_contains', operator: 'contains', value: `idle ${SUFFIX}` }],
      actions: [{ type: 'notify_user', value: agentInId }],
    })
    const t = await newTicket('idle')
    const old = new Date(Date.now() - 5 * 3600_000)
    await prisma.ticketMessage.deleteMany({ where: { ticket_id: t.id } })
    await prisma.$executeRaw`UPDATE tickets SET updated_at = ${old} WHERE id = ${t.id}`

    await runIdleRoutingRules()
    await runIdleRoutingRules()
    expect(await ruleEvents(t.id, r.id)).toBe(1)
  })
})

describe('ações', () => {
  it('ordem: "continua avaliando" deixa a próxima regra rodar; "para aqui" não', async () => {
    const tag = `ord ${SUFFIX}`
    const cond = [{ field: 'subject_contains', operator: 'contains', value: tag }]
    await rule({ priority: -300, stop_processing: false, conditions: cond, actions: [{ type: 'set_priority', value: 'low' }] })
    await rule({ priority: -299, stop_processing: true, conditions: cond, actions: [{ type: 'set_queue', value: QUEUE }] })
    await rule({ priority: -298, conditions: cond, actions: [{ type: 'set_type', value: 'request' }] })
    const t = await newTicket('ord')
    const after = await prisma.ticket.findUnique({ where: { id: t.id } })
    expect(after?.priority).toBe('low')
    expect(after?.queue).toBe(QUEUE)
    expect(after?.type).toBe('incident')
  })

  it('assign_agent ignora analista fora da fila e aceita o da fila', async () => {
    const tag = `asg ${SUFFIX}`
    const r = await rule({
      priority: -400,
      conditions: [{ field: 'subject_contains', operator: 'contains', value: tag }],
      actions: [{ type: 'set_queue', value: QUEUE }, { type: 'assign_agent', value: agentOutId }],
    })
    const t = await newTicket('asg')
    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))?.assigned_to_id).toBeNull()
    const ev = await prisma.ticketEvent.findFirst({ where: { ticket_id: t.id, routing_rule_id: r.id } })
    expect(ev?.note).toContain('ignorada')
  })

  it('excluir chamado envia à Lixeira', async () => {
    await rule({ priority: -500, conditions: [{ field: 'subject_contains', operator: 'contains', value: `del ${SUFFIX}` }], actions: [{ type: 'delete_ticket', value: '' }] })
    const t = await newTicket('del')
    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))?.deleted_at).not.toBeNull()
  })
})

describe('atribuir pela regra respeita a carteira do analista', () => {
  let otherOrgId: string, agentOtherOrgId: string

  beforeAll(async () => {
    otherOrgId = (await prisma.organization.create({ data: { name: `Outra ${SUFFIX}` } })).id
    agentOtherOrgId = (await prisma.user.create({
      data: { name: `Fora ${SUFFIX}`, email: `fora-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [QUEUE], org_scopes: { create: { org_id: otherOrgId } } },
    })).id
  })

  afterAll(async () => {
    await prisma.ticket.updateMany({ where: { assigned_to_id: agentOtherOrgId }, data: { assigned_to_id: null } })
    await prisma.user.deleteMany({ where: { id: agentOtherOrgId } })
    await prisma.organization.deleteMany({ where: { id: otherOrgId } })
  })

  const assignRule = (agentId: string) => rule({
    trigger: 'ticket_reopened',
    conditions: [{ field: 'subject_contains', operator: 'contains', value: SUFFIX }],
    actions: [{ type: 'set_queue', value: QUEUE }, { type: 'assign_agent', value: agentId }],
  })

  it('analista da fila que não atende a empresa fica de fora, com o motivo no histórico', async () => {
    const r = await assignRule(agentOtherOrgId)
    const t = await newTicket('carteira')
    await runRoutingRules(t.id, 'ticket_reopened')

    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))?.assigned_to_id).toBeNull()
    const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: t.id, routing_rule_id: r.id } })
    expect(event?.note).toContain('ignorada')
    await prisma.routingRule.update({ where: { id: r.id }, data: { enabled: false } })
  })

  it('analista da fila com a empresa na carteira recebe', async () => {
    await prisma.userOrgScope.create({ data: { user_id: agentOtherOrgId, org_id: orgId } })
    const r = await assignRule(agentOtherOrgId)
    const t = await newTicket('na carteira')
    await runRoutingRules(t.id, 'ticket_reopened')
    await prisma.routingRule.update({ where: { id: r.id }, data: { enabled: false } })
    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))?.assigned_to_id).toBe(agentOtherOrgId)
  })
})

describe('testar regra', () => {
  it('mostra o resultado sem alterar o chamado', async () => {
    const t = await newTicket('dry')
    const before = await prisma.ticket.findUnique({ where: { id: t.id } })
    const res = await testRoutingRule(routingRuleSchema.parse({
      name: 'dry', priority: 1,
      conditions: [{ field: 'subject_contains', operator: 'starts_with', value: 'dry' }],
      actions: [{ type: 'set_priority', value: 'low' }, { type: 'assign_agent', value: agentOutId }],
    }), before!.display_number)

    expect(res.matched).toBe(true)
    expect(res.branch).toBe('then')
    expect(res.actions[1].warning).toBeTruthy()
    const after = await prisma.ticket.findUnique({ where: { id: t.id } })
    expect(after?.priority).toBe(before?.priority)
    expect(after?.updated_at.getTime()).toBe(before?.updated_at.getTime())
  })

  it('não mostra nome de projeto a quem não é do projeto', async () => {
    const t = await newTicket('dry-projeto')
    const owner = await prisma.user.create({ data: { name: `Dono ${SUFFIX}`, email: `dono-${SUFFIX}@t.com`, password: 'x', role: 'manager', manager_global: true } })
    const outsider = await prisma.user.create({ data: { name: `Fora2 ${SUFFIX}`, email: `fora2-${SUFFIX}@t.com`, password: 'x', role: 'supervisor', manager_global: true } })
    let projectId: string | undefined
    try {
      const project = await prisma.project.create({ data: { name: `Privado ${SUFFIX}`, owner_id: owner.id, members: { create: { user_id: owner.id, role: 'owner' } } } })
      projectId = project.id
      const type = await prisma.taskType.create({ data: { project_id: project.id, name: 'Tipo', icon: 'x', color: '#000000', prefix: 'T' } })
      const data = routingRuleSchema.parse({
        name: 'dry', priority: 1,
        conditions: [{ field: 'subject_contains', operator: 'is_not_empty', value: '' }],
        actions: [{ type: 'create_project_task', value: JSON.stringify({ projectId: project.id, taskTypeId: type.id, dueInDays: 5 }) }],
      })
      expect((await testRoutingRule(data, t.id, { sub: outsider.id, role: 'supervisor' })).actions[0].description).not.toContain('Privado')
      expect((await testRoutingRule(data, t.id, { sub: owner.id, role: 'manager' })).actions[0].description).toContain('Privado')
    } finally {
      if (projectId) await prisma.project.delete({ where: { id: projectId } })
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, outsider.id] } } })
    }
  })
})
