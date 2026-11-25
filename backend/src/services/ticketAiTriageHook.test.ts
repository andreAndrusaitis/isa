import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../ai/agents/triage/agent', () => ({ triageTicket: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../ai/agents/intake/agent', () => ({ intakeTicket: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./email/ticketCreatedNotice', () => ({ notifyTicketCreated: vi.fn().mockResolvedValue(undefined) }))

import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { triageTicket } from '../ai/agents/triage/agent'
import { notifyTicketCreated } from './email/ticketCreatedNotice'

const SUFFIX = `aihook-${Date.now()}`
let orgId: string, reqId: string

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
})
afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { user_id: reqId } })
  await prisma.user.deleteMany({ where: { id: reqId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('abertura dispara a triagem por IA', () => {
  it('chama triageTicket com o id do chamado criado', async () => {
    const t = await TicketService.createTicket({ title: `T ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId })
    expect(triageTicket).toHaveBeenCalledWith(t!.id)
  })

  it('dispara o e-mail de confirmação de abertura', async () => {
    const t = await TicketService.createTicket({ title: `T2 ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId })
    expect(notifyTicketCreated).toHaveBeenCalledWith(t!.id)
  })
})
