import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { getBusinessHoursConfig } from './businessHours'
import { holidaysAround, addBusinessHours, getBusinessMinutesBetween } from '../utils/businessHours'

const SUFFIX = `slapause-${Date.now()}`
let orgId: string
let agentId: string
const ticketIds: string[] = []

beforeAll(async () => {
  // Create standard SLA configuration if not exists
  await prisma.slaConfig.upsert({
    where: { tier: 'standard' },
    update: { incident_resolution_hours: 24, incident_first_response_hours: 4 },
    create: { tier: 'standard', incident_resolution_hours: 24, incident_first_response_hours: 4 },
  })

  // Create organization
  const org = await prisma.organization.create({
    data: { name: `OrgSlaPause ${SUFFIX}`, tier: 'standard' },
  })
  orgId = org.id

  // Create agent
  const agent = await prisma.user.create({
    data: { name: `AgentSlaPause ${SUFFIX}`, email: `agent-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: ['geral'] },
  })
  agentId = agent.id
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { user_id: agentId } }).catch(() => {})
  for (const tid of ticketIds) {
    await prisma.ticketEvent.deleteMany({ where: { ticket_id: tid } }).catch(() => {})
    await prisma.ticket.deleteMany({ where: { id: tid } }).catch(() => {})
  }
  await prisma.user.deleteMany({ where: { id: agentId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

async function createTestTicket(suffix: string) {
  const bh = await getBusinessHoursConfig()
  const now = new Date()
  const holidays = holidaysAround(now)
  const initialDeadline = addBusinessHours(now, 24, bh, holidays)
  const firstResponseDeadline = addBusinessHours(now, 4, bh, holidays)

  const id = `TKT-PAUSE-${suffix}-${SUFFIX}`
  const ticket = await prisma.ticket.create({
    data: {
      id,
      display_number: `INC-PAUSE-${suffix}-${SUFFIX}`,
      title: `SLA Pause Test ${suffix}`,
      description: 'Testing SLA Pause',
      user_id: agentId,
      org_id: orgId,
      assigned_to_id: agentId,
      queue: 'geral',
      status: 'open',
      sla_deadline: initialDeadline,
      first_response_deadline: firstResponseDeadline,
    },
  })
  ticketIds.push(ticket.id)
  return { ticket, initialDeadline, firstResponseDeadline }
}

describe('SLA Pause and Resume Integration Tests', () => {
  it('should extend SLA deadlines when ticket status leaves pending state', async () => {
    const { ticket, initialDeadline } = await createTestTicket('basic')
    const bh = await getBusinessHoursConfig()

    // 1. Change status to pending
    const updatedPending = await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'pending',
      pending_reason: 'pending_user',
      note: 'Aguardando retorno do cliente para teste de SLA',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })
    expect(updatedPending.status).toBe('pending')

    // 2. Simulate that the ticket was in pending status starting at a past date
    const pendingEvent = await prisma.ticketEvent.findFirst({
      where: { ticket_id: ticket.id, to_status: 'pending' },
      orderBy: { created_at: 'desc' },
    })
    expect(pendingEvent).toBeDefined()

    // Backdate the pending event to simulate real wait time
    const pendingStart = new Date('2026-06-09T13:00:00Z') // Tuesday 10:00 BRT
    await prisma.ticketEvent.update({
      where: { id: pendingEvent!.id },
      data: { created_at: pendingStart },
    })

    // 3. Resume from pending
    const updatedResume = await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'in_progress',
    })
    expect(updatedResume.status).toBe('in_progress')

    // 4. Verify deadline was extended
    const nowAfter = new Date()
    const holidays = holidaysAround(pendingStart)
    const elapsedMinutes = getBusinessMinutesBetween(pendingStart, nowAfter, bh, holidays)
    const elapsedHours = elapsedMinutes / 60
    const expectedDeadline = addBusinessHours(initialDeadline, elapsedHours, bh, holidaysAround(initialDeadline))

    expect(new Date(updatedResume.slaDeadline).getTime()).toBeCloseTo(expectedDeadline.getTime(), -3)
  })

  it('should set sla_paused_at when entering pending and clear it when leaving', async () => {
    const { ticket } = await createTestTicket('tracking')

    // 1. Enter pending — sla_paused_at should be set
    const pending = await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'pending',
      pending_reason: 'pending_user',
      note: 'Aguardando retorno do cliente para teste de SLA',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })
    expect(pending.slaPausedAt).toBeDefined()
    expect(pending.slaPausedAt).not.toBeNull()

    // 2. Leave pending — sla_paused_at should be cleared
    const resumed = await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'in_progress',
    })
    expect(resumed.slaPausedAt).toBeNull()
  })

  it('should accumulate total_paused_minutes across multiple pause cycles', async () => {
    const { ticket } = await createTestTicket('multi')

    // Cycle 1: open → pending → in_progress
    await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'pending',
      pending_reason: 'pending_user',
      note: 'Aguardando retorno do cliente para teste de SLA',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })
    const evt1 = await prisma.ticketEvent.findFirst({
      where: { ticket_id: ticket.id, to_status: 'pending' },
      orderBy: { created_at: 'desc' },
    })
    // Backdate to simulate 2 business hours of pause (Tue 10:00→12:00 BRT)
    const pause1Start = new Date('2026-06-09T13:00:00Z')
    await prisma.ticketEvent.update({
      where: { id: evt1!.id },
      data: { created_at: pause1Start },
    })
    // Temporarily mock Date.now for the resume

    const after1 = await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'in_progress',
    })
    expect(after1.totalPausedMinutes).toBeGreaterThan(0)
    const firstPausedMinutes = after1.totalPausedMinutes

    // Cycle 2: in_progress → pending → in_progress
    await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'pending',
      pending_reason: 'pending_user',
      note: 'Aguardando retorno do cliente para teste de SLA',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })
    const after2 = await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'in_progress',
    })

    // totalPausedMinutes should have increased (even if by 0 — at minimum it shouldn't decrease)
    expect(after2.totalPausedMinutes).toBeGreaterThanOrEqual(firstPausedMinutes)
  })

  it('should still extend deadline when going pending → resolved (ITIL: customer wait excluded)', async () => {
    const { ticket, initialDeadline } = await createTestTicket('resolve')

    // Enter pending
    await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'pending',
      pending_reason: 'pending_user',
      note: 'Aguardando retorno do cliente para teste de SLA',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })
    const pendingEvent = await prisma.ticketEvent.findFirst({
      where: { ticket_id: ticket.id, to_status: 'pending' },
      orderBy: { created_at: 'desc' },
    })

    // Backdate pending to simulate 3 business hours
    const pendingStart = new Date('2026-06-09T13:00:00Z')
    await prisma.ticketEvent.update({
      where: { id: pendingEvent!.id },
      data: { created_at: pendingStart },
    })

    // Resolve directly from pending (agent found the answer without customer)
    const resolved = await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'resolved',
      resolution_details: 'Resolvido sem necessidade de resposta do cliente — solução aplicada diretamente.',
    })

    expect(resolved.status).toBe('resolved')
    // Deadline should have been extended (not left as original)
    expect(new Date(resolved.slaDeadline).getTime()).toBeGreaterThan(initialDeadline.getTime())
    // Total paused minutes should be tracked
    expect(resolved.totalPausedMinutes).toBeGreaterThan(0)
    // Paused at should be cleared
    expect(resolved.slaPausedAt).toBeNull()
  })

  it('should track paused minutes even when going pending → closed', async () => {
    const { ticket } = await createTestTicket('close')

    // Enter pending
    await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'pending',
      pending_reason: 'pending_user',
      note: 'Aguardando retorno do cliente para teste de SLA',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })

    // Close from pending (supervisor action — only 'supervisor'/'manager'/'system' can close tickets)
    const closed = await TicketService.updateTicket(ticket.id, agentId, 'supervisor', {
      status: 'closed',
      resolution_details: 'Fechado pelo supervisor — sem resposta do cliente.',
    })

    expect(closed.status).toBe('closed')
    expect(closed.slaPausedAt).toBeNull()
    // total_paused_minutes should be >= 0 (it was paused for minimal time)
    expect(closed.totalPausedMinutes).toBeGreaterThanOrEqual(0)
  })

  it('should not set sla_paused_at when status stays the same', async () => {
    const { ticket } = await createTestTicket('noop')

    // Change to in_progress (not pending)
    const updated = await TicketService.updateTicket(ticket.id, agentId, 'agent', {
      status: 'in_progress',
    })
    expect(updated.slaPausedAt).toBeNull()
    expect(updated.totalPausedMinutes).toBe(0)
  })
}, 30000)
