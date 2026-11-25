import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { EscalationService } from './escalation'

const SUFFIX = `escb-${Date.now()}`
let orgId: string, reqId: string, agentId: string, catOk: string, catBlocked: string, ruleId: string, ticketId: string

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `R ${SUFFIX}`, email: `r-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  agentId = (await prisma.user.create({ data: { name: `A ${SUFFIX}`, email: `a-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })).id
  catOk = (await prisma.category.create({ data: { name: `Ok ${SUFFIX}` } })).id
  catBlocked = (await prisma.category.create({ data: { name: `Bloq ${SUFFIX}` } })).id
  await prisma.orgCategoryBlock.create({ data: { org_id: orgId, category_id: catBlocked } })
  ruleId = (await EscalationService.createRule({ name: `Cat ${SUFFIX}`, type: 'category_change', target_category_id: catBlocked })).id
  ticketId = (await prisma.ticket.create({ data: {
    id: `ESCB-${SUFFIX}`, display_number: `INC-${SUFFIX}`, title: 'T', user_id: reqId, org_id: orgId, assigned_to_id: agentId,
    category_id: catOk, status: 'in_progress', sla_deadline: new Date(Date.now() + 864e5),
  } })).id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: ticketId } })
  await prisma.escalationRule.deleteMany({ where: { id: ruleId } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.category.deleteMany({ where: { id: { in: [catOk, catBlocked] } } })
  await prisma.$disconnect()
})

describe('escalonamento category_change com categoria desligada', () => {
  it('rejeita e não altera o chamado', async () => {
    await expect(EscalationService.executeEscalation(ticketId, ruleId, agentId))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_AVAILABLE' })
    const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { category_id: true } })
    expect(t?.category_id).toBe(catOk)
  })
})
