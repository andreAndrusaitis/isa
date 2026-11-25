import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService, redactForRequester } from './tickets'

const SUFFIX = `tkt-${Date.now()}`
let orgId: string
let requesterId: string
let agentAId: string // actor/owner
let agentBId: string // another agent
let ticketId: string

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `Org ${SUFFIX}` },
  })
  orgId = org.id

  const [requester, agentA, agentB] = await Promise.all([
    prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } }),
    prisma.user.create({ data: { name: `AgentA ${SUFFIX}`, email: `a-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: ['geral'], org_scopes: { create: { org_id: orgId } } } }),
    prisma.user.create({ data: { name: `AgentB ${SUFFIX}`, email: `b-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: ['geral'], org_scopes: { create: { org_id: orgId } } } }),
  ])
  requesterId = requester.id
  agentAId = agentA.id
  agentBId = agentB.id

  const ticket = await prisma.ticket.create({
    data: {
      id: `TST-${SUFFIX}`,
      display_number: `INC-${SUFFIX}`,
      title: 'Chamado de teste para notificacao',
      description: 'desc',
      user_id: requesterId,
      org_id: orgId,
      queue: 'geral',
      status: 'open',
      sla_deadline: new Date(Date.now() + 86400000),
    },
  })
  ticketId = ticket.id
})

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { ticket_id: ticketId } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [agentAId, agentBId, requesterId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('TicketService - Auto-atribuição vs Atribuição a Terceiros', () => {
  it('não deve gerar notificação se o próprio agente se auto-atribuir (assumir)', async () => {
    // Limpa notificações existentes para este chamado
    await prisma.notification.deleteMany({ where: { ticket_id: ticketId } })

    // Agente A (actorId = agentAId) atribui o chamado a si mesmo (assigned_to_id = agentAId)
    await TicketService.updateTicket(ticketId, agentAId, 'agent', {
      assigned_to_id: agentAId,
    })

    // Verifica se alguma notificação do tipo 'ticket_assigned' foi gerada para o Agente A
    const notifications = await prisma.notification.findMany({
      where: { ticket_id: ticketId, user_id: agentAId, type: 'ticket_assigned' },
    })
    expect(notifications.length).toBe(0)
  })

  it('deve gerar notificação se um agente atribuir o chamado a outro agente', async () => {
    // Limpa notificações existentes para este chamado
    await prisma.notification.deleteMany({ where: { ticket_id: ticketId } })

    // Agente A (actorId = agentAId) atribui o chamado ao Agente B (assigned_to_id = agentBId)
    await TicketService.updateTicket(ticketId, agentAId, 'agent', {
      assigned_to_id: agentBId,
    })

    // Verifica se a notificação do tipo 'ticket_assigned' foi gerada para o Agente B
    // (NotificationService.create roda sem await no updateTicket: espera o insert)
    const notifications = await vi.waitFor(async () => {
      const found = await prisma.notification.findMany({
        where: { ticket_id: ticketId, user_id: agentBId, type: 'ticket_assigned' },
      })
      expect(found.length).toBe(1)
      return found
    })
    expect(notifications[0].body).toBe('Chamado atribuído a você')
  })

  it('deve habilitar e desabilitar o chat em tempo real', async () => {
    const updated1 = await TicketService.updateTicket(ticketId, agentBId, 'agent', {
      chat_enabled: true,
    })
    expect(updated1.chat_enabled).toBe(true)

    const updated2 = await TicketService.updateTicket(ticketId, agentBId, 'agent', {
      chat_enabled: false,
    })
    expect(updated2.chat_enabled).toBe(false)
  })
})

describe('updateTicket — troca de requisitante', () => {
  const SUFFIX = `requester-swap-${Date.now()}`
  let orgId: string
  let otherOrgId: string
  let oldRequesterId: string
  let newRequesterId: string
  let outOfScopeRequesterId: string
  let agentId: string
  let collaboratorAgentId: string
  let ticketId: string
  const createdTicketIds: string[] = []
  const createdUserIds: string[] = []
  const createdOrgIds: string[] = []

  beforeAll(async () => {
    const [org, otherOrg] = await Promise.all([
      prisma.organization.create({ data: { name: `Org ${SUFFIX}` } }),
      prisma.organization.create({ data: { name: `OtherOrg ${SUFFIX}` } }),
    ])
    orgId = org.id
    otherOrgId = otherOrg.id
    createdOrgIds.push(orgId, otherOrgId)

    const [oldReq, newReq, outOfScopeReq, agent, collaboratorAgent] = await Promise.all([
      prisma.user.create({ data: { name: `Old ${SUFFIX}`, email: `old-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } }),
      prisma.user.create({ data: { name: `New ${SUFFIX}`, email: `new-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } }),
      prisma.user.create({ data: { name: `OOS ${SUFFIX}`, email: `oos-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: otherOrgId } }),
      prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent' } }),
      prisma.user.create({ data: { name: `Collab ${SUFFIX}`, email: `collab-${SUFFIX}@t.com`, password: 'x', role: 'agent' } }),
    ])
    oldRequesterId = oldReq.id
    newRequesterId = newReq.id
    outOfScopeRequesterId = outOfScopeReq.id
    agentId = agent.id
    collaboratorAgentId = collaboratorAgent.id
    createdUserIds.push(oldRequesterId, newRequesterId, outOfScopeRequesterId, agentId, collaboratorAgentId)

    await prisma.userOrgScope.create({ data: { user_id: agentId, org_id: orgId } })
  })

  beforeEach(async () => {
    const ticket = await TicketService.createTicket(
      { title: 'Chamado do requisitante antigo', description: 'desc', user_id: oldRequesterId, org_id: orgId, priority: 'medium' },
      oldRequesterId,
    )
    ticketId = ticket!.id
    createdTicketIds.push(ticketId)
    await prisma.ticket.update({ where: { id: ticketId }, data: { assigned_to_id: agentId } })
  })

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { ticket_id: { in: createdTicketIds } } }).catch(() => {})
    await prisma.ticketParticipant.deleteMany({ where: { ticket_id: { in: createdTicketIds } } }).catch(() => {})
    await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: createdTicketIds } } }).catch(() => {})
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } }).catch(() => {})
    await prisma.userOrgScope.deleteMany({ where: { user_id: agentId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {})
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } }).catch(() => {})
  })

  it('troca user_id e org_id juntos, e registra evento de auditoria', async () => {
    const updated = await TicketService.updateTicket(ticketId, agentId, 'agent', { requesterId: newRequesterId })
    expect(updated!.userId).toBe(newRequesterId)
    expect(updated!.orgId).toBe(orgId)

    const events = await prisma.ticketEvent.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'desc' } })
    expect(events[0].note).toContain('Requisitante alterado')
  })

  it('rejeita troca em chamado fechado', async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'closed' } })
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', { requesterId: newRequesterId })
    ).rejects.toThrow('Chamado fechado não permite troca de requisitante')
  })

  it('rejeita requisitante fora do escopo do ator', async () => {
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', { requesterId: outOfScopeRequesterId })
    ).rejects.toThrow('não está na sua carteira')
  })

  it('rejeita requisitante inexistente ou que não é role user', async () => {
    await expect(
      TicketService.updateTicket(ticketId, agentId, 'agent', { requesterId: agentId })
    ).rejects.toThrow('não encontrado')
  })

  it('colaborador escalonado é co-responsável: altera prioridade sem ter a empresa na carteira', async () => {
    await prisma.ticketParticipant.create({
      data: { ticket_id: ticketId, agent_id: collaboratorAgentId, role: 'collaborator', active: true },
    })
    const updated = await TicketService.updateTicket(ticketId, collaboratorAgentId, 'agent', { priority: 'high' })
    expect(updated!.priority).toBe('high')
  })

  it('colaborador não troca o responsável principal', async () => {
    await prisma.ticketParticipant.create({
      data: { ticket_id: ticketId, agent_id: collaboratorAgentId, role: 'collaborator', active: true },
    })
    await expect(
      TicketService.updateTicket(ticketId, collaboratorAgentId, 'agent', { assigned_to_id: collaboratorAgentId })
    ).rejects.toMatchObject({ code: 'COLLABORATOR_CANNOT_REASSIGN' })
  })

  it('colaborador sem a empresa na carteira não troca o requisitante — e a mensagem explica por quê', async () => {
    await prisma.ticketParticipant.create({
      data: { ticket_id: ticketId, agent_id: collaboratorAgentId, role: 'collaborator', active: true },
    })
    await expect(
      TicketService.updateTicket(ticketId, collaboratorAgentId, 'agent', { requesterId: newRequesterId })
    ).rejects.toMatchObject({ code: 'REQUESTER_OUT_OF_SCOPE' })
  })

  it('agente não envolvido recebe explicação de como assumir', async () => {
    await expect(
      TicketService.updateTicket(ticketId, collaboratorAgentId, 'agent', { priority: 'low' })
    ).rejects.toThrow(/assuma o chamado/)
  })
})

describe('redactForRequester', () => {
  it('remove mensagens internas, eventos e intake_status', () => {
    const out = redactForRequester({ id: 't', intake_status: 'incomplete', events: [{}], messages: [{ type: 'internal' }, { type: 'public' }] })
    expect(out).not.toHaveProperty('intake_status')
    expect(out.events).toEqual([])
    expect(out.messages).toEqual([{ type: 'public' }])
  })
})
