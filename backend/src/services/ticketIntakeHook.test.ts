import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../ai/agents/triage/agent', () => ({ triageTicket: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../ai/agents/intake/agent', () => ({ intakeTicket: vi.fn().mockResolvedValue(undefined) }))

import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { intakeTicket } from '../ai/agents/intake/agent'
import { triageTicket } from '../ai/agents/triage/agent'

const SUFFIX = `aiintakehook-${Date.now()}`
let orgId: string, reqId: string, agentId: string

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  agentId = (await prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId } })).id
})
afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { user_id: reqId } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

const open = () => TicketService.createTicket({ title: `T ${SUFFIX}`, description: 'não imprime', user_id: reqId, org_id: orgId })

describe('agente intake no fluxo do chamado', () => {
  it('abertura chama intakeTicket com o id do chamado (depois da triagem)', async () => {
    const t = await open()
    await vi.waitFor(() => expect(intakeTicket).toHaveBeenCalledWith(t!.id))
    expect(vi.mocked(triageTicket).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(intakeTicket).mock.invocationCallOrder[0])
  })

  it('1ª resposta do solicitante a um chamado incompleto vai para a descrição, uma vez só', async () => {
    const t = await open()
    await prisma.ticket.update({ where: { id: t!.id }, data: { intake_status: 'incomplete' } })
    await TicketService.addMessage(t!.id, reqId, 'É a impressora do 2º andar, erro 0x0001', 'user')
    await TicketService.addMessage(t!.id, reqId, 'outra mensagem', 'user')
    const after = await prisma.ticket.findUnique({ where: { id: t!.id } })
    expect(after?.intake_status).toBe('complemented')
    expect(after?.description).toMatch(/^não imprime\n\n— Complemento do solicitante \(\d{2}\/\d{2},? \d{2}:\d{2}\) —\nÉ a impressora do 2º andar, erro 0x0001$/)
  })

  it('mensagem do analista não complementa', async () => {
    const t = await open()
    await prisma.ticket.update({ where: { id: t!.id }, data: { intake_status: 'incomplete' } })
    await TicketService.addMessage(t!.id, agentId, 'Olá', 'agent')
    expect((await prisma.ticket.findUnique({ where: { id: t!.id } }))?.intake_status).toBe('incomplete')
  })

  it('resposta só com anexo complementa com marcador, não com bloco vazio', async () => {
    const t = await open()
    await prisma.ticket.update({ where: { id: t!.id }, data: { intake_status: 'incomplete' } })
    await TicketService.addMessage(t!.id, reqId, '', 'user', 'print.png')
    const after = await prisma.ticket.findUnique({ where: { id: t!.id } })
    expect(after?.intake_status).toBe('complemented')
    expect(after?.description).toMatch(/\n\(enviou anexo na conversa\)$/)
  })
})
