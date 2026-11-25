import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { EscalationService } from './escalation'
import { TicketService } from './tickets'
import { getTicketAccess } from './ticketAccess'

// Testes de integração para o fluxo de "atuação unificada" (same_ticket):
// ambos os agentes atuam no MESMO chamado, sem gerar chamado filho.
// Rodam contra o banco local (DATABASE_URL do backend/.env).

const SUFFIX = `esc-${Date.now()}`
const Q_GERAL = `geral-${SUFFIX}`
const Q_N2 = `n2-${SUFFIX}`
let orgId: string
let requesterId: string
let agentAId: string // responsável principal (owner)
let agentBId: string // agente escalonado (colaborador)
let ruleAgentId: string // regra same_ticket sem fila (escolhe agente)
let ruleQueueId: string // regra same_ticket com fila
let ticketId: string

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `Org ${SUFFIX}` },
  })
  orgId = org.id
  await prisma.queue.createMany({
    data: [
      { id: Q_GERAL, name: `Geral ${SUFFIX}`, color: '#000000' },
      { id: Q_N2, name: `N2 ${SUFFIX}`, color: '#000000' },
    ],
  })

  const [requester, agentA, agentB] = await Promise.all([
    prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } }),
    prisma.user.create({ data: { name: `AgentA ${SUFFIX}`, email: `a-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [Q_GERAL] } }),
    prisma.user.create({ data: { name: `AgentB ${SUFFIX}`, email: `b-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [Q_N2] } }),
  ])
  requesterId = requester.id
  agentAId = agentA.id
  agentBId = agentB.id

  const [r1, r2] = await Promise.all([
    EscalationService.createRule({ name: `Unificada agente ${SUFFIX}`, type: 'same_ticket', target_mode: 'agent_pick', target_queue_id: Q_N2 }),
    EscalationService.createRule({ name: `Unificada fila ${SUFFIX}`, type: 'same_ticket', target_queue_id: Q_N2 }),
  ])
  ruleAgentId = r1.id
  ruleQueueId = r2.id

  const ticket = await prisma.ticket.create({
    data: {
      id: `TST-${SUFFIX}`,
      display_number: `INC-TST-${SUFFIX}`,
      title: 'Chamado de teste',
      description: 'desc',
      user_id: requesterId,
      org_id: orgId,
      assigned_to_id: agentAId,
      queue: Q_GERAL,
      status: 'in_progress',
      sla_deadline: new Date(Date.now() + 86400000),
    },
  })
  ticketId = ticket.id
})

afterAll(async () => {
  // Limpeza respeitando FKs (cascata cuida de participantes/eventos/mensagens do ticket).
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [agentAId, agentBId, requesterId] } } }).catch(() => {})
  await prisma.notification.deleteMany({ where: { ticket_id: ticketId } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {})
  await prisma.escalationRule.deleteMany({ where: { id: { in: [ruleAgentId, ruleQueueId] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [agentAId, agentBId, requesterId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.queue.deleteMany({ where: { id: { in: [Q_GERAL, Q_N2] } } }).catch(() => {})
  await prisma.$disconnect()
})

describe.sequential('EscalationService - atuação unificada (same_ticket)', () => {
  it('não cria chamado filho e adiciona o agente escalonado como colaborador', async () => {
    const before = await prisma.ticket.count({ where: { id: { contains: SUFFIX } } })

    const result = await EscalationService.executeEscalation(ticketId, ruleAgentId, agentAId, agentBId)

    const after = await prisma.ticket.count({ where: { id: { contains: SUFFIX } } })
    expect(after).toBe(before) // nenhum ticket novo

    expect(result.type).toBe('same_ticket')

    // O chamado vai para a fila da regra e o responsável principal continua o agente A
    // (mesmo sem ser da fila nova).
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(ticket?.queue).toBe(Q_N2)
    expect(ticket?.assigned_to_id).toBe(agentAId)
    expect(ticket?.escalated).toBe(true)

    // Participantes: A como owner, B como collaborator
    const participants = await prisma.ticketParticipant.findMany({ where: { ticket_id: ticketId } })
    const owner = participants.find(p => p.agent_id === agentAId)
    const collab = participants.find(p => p.agent_id === agentBId)
    expect(owner?.role).toBe('owner')
    expect(collab?.role).toBe('collaborator')
    expect(collab?.active).toBe(true)

    // Evento de log com origem → destino
    const events = await prisma.ticketEvent.findMany({ where: { ticket_id: ticketId } })
    const escEvent = events.find(e => (e.note || '').toLowerCase().includes('atuação conjunta'))
    expect(escEvent).toBeTruthy()
  })

  it('colaborador é co-responsável: altera o chamado, mas não troca o responsável principal', async () => {
    const updated = await TicketService.updateTicket(ticketId, agentBId, 'agent', { priority: 'high' })
    expect(updated.priority).toBe('high')

    await expect(
      TicketService.updateTicket(ticketId, agentBId, 'agent', { assigned_to_id: agentBId })
    ).rejects.toMatchObject({ code: 'COLLABORATOR_CANNOT_REASSIGN' })

    // e segue registrando interação (mensagem)
    const msg = await TicketService.addMessage(ticketId, agentBId, 'Mensagem do colaborador', 'agent')
    expect(msg.id).toBeTruthy()
  })

  it('permite ao responsável principal alterar o status normalmente', async () => {
    // Exige tipo de pendência + justificativa + evidência ao entrar em pending
    const updated = await TicketService.updateTicket(ticketId, agentAId, 'agent', {
      status: 'pending',
      note: 'ok',
      pending_reason: 'pending_user',
      pending_evidence_url: 'data:image/png;base64,AA==',
    })
    expect(updated.status).toBe('pending')
  })

  it('colaborador não reverte o escalonamento — só o responsável ou gestor', async () => {
    await expect(
      EscalationService.revertUnifiedEscalation(ticketId, { agentId: agentBId }, agentBId, 'agent')
    ).rejects.toMatchObject({ code: 'REVERT_NOT_ALLOWED' })
  })

  it('reverte a atuação unificada removendo o colaborador e limpando a flag', async () => {
    const res = await EscalationService.revertUnifiedEscalation(ticketId, { agentId: agentBId }, agentAId, 'agent')
    expect(res.removedName).toContain('AgentB')

    const collab = await prisma.ticketParticipant.findFirst({ where: { ticket_id: ticketId, agent_id: agentBId } })
    expect(collab?.active).toBe(false)

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(ticket?.escalated).toBe(false) // sem colaboradores ativos nem fila
  })

  it('escalonamento via fila grava collab_queue sem criar chamado filho', async () => {
    const before = await prisma.ticket.count({ where: { id: { contains: SUFFIX } } })
    const result = await EscalationService.executeEscalation(ticketId, ruleQueueId, agentAId)
    const after = await prisma.ticket.count({ where: { id: { contains: SUFFIX } } })

    expect(after).toBe(before)
    expect(result.type).toBe('same_ticket')

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(ticket?.collab_queue).toBe(Q_N2)
    expect(ticket?.escalated).toBe(true)
  })

  it('agente da fila escalonada acessa sem ter a empresa, assume como colaborador e altera', async () => {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(await getTicketAccess(ticket!, { sub: agentBId, role: 'agent' })).toEqual({ allowed: true, via: 'collab_queue' })

    await expect(
      TicketService.updateTicket(ticketId, agentBId, 'agent', { priority: 'low' })
    ).rejects.toMatchObject({ code: 'NOT_TICKET_OWNER' })

    await EscalationService.joinAsCollaborator(ticketId, agentBId)
    const updated = await TicketService.updateTicket(ticketId, agentBId, 'agent', { priority: 'low' })
    expect(updated.priority).toBe('low')

    const events = await prisma.ticketEvent.findMany({ where: { ticket_id: ticketId } })
    expect(events.some(e => e.note?.includes('assumiu como colaborador'))).toBe(true)
  })

  it('gerente reverte o escalonamento (antes só o Ticket Manager conseguia)', async () => {
    const res = await EscalationService.revertUnifiedEscalation(ticketId, { agentId: agentBId }, agentAId, 'manager')
    expect(res.removedName).toContain('AgentB')
  })

  it('mensagem em chamado resolvido reabre o MESMO chamado, sem criar novo', async () => {
    // resolve o chamado
    await TicketService.updateTicket(ticketId, agentAId, 'agent', {
      status: 'resolved',
      resolution_details: 'Resolvido para validar a reabertura por mensagem.',
    })

    const before = await prisma.ticket.count({ where: { id: { contains: SUFFIX } } })
    await TicketService.addMessage(ticketId, agentAId, 'Nova interação após a resolução', 'agent')
    const after = await prisma.ticket.count({ where: { id: { contains: SUFFIX } } })
    expect(after).toBe(before) // nenhum chamado novo criado
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    expect(ticket?.status).toBe('in_progress')
    expect(ticket?.is_reopened).toBe(true)
    expect(ticket?.resolved_at).toBeNull()
  })

  it('regra de chamado filho voltou, mas exige a fila onde o filho será aberto', async () => {
    await expect(
      EscalationService.createRule({ name: `filho sem fila ${SUFFIX}`, type: 'child_ticket' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('bloqueia admin de executar escalonamento (somente leitura)', async () => {
    await expect(
      EscalationService.executeEscalation(ticketId, ruleAgentId, agentAId, agentBId, 'admin')
    ).rejects.toThrowError(/somente leitura/i)
  })

  it('bloqueia admin de reverter escalonamento unificado (somente leitura)', async () => {
    await expect(
      EscalationService.revertUnifiedEscalation(ticketId, { agentId: agentBId }, agentAId, 'admin')
    ).rejects.toThrowError(/somente leitura/i)
  })
})
