import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { rerouteQueueAfterReclassification } from './routing'

const SUFFIX = `reroute-${Date.now()}`
let orgId: string, reqId: string, watcherId: string, q1: string, q2: string, catA: string, catB: string, catNone: string, ruleId: string

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  watcherId = (await prisma.user.create({ data: { name: `Sup ${SUFFIX}`, email: `sup-${SUFFIX}@t.com`, password: 'x', role: 'supervisor' } })).id
  q1 = (await prisma.queue.create({ data: { name: `Q1 ${SUFFIX}` } })).id
  q2 = (await prisma.queue.create({ data: { name: `Q2 ${SUFFIX}` } })).id
  catA = (await prisma.category.create({ data: { name: `CatA ${SUFFIX}` } })).id
  catB = (await prisma.category.create({ data: { name: `CatB ${SUFFIX}` } })).id
  catNone = (await prisma.category.create({ data: { name: `CatNone ${SUFFIX}` } })).id
  ruleId = (await prisma.routingRule.create({
    data: {
      name: `Rota B ${SUFFIX}`, priority: -1000, enabled: true, match_type: 'all', trigger: 'ticket_created',
      conditions: [{ field: 'category', operator: 'equals', value: catB }],
      actions: [{ type: 'set_queue', value: q2 }, { type: 'notify_user', value: watcherId }, { type: 'set_priority', value: 'high' }],
    },
  })).id
})

afterAll(async () => {
  await prisma.routingRule.deleteMany({ where: { id: ruleId } })
  await prisma.ticket.deleteMany({ where: { user_id: reqId } })
  await prisma.category.deleteMany({ where: { id: { in: [catA, catB, catNone] } } })
  await prisma.queue.deleteMany({ where: { id: { in: [q1, q2] } } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, watcherId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

const newTicket = () => TicketService.createTicket({
  title: `Chamado ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId, queue: q1, category_id: catA, priority: 'low',
} as any)

describe('rerouteQueueAfterReclassification', () => {
  it('aplica só a set_queue da regra que passou a valer; demais ações não rodam', async () => {
    const t = await newTicket()
    expect(t.queue).toBe(q1)
    await prisma.ticket.update({ where: { id: t.id }, data: { category_id: catB } })

    expect(await rerouteQueueAfterReclassification(t.id)).toEqual({ from: q1, to: q2 })

    const after = await prisma.ticket.findUnique({ where: { id: t.id } })
    expect(after?.queue).toBe(q2)
    expect(after?.priority).toBe('low')
    expect(await prisma.notification.count({ where: { ticket_id: t.id } })).toBe(0)
    const ev = await prisma.ticketEvent.findFirst({ where: { ticket_id: t.id, note: { startsWith: 'Triagem IA' } } })
    expect(ev?.note).toBe(`Triagem IA reclassificou o chamado: fila Q1 ${SUFFIX} → Q2 ${SUFFIX} (regra "Rota B ${SUFFIX}")`)
    expect(ev?.from_status).toBe(after?.status)
    expect(ev?.to_status).toBe(after?.status)

    // Já está na fila certa: nada muda.
    expect(await rerouteQueueAfterReclassification(t.id)).toBeNull()
  })

  it('sem regra aplicável devolve null e não mexe na fila', async () => {
    const t = await newTicket()
    await prisma.ticket.update({ where: { id: t.id }, data: { category_id: catNone } })
    expect(await rerouteQueueAfterReclassification(t.id)).toBeNull()
    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))?.queue).toBe(q1)
  })

  it('fila posta por regra que deixou de valer volta à fila padrão da empresa', async () => {
    // Abre já em CatB: a regra de abertura encaminha para Q2 (e registra o evento).
    const t = await TicketService.createTicket({
      title: `Chamado ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId, category_id: catB, priority: 'low',
    } as any)
    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))?.queue).toBe(q2)
    await prisma.ticket.update({ where: { id: t.id }, data: { category_id: catNone } })

    // Volta para a fila padrão do plano da empresa (ou sem fila, se o plano não tiver).
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { sla_config: { select: { default_queue: true } } } })
    const fallback = org?.sla_config?.default_queue ?? null
    expect(await rerouteQueueAfterReclassification(t.id)).toEqual({ from: q2, to: fallback })
    const ev = await prisma.ticketEvent.findFirst({ where: { ticket_id: t.id, note: { startsWith: 'Triagem IA' } } })
    expect(ev?.note).toMatch(new RegExp(`^Triagem IA reclassificou o chamado: fila Q2 ${SUFFIX} → .+ \\(fila padrão da empresa\\)$`))
  })
})
