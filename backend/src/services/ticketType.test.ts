import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'

const SUFFIX = `tktype-${Date.now()}`
let orgId: string, reqId: string, agentId: string, collaboratorAgentId: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  const agent = await prisma.user.create({ data: { name: `Agent ${SUFFIX}`, email: `agent-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })
  const collaboratorAgent = await prisma.user.create({ data: { name: `Collab ${SUFFIX}`, email: `collab-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })
  reqId = req.id; agentId = agent.id; collaboratorAgentId = collaboratorAgent.id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { user_id: reqId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId, collaboratorAgentId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('createTicket → classificação de tipo', () => {
  it('todo chamado nasce como incident com display_number prefixado INC-', async () => {
    const ticket = await TicketService.createTicket({
      title: 'Impressora não liga',
      description: 'd',
      user_id: reqId,
      org_id: orgId,
    })
    expect(ticket.type).toBe('incident')
    expect(ticket.displayNumber).toMatch(/^INC-\d+$/)
  })

  it('ignora um type enviado no payload de criação — sempre nasce incident', async () => {
    const ticket = await TicketService.createTicket({
      title: 'Chamado tentando nascer como request',
      description: 'd',
      user_id: reqId,
      org_id: orgId,
      type: 'request',
    } as any)
    expect(ticket.type).toBe('incident')
  })
})

describe.sequential('updateTicket → troca de tipo', () => {
  // assigned_to_id: agentId é necessário porque a regra de
  // colaboração unificada do updateTicket bloqueia qualquer
  // alteração de campo por um agente que não seja o responsável nem
  // colaborador ativo do chamado — mesmo que a alteração seja só o `type`.
  it('troca de incident para request: regrava display_number e recalcula SLA', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId, assigned_to_id: agentId })
    const before = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    const updated = await TicketService.updateTicket(ticket.id, agentId, 'agent', { type: 'request' })

    expect(updated.type).toBe('request')
    expect(updated.display_number).toMatch(/^REQ-\d+$/)
    expect(updated.display_number.replace('REQ-', '')).toBe(before!.display_number.replace('INC-', ''))
    expect(updated.sla_deadline.getTime()).not.toBe(before!.sla_deadline.getTime())
  })

  it('não sobrescreve priority ao trocar tipo', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId, priority: 'low', assigned_to_id: agentId })
    const updated = await TicketService.updateTicket(ticket.id, agentId, 'agent', { type: 'request' })
    expect(updated.priority).toBe('low')
  })

  it('rejeita troca para um tipo desabilitado', async () => {
    await prisma.ticketTypeConfig.update({ where: { type: 'problem' }, data: { enabled: false } })
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId, assigned_to_id: agentId })
    await expect(
      TicketService.updateTicket(ticket.id, agentId, 'agent', { type: 'problem' })
    ).rejects.toMatchObject({ statusCode: 400 })
    await prisma.ticketTypeConfig.update({ where: { type: 'problem' }, data: { enabled: true } })
  })

  it('registra TicketEvent de auditoria na troca de tipo', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId, assigned_to_id: agentId })
    await TicketService.updateTicket(ticket.id, agentId, 'agent', { type: 'change' })
    const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: ticket.id }, orderBy: { created_at: 'desc' } })
    expect(event?.note).toContain('Incidente')
    expect(event?.note).toContain('Mudança')
  })

  it('colaborador ativo é co-responsável e pode trocar o tipo do chamado', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId, assigned_to_id: agentId })
    await prisma.ticketParticipant.create({
      data: { ticket_id: ticket.id, agent_id: collaboratorAgentId, role: 'collaborator', active: true },
    })

    const updated = await TicketService.updateTicket(ticket.id, collaboratorAgentId, 'agent', { type: 'request' })
    expect(updated!.type).toBe('request')
  })

  it('agente não envolvido não troca o tipo — e a mensagem diz como assumir', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId, assigned_to_id: agentId })

    await expect(
      TicketService.updateTicket(ticket.id, collaboratorAgentId, 'agent', { type: 'request' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'NOT_TICKET_OWNER' })
  })
})
