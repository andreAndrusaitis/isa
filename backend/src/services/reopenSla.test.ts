import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { getReopenSlaConfig, upsertReopenSlaConfig } from './reopenSla'
import { getBusinessHoursConfig } from './businessHours'
import { addBusinessHours, holidaysAround } from '../utils/businessHours'

const SUFFIX = `reopen-${Date.now()}`
let orgId: string
let requesterId: string
let agentId: string
let ticketId: string

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `OrgReopen ${SUFFIX}` },
  })
  orgId = org.id

  const [requester, agent] = await Promise.all([
    prisma.user.create({ data: { name: `ReqReopen ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } }),
    prisma.user.create({ data: { name: `AgentReopen ${SUFFIX}`, email: `agent-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: ['geral'] } }),
  ])
  requesterId = requester.id
  agentId = agent.id
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [requesterId, agentId] } } }).catch(() => {})
  await prisma.notification.deleteMany({ where: { ticket_id: { in: [ticketId, `TKT-OVERRIDE-${SUFFIX}`, `TKT-RULE-${SUFFIX}`] } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: [ticketId, `TKT-OVERRIDE-${SUFFIX}`, `TKT-RULE-${SUFFIX}`] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [requesterId, agentId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.reopenSlaConfig.deleteMany().catch(() => {})
  await prisma.$disconnect()
})

describe('SLA Reopening Rule Integration Tests', () => {
  it('should fetch and update Reopen SLA settings successfully', async () => {
    const config = await getReopenSlaConfig()
    expect(config).toBeDefined()
    expect(config.enabled).toBe(true)
    expect(config.reopen_limit_hours).toBe(24)

    const updated = await upsertReopenSlaConfig({ enabled: true, reopen_limit_hours: 2 })
    expect(updated.reopen_limit_hours).toBe(2)
  }, 30000)

  it('should allow and block reopening depending on elapsed hours', async () => {
    // 1. Create a ticket
    const ticket = await prisma.ticket.create({
      data: {
        id: `TKT-${SUFFIX}`,
        display_number: `INC-TKT-${SUFFIX}`,
        title: 'Ticket for Reopen testing',
        description: 'Testing reopen limit',
        user_id: requesterId,
        org_id: orgId,
        assigned_to_id: agentId,
        queue: 'geral',
        status: 'open',
        sla_deadline: new Date(Date.now() + 86400000),
      },
    })
    ticketId = ticket.id

    // 2. Mark it as resolved
    await TicketService.updateTicket(ticketId, agentId, 'agent', {
      status: 'resolved',
      resolution_details: 'Resolution details here for testing.',
    })

    // Confirm that it resolved at now
    const resolvedTicket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(resolvedTicket?.status).toBe('resolved')
    expect(resolvedTicket?.resolved_at).toBeDefined()

    // 3. Configure the SLA reopening limit to 1 hour
    await upsertReopenSlaConfig({ enabled: true, reopen_limit_hours: 1 })

    // 4. Update the resolved_at to 30 minutes ago (should ALLOW reopen)
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000)
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { resolved_at: thirtyMinsAgo }
    })

    // Check if mapTicket allows reopening
    const ticketData1 = await TicketService.getTicketById(ticketId)
    expect(ticketData1?.canReopen).toBe(true)

    // Reopen via service should succeed
    const reopened1 = await TicketService.reopenTicket(ticketId, requesterId, 'Needs more work')
    expect(reopened1.status).toBe('open')
    expect(reopened1.is_reopened).toBe(true)

    // 5. Mark it resolved again
    await TicketService.updateTicket(ticketId, agentId, 'agent', {
      status: 'resolved',
      resolution_details: 'Resolution details here for testing again.',
    })

    // 6. Update the resolved_at to 2 hours ago (should BLOCK reopen)
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000)
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { resolved_at: twoHoursAgo }
    })

    // Check if mapTicket blocks reopening
    const ticketData2 = await TicketService.getTicketById(ticketId)
    expect(ticketData2?.canReopen).toBe(false)

    // Reopen via service should throw
    await expect(
      TicketService.reopenTicket(ticketId, requesterId, 'Needs more work again')
    ).rejects.toThrowError(/prazo/i)

    // Reopen via message should also throw
    await expect(
      TicketService.addMessage(ticketId, requesterId, 'I want to reopen this ticket', 'user')
    ).rejects.toThrowError(/encerrado/i)

    // Reopen via manual status change should also throw
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', { status: 'in_progress', note: 'trying to change status' })
    ).rejects.toThrowError(/prazo/i)
  }, 30000)

  it('should calculate new deadline using different reopen SLA rules', async () => {
    // Create ticket
    const ticket = await prisma.ticket.create({
      data: {
        id: `TKT-RULE-${SUFFIX}`,
        display_number: `INC-RULE-${SUFFIX}`,
        title: 'Rule testing',
        description: 'Testing reopen rules',
        user_id: requesterId,
        org_id: orgId,
        assigned_to_id: agentId,
        queue: 'geral',
        status: 'open',
        sla_deadline: new Date(Date.now() + 2 * 3600 * 1000), // 2 hours from now
      },
    })
    const tktId = ticket.id

    // Resolve
    await TicketService.updateTicket(tktId, agentId, 'agent', {
      status: 'resolved',
      resolution_details: 'Resolving rule ticket.',
    })

    // Configure rule to fixed_hours (5 hours)
    await upsertReopenSlaConfig({ enabled: true, reopen_deadline_rule: 'fixed_hours', reopen_deadline_hours: 5 })

    // Reopen
    const reopened1 = await TicketService.reopenTicket(tktId, requesterId, 'Reopening rule ticket')
    const bh = await getBusinessHoursConfig()
    const expectedDeadline = addBusinessHours(new Date(), 5, bh, holidaysAround(new Date()))
    expect(new Date(reopened1.sla_deadline).getTime()).toBeCloseTo(expectedDeadline.getTime(), -4)

    // Resolve again
    await TicketService.updateTicket(tktId, agentId, 'agent', {
      status: 'resolved',
      resolution_details: 'Resolving rule ticket again.',
    })

    // Configure rule to keep_original
    await upsertReopenSlaConfig({ enabled: true, reopen_deadline_rule: 'keep_original' })

    // Reopen
    const reopened2 = await TicketService.reopenTicket(tktId, requesterId, 'Reopening keep original')
    expect(new Date(reopened2.sla_deadline).getTime()).toBeCloseTo(new Date(reopened1.sla_deadline).getTime(), -1)

    // Clean up
    await prisma.ticketEvent.deleteMany({ where: { ticket_id: tktId } }).catch(() => {})
    await prisma.ticketMessage.deleteMany({ where: { ticket_id: tktId } }).catch(() => {})
    await prisma.ticket.delete({ where: { id: tktId } }).catch(() => {})
  }, 30000)
})
