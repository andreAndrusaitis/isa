import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'

const SUFFIX = `onbehalf-${Date.now()}`
let orgId: string
let clientId: string
let agentId: string
const createdTicketIds: string[] = []

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const [client, agent] = await Promise.all([
    prisma.user.create({ data: { name: `Cli ${SUFFIX}`, email: `cli-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } }),
    prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent' } }),
  ])
  clientId = client.id
  agentId = agent.id
})

afterAll(async () => {
  // Limpeza restrita aos IDs criados por este teste.
  await prisma.notification.deleteMany({ where: { ticket_id: { in: createdTicketIds } } }).catch(() => {})
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: createdTicketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [clientId, agentId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
})

describe('createTicket — abertura em nome de cliente', () => {
  it('registra o cliente como solicitante e o analista como criador, com evento de auditoria', async () => {
    const ticket = await TicketService.createTicket(
      { title: 'Aberto por telefone', description: 'cliente ligou', user_id: clientId, org_id: orgId, priority: 'medium' },
      agentId,
    )
    createdTicketIds.push(ticket!.id)

    const row = await prisma.ticket.findUnique({ where: { id: ticket!.id } })
    expect(row!.user_id).toBe(clientId)
    expect(row!.created_by_id).toBe(agentId)
    expect(row!.org_id).toBe(orgId)
    // SLA continua sendo calculado normalmente
    expect(row!.sla_deadline).toBeInstanceOf(Date)

    const events = await prisma.ticketEvent.findMany({ where: { ticket_id: ticket!.id } })
    expect(events).toHaveLength(1)
    expect(events[0].user_id).toBe(agentId)
    expect(events[0].to_status).toBe('open')
    expect(events[0].created_at).toBeInstanceOf(Date)
  })

  it('não marca created_by_id quando o próprio cliente abre o chamado', async () => {
    const ticket = await TicketService.createTicket(
      { title: 'Aberto pelo portal', description: 'eu mesmo', user_id: clientId, org_id: orgId, priority: 'medium' },
      clientId,
    )
    createdTicketIds.push(ticket!.id)

    const row = await prisma.ticket.findUnique({ where: { id: ticket!.id } })
    expect(row!.created_by_id).toBeNull()
  })
})

describe('createTicket — abertura proativa vinculada a empresa', () => {
  it('mantém o analista como solicitante e usa a empresa escolhida', async () => {
    const ticket = await TicketService.createTicket(
      { title: 'Ação proativa', description: 'manutenção preventiva', user_id: agentId, org_id: orgId, priority: 'medium' },
      agentId,
    )
    createdTicketIds.push(ticket!.id)

    const row = await prisma.ticket.findUnique({ where: { id: ticket!.id } })
    expect(row!.user_id).toBe(agentId)
    expect(row!.org_id).toBe(orgId)
    // Criador == solicitante: não é abertura em nome de terceiro.
    expect(row!.created_by_id).toBeNull()
  })

  it('registra nota de auditoria diferenciada quando auditNote é fornecida', async () => {
    const ticket = await TicketService.createTicket(
      { title: 'Ação proativa 2', description: 'manutenção preventiva', user_id: agentId, org_id: orgId, priority: 'medium', auditNote: `Chamado proativo aberto para a empresa Org ${SUFFIX}` },
      agentId,
    )
    createdTicketIds.push(ticket!.id)

    const events = await prisma.ticketEvent.findMany({ where: { ticket_id: ticket!.id } })
    expect(events).toHaveLength(1)
    expect(events[0].note).toBe(`Chamado proativo aberto para a empresa Org ${SUFFIX}`)
  })
})

describe('createTicket — anexos gravados junto com o chamado', () => {
  it('os anexos já existem quando createTicket retorna (webhook ticket.created relê o chamado)', async () => {
    const ticket = await TicketService.createTicket(
      { title: 't', description: 'd', user_id: clientId, org_id: orgId, attachments: [{ name: 'a.png', url: 'blob-a', size: '10', type: 'image' }] },
      clientId,
    )
    createdTicketIds.push(ticket!.id)
    const rows = await prisma.ticketAttachment.findMany({ where: { ticket_id: ticket!.id } })
    expect(rows.map(r => r.name)).toEqual(['a.png'])
    await prisma.ticketAttachment.deleteMany({ where: { ticket_id: ticket!.id } })
  })
})
