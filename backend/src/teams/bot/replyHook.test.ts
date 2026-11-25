import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
// Grava em banco real: rodar só contra o banco descartável (127.0.0.1:5434).
const notify = vi.hoisted(() => vi.fn(async () => 0))
vi.mock('./notifier', async importOriginal => ({ ...(await importOriginal<typeof import('./notifier')>()), notifyAgentReply: notify }))

import prisma from '../../config/prisma'
import { TicketService } from '../../services/tickets'

// TicketService.addMessage entrega toda mensagem ao aviso do Teams, sem esperar.
const tag = `teamshook-${Date.now()}`
let requesterId = ''
let agentId = ''
const ticketId = `TKT-${tag}`

beforeAll(async () => {
  requesterId = (await prisma.user.create({ data: { name: `Req ${tag}`, email: `req-${tag}@t.com`, role: 'user' } })).id
  agentId = (await prisma.user.create({ data: { name: `Ana ${tag}`, email: `ana-${tag}@t.com`, role: 'agent', queues: ['geral'] } })).id
  await prisma.ticket.create({
    data: { id: ticketId, display_number: `INC-${tag}`, title: 'VPN', user_id: requesterId, assigned_to_id: agentId, queue: 'geral', status: 'in_progress', sla_deadline: new Date(Date.now() + 864e5) },
  })
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [requesterId, agentId] } } }).catch(() => {})
  await prisma.notification.deleteMany({ where: { ticket_id: ticketId } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [requesterId, agentId] } } }).catch(() => {})
})

beforeEach(() => notify.mockClear())

describe('gancho da resposta do analista', () => {
  it('resposta pública do analista chama o aviso do Teams com chamado, autor e texto', async () => {
    await TicketService.addMessage(ticketId, agentId, 'Pode testar de novo?', 'agent')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      ticket: expect.objectContaining({ id: ticketId, display_number: `INC-${tag}`, user_id: requesterId }),
      authorId: agentId, authorName: `Ana ${tag}`, type: 'agent', text: 'Pode testar de novo?', isRealtime: false,
    }))
  })

  it('o aviso que falha não derruba a mensagem', async () => {
    notify.mockRejectedValueOnce(new Error('Teams fora'))
    const message = await TicketService.addMessage(ticketId, agentId, 'Outra resposta', 'agent').catch(e => e)
    expect(message).toMatchObject({ text: 'Outra resposta' })
  })
})
