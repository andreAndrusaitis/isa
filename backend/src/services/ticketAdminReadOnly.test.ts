import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { can } from '../access/can'
import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { ON_BEHALF_ROLES } from '../controllers/tickets'

const SUFFIX = `admin-ro-${Date.now()}`
let orgId: string, reqId: string, adminId: string, ticketId: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  const admin = await prisma.user.create({ data: { name: `Admin ${SUFFIX}`, email: `admin-${SUFFIX}@t.com`, password: 'x', role: 'admin' } })
  reqId = req.id; adminId = admin.id
  const t = await prisma.ticket.create({ data: { id: `ARO-${SUFFIX}`, display_number: `INC-ARO-${SUFFIX}`, title: 'ro', description: 'd', user_id: reqId, org_id: orgId, queue: 'q1', status: 'open', sla_deadline: new Date(Date.now() + 86400000) } })
  ticketId = t.id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [reqId, adminId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
})

describe('updateTicket — admin somente leitura', () => {
  it('admin não pode mudar status do chamado', async () => {
    await expect(
      TicketService.updateTicket(ticketId, adminId, 'admin', { status: 'in_progress' })
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin não pode se auto-atribuir o chamado', async () => {
    await expect(
      TicketService.updateTicket(ticketId, adminId, 'admin', { assigned_to_id: adminId })
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin não pode configurar SLA de reabertura por ticket', async () => {
    await expect(
      TicketService.updateTicket(ticketId, adminId, 'admin', { reopen_sla_enabled: false })
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('mensagens — admin somente leitura', () => {
  let messageId: string

  beforeAll(async () => {
    const msg = await prisma.ticketMessage.create({
      data: { ticket_id: ticketId, user_id: reqId, type: 'user', text: 'mensagem original' },
    })
    messageId = msg.id
  })

  it('admin não pode editar mensagem de outro usuário', async () => {
    await expect(
      TicketService.updateMessage(ticketId, messageId, adminId, can({ role: 'admin' }, 'tickets.messages.moderate'), 'texto editado')
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin não pode excluir mensagem de outro usuário', async () => {
    await expect(
      TicketService.deleteMessage(ticketId, messageId, adminId, can({ role: 'admin' }, 'tickets.messages.moderate'))
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('createTicket — admin não abre chamado em nome de cliente', () => {
  it('ON_BEHALF_ROLES não inclui mais admin', () => {
    expect(ON_BEHALF_ROLES).not.toContain('admin')
  })
})
