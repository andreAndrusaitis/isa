import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'

const SUFFIX = `routtype-${Date.now()}`
let orgId: string, reqId: string, ruleId: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  reqId = req.id

  const rule = await prisma.routingRule.create({
    data: {
      name: `Regra tipo ${SUFFIX}`,
      priority: 1,
      enabled: true,
      conditions: [{ field: 'subject_contains', operator: 'contains', value: SUFFIX }],
      match_type: 'all',
      actions: [{ type: 'set_type', value: 'request' }],
    },
  })
  ruleId = rule.id
})

afterAll(async () => {
  await prisma.routingRule.deleteMany({ where: { id: ruleId } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { user_id: reqId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: reqId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('Regra de roteamento → múltiplas condições (organização E fila)', () => {
  it('só aplica a ação quando organização E fila batem (matchType all)', async () => {
    const multiRule = await prisma.routingRule.create({
      data: {
        name: `Regra multi-condição ${SUFFIX}`,
        priority: 0,
        enabled: true,
        conditions: [
          { field: 'organization', operator: 'equals', value: orgId },
          { field: 'queue', operator: 'equals', value: 'especializada' },
        ],
        match_type: 'all',
        actions: [{ type: 'set_queue', value: 'vip' }],
      },
    })
    try {
      // Fila diferente da condição — não deve aplicar a ação.
      const t1 = await TicketService.createTicket({
        title: `Fila errada ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId, queue: 'geral',
      })
      expect(t1.queue).toBe('geral')

      // Organização e fila batem — aplica a ação.
      const t2 = await TicketService.createTicket({
        title: `Fila certa ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId, queue: 'especializada',
      })
      expect(t2.queue).toBe('vip')
    } finally {
      await prisma.routingRule.deleteMany({ where: { id: multiRule.id } })
    }
  })
})

describe('Regra de roteamento → ação set_type', () => {
  it('reclassifica o tipo do chamado ao criar, regravando display_number e SLA', async () => {
    const ticket = await TicketService.createTicket({
      title: `Chamado ${SUFFIX}`,
      description: 'd',
      user_id: reqId,
      org_id: orgId,
    })

    const reloaded = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(reloaded?.type).toBe('request')
    expect(reloaded?.display_number).toMatch(/^REQ-\d+$/)
  })

  it('ignora set_type para um tipo desabilitado sem quebrar as demais ações', async () => {
    await prisma.ticketTypeConfig.update({ where: { type: 'request' }, data: { enabled: false } })
    try {
      const ticket = await TicketService.createTicket({
        title: `Chamado ${SUFFIX}`,
        description: 'd',
        user_id: reqId,
        org_id: orgId,
      })
      const reloaded = await prisma.ticket.findUnique({ where: { id: ticket.id } })
      expect(reloaded?.type).toBe('incident')
      expect(reloaded?.display_number).toMatch(/^INC-\d+$/)
    } finally {
      await prisma.ticketTypeConfig.update({ where: { type: 'request' }, data: { enabled: true } })
    }
  })
})
