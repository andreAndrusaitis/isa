import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../ai/agents/triage/agent', () => ({ triageTicket: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../ai/agents/intake/agent', () => ({ intakeTicket: vi.fn().mockResolvedValue(undefined) }))

import prisma from '../config/prisma'
import * as socketConfig from '../config/socket'
import { TicketService } from './tickets'

const SUFFIX = `aisysmsg-${Date.now()}`
let orgId: string, reqId: string

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
})
afterAll(async () => {
  vi.restoreAllMocks()
  await prisma.ticket.deleteMany({ where: { user_id: reqId } })
  await prisma.user.deleteMany({ where: { id: reqId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('mensagem pública do sistema (assistente)', () => {
  it('chega ao chat aberto, sem toast, e não mexe no status', async () => {
    const t = await TicketService.createTicket({ title: `T ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId })
    // Solicitante com o chamado aberto: a entrega na sala é por socket, com o acesso reavaliado.
    const emit = vi.fn()
    const openChat = { data: { userId: reqId }, rooms: new Set([`ticket:${t!.id}`]), emit }
    const io: any = { to: vi.fn(() => ({ emit })), in: vi.fn(() => ({ fetchSockets: async () => [openChat] })), sockets: { sockets: new Map() } }
    vi.spyOn(socketConfig, 'getIo').mockReturnValue(io)

    await TicketService.addMessage(t!.id, 'system', 'pergunta', 'agent')

    expect(io.in).toHaveBeenCalledWith([`ticket:${t!.id}`])
    expect(emit).toHaveBeenCalledWith('ticket:message', expect.objectContaining({ text: 'pergunta' }))
    expect(emit.mock.calls.some(c => c[0] === 'ticket:new_message')).toBe(false)
    expect(await prisma.notification.count({ where: { ticket_id: t!.id } })).toBe(0)
    expect((await prisma.ticket.findUnique({ where: { id: t!.id } }))?.status).toBe('open')
  })
})
