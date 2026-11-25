import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { runPendingScheduleReopenJob } from './pendingScheduleReopen'

const SUFFIX = `tktpend-${Date.now()}`
let orgId: string, reqId: string, agentId: string, ticketId: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  const agent = await prisma.user.create({ data: { name: `Agent ${SUFFIX}`, email: `agent-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })
  reqId = req.id; agentId = agent.id
  const t = await prisma.ticket.create({ data: { id: `TP-${SUFFIX}`, display_number: SUFFIX, title: 'pend', description: 'd', user_id: reqId, org_id: orgId, assigned_to_id: agentId, queue: 'q1', status: 'open', sla_deadline: new Date(Date.now() + 86400000) } })
  ticketId = t.id
})

afterAll(async () => {
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: ticketId } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe.sequential('ticketPending', () => {

describe.sequential('updateTicket → status pending', () => {
  it('rejeita sem tipo de pendência', async () => {
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', { status: 'pending', note: 'aguardando', pending_evidence_url: 'data:image/png;base64,AA==' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejeita sem justificativa', async () => {
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', { status: 'pending', pending_reason: 'pending_user', pending_evidence_url: 'data:image/png;base64,AA==' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('aceita justificativa curta com evidência e grava no ticket_event', async () => {
    const updated = await TicketService.updateTicket(ticketId, agentId, 'agent', {
      status: 'pending',
      pending_reason: 'pending_vendor',
      note: 'Aguardando retorno da Microsoft',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })
    expect(updated.status).toBe('pending')
    expect(updated.pending_reason).toBe('pending_vendor')

    const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: ticketId, to_status: 'pending' }, orderBy: { created_at: 'desc' } })
    expect(event?.pending_reason).toBe('pending_vendor')
    expect(event?.note).toBe('Aguardando retorno da Microsoft')
    expect(event?.attachment_url).toBeTruthy()
  })

  it('evidência é sempre opcional, mesmo com justificativa curta', async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'open', pending_reason: null } })
    const note = 'aguardando'
    const updated = await TicketService.updateTicket(ticketId, agentId, 'agent', { status: 'pending', pending_reason: 'pending_user', note })
    expect(updated.status).toBe('pending')

    const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: ticketId, to_status: 'pending' }, orderBy: { created_at: 'desc' } })
    expect(event?.note).toBe(note)
    expect(event?.pending_reason).toBe('pending_user')
    expect(event?.attachment_url).toBeNull()
  })

  it('rejeita pending_schedule sem data/hora', async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'open', pending_reason: null } })
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', {
        status: 'pending', pending_reason: 'pending_schedule', note: 'visita técnica', pending_evidence_url: 'data:image/png;base64,AA==',
      })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejeita pending_schedule com data/hora no passado', async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'open', pending_reason: null } })
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', {
        status: 'pending', pending_reason: 'pending_schedule', note: 'visita técnica',
        pending_evidence_url: 'data:image/png;base64,AA==', pending_schedule_at: new Date(Date.now() - 3600000).toISOString(),
      })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('aceita pending_schedule com data futura e grava pending_schedule_at', async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'open', pending_reason: null } })
    const scheduleAt = new Date(Date.now() + 3600000)
    const updated = await TicketService.updateTicket(ticketId, agentId, 'agent', {
      status: 'pending', pending_reason: 'pending_schedule', note: 'visita técnica agendada',
      pending_evidence_url: 'data:image/png;base64,AA==', pending_schedule_at: scheduleAt.toISOString(),
    })
    expect(updated.pendingScheduleAt?.toISOString()).toBe(scheduleAt.toISOString())

    const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: ticketId, to_status: 'pending' }, orderBy: { created_at: 'desc' } })
    expect(event?.pending_schedule_at?.toISOString()).toBe(scheduleAt.toISOString())
  })

  it('troca a subpendência sem sair de pending e mantém o início da pausa', async () => {
    const before = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(before?.status).toBe('pending')
    await TicketService.updateTicket(ticketId, agentId, 'agent', {
      status: 'pending', pending_reason: 'pending_vendor', note: 'Agora aguardando o fornecedor',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })

    const reloaded = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(reloaded?.pending_reason).toBe('pending_vendor')
    expect(reloaded?.pending_schedule_at).toBeNull()
    expect(reloaded?.sla_paused_at?.toISOString()).toBe(before?.sla_paused_at?.toISOString())

    const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: ticketId }, orderBy: { created_at: 'desc' } })
    expect(event).toMatchObject({ from_status: 'pending', to_status: 'pending', pending_reason: 'pending_vendor' })
  })

  it('troca de subpendência exige justificativa', async () => {
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', { status: 'pending', pending_reason: 'pending_user', pending_evidence_url: 'data:image/png;base64,AA==' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe.sequential('runPendingScheduleReopenJob', () => {
  it('reabre para in_progress quando pending_schedule_at já passou e limpa o agendamento', async () => {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'pending', pending_reason: 'pending_schedule', pending_schedule_at: new Date(Date.now() - 60000) },
    })

    const result = await runPendingScheduleReopenJob()
    expect(result.reopened).toBeGreaterThanOrEqual(1)

    const reloaded = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(reloaded?.status).toBe('in_progress')
    expect(reloaded?.pending_reason).toBeNull()
    expect(reloaded?.pending_schedule_at).toBeNull()
  })

  it('não mexe em chamados cujo agendamento ainda não chegou', async () => {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'pending', pending_reason: 'pending_schedule', pending_schedule_at: new Date(Date.now() + 3600000) },
    })

    await runPendingScheduleReopenJob()

    const reloaded = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(reloaded?.status).toBe('pending')
  })
})

})
