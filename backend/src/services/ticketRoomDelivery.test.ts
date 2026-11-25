import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ai/agents/triage/agent', () => ({ triageTicket: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../ai/agents/intake/agent', () => ({ intakeTicket: vi.fn().mockResolvedValue(undefined) }))

import prisma from '../config/prisma'
import * as socketConfig from '../config/socket'
import { TicketService } from './tickets'

// O que sai pela sala `ticket:<id>`: quem entrou continua sendo reavaliado a cada entrega.
const SUFFIX = `room${Date.now()}`
let orgA: string, orgB: string, queueId: string
let cliId: string, anId: string, foraId: string
let ticketId: string, templateId: string

const sock = (userId: string, role: string) => ({
  data: { userId, role }, rooms: new Set([`ticket:${ticketId}`]), emit: vi.fn(), leave: vi.fn(), disconnect: vi.fn(),
})
const listen = (...sockets: ReturnType<typeof sock>[]) => {
  const io: any = { in: () => ({ fetchSockets: async () => sockets }), to: () => ({ emit: vi.fn() }) }
  vi.spyOn(socketConfig, 'getIo').mockReturnValue(io)
}
const events = (s: ReturnType<typeof sock>) => s.emit.mock.calls.map(c => c[0])

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `A ${SUFFIX}` } })).id
  orgB = (await prisma.organization.create({ data: { name: `B ${SUFFIX}` } })).id
  queueId = (await prisma.queue.create({ data: { name: `Fila ${SUFFIX}` } })).id
  const staff = (key: string, org: string) => ({
    name: key, email: `${key}-${SUFFIX}@t.com`, password: 'x', role: 'agent' as const, queues: [queueId], org_scopes: { create: { org_id: org } },
  })
  cliId = (await prisma.user.create({ data: { name: 'cli', email: `cli-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgA } })).id
  anId = (await prisma.user.create({ data: staff('an', orgA) })).id
  foraId = (await prisma.user.create({ data: staff('fora', orgB) })).id
  vi.spyOn(socketConfig, 'getIo').mockReturnValue(undefined)
  ticketId = (await TicketService.createTicket({ title: `T ${SUFFIX}`, description: 'd', user_id: cliId, org_id: orgA }))!.id
  await prisma.ticket.update({ where: { id: ticketId }, data: { queue: queueId } })
  await new Promise(r => setTimeout(r, 200)) // o aviso da abertura sai em segundo plano
})

beforeEach(() => { vi.spyOn(socketConfig, 'getIo').mockReturnValue(undefined) })

afterAll(async () => {
  vi.restoreAllMocks()
  await prisma.ticket.deleteMany({ where: { user_id: { in: [cliId, foraId] } } })
  await prisma.surveyTemplate.deleteMany({ where: { id: templateId } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [cliId, anId, foraId] } } })
  await prisma.user.deleteMany({ where: { id: { in: [cliId, anId, foraId] } } })
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  await prisma.queue.deleteMany({ where: { id: queueId } })
  await prisma.$disconnect()
})

describe('nota interna na sala do chamado', () => {
  it('editar nota não chega ao solicitante; chega a quem atende', async () => {
    const note = await prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: anId, type: 'internal', text: 'nota' } })
    const cliente = sock(cliId, 'user')
    const analista = sock(anId, 'agent')
    listen(cliente, analista)

    await TicketService.updateMessage(ticketId, note.id, anId, false, 'SEGREDO')

    expect(JSON.stringify(cliente.emit.mock.calls)).not.toContain('SEGREDO')
    expect(analista.emit).toHaveBeenCalledWith('ticket:message:updated', expect.objectContaining({ text: 'SEGREDO' }))
  })

  it('apagar nota não avisa o solicitante; apagar resposta pública avisa', async () => {
    const note = await prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: anId, type: 'internal', text: 'nota' } })
    const reply = await prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: anId, type: 'agent', text: 'resposta' } })
    const cliente = sock(cliId, 'user')
    listen(cliente)

    await TicketService.deleteMessage(ticketId, note.id, anId, false)
    expect(events(cliente)).not.toContain('ticket:message:deleted')

    await TicketService.deleteMessage(ticketId, reply.id, anId, false)
    expect(events(cliente)).toContain('ticket:message:deleted')
  })

  it('edição de resposta pública continua chegando ao solicitante', async () => {
    const reply = await prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: anId, type: 'agent', text: 'resposta' } })
    const cliente = sock(cliId, 'user')
    listen(cliente)

    await TicketService.updateMessage(ticketId, reply.id, anId, false, 'resposta corrigida')
    expect(cliente.emit).toHaveBeenCalledWith('ticket:message:updated', expect.objectContaining({ text: 'resposta corrigida' }))
  })
})

describe('quem perdeu o acesso com o chamado aberto', () => {
  it('não recebe a mensagem nova e sai da sala', async () => {
    const stale = sock(foraId, 'agent')
    const cliente = sock(cliId, 'user')
    listen(stale, cliente)

    await TicketService.addMessage(ticketId, anId, 'resposta pública', 'agent')

    expect(events(stale)).not.toContain('ticket:message')
    expect(stale.leave).toHaveBeenCalledWith(`ticket:${ticketId}`)
    expect(events(cliente)).toContain('ticket:message')
  })

  it('não recebe edição de mensagem e sai da sala', async () => {
    const reply = await prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: anId, type: 'agent', text: 'resposta' } })
    const stale = sock(foraId, 'agent')
    listen(stale)

    await TicketService.updateMessage(ticketId, reply.id, anId, false, 'editada')

    expect(events(stale)).not.toContain('ticket:message:updated')
    expect(stale.leave).toHaveBeenCalledWith(`ticket:${ticketId}`)
  })

  it('sai da sala já na mudança do chamado, antes de qualquer mensagem', async () => {
    const stale = sock(foraId, 'agent')
    listen(stale)

    await TicketService.broadcastTicketUpdate(ticketId, 'ticket:updated')

    expect(events(stale)).not.toContain('ticket:updated')
    expect(stale.leave).toHaveBeenCalledWith(`ticket:${ticketId}`)
  })

  it('falha na entrega não derruba a mensagem gravada', async () => {
    const io: any = { in: () => ({ fetchSockets: async () => { throw new Error('timeout do adapter') } }), to: () => ({ emit: vi.fn() }) }
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(socketConfig, 'getIo').mockReturnValue(io)
    const reply = await prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: anId, type: 'agent', text: 'resposta' } })

    await expect(TicketService.updateMessage(ticketId, reply.id, anId, false, 'editada')).resolves.toMatchObject({ text: 'editada' })
    quiet.mockRestore()
  })
})

describe('ticket:updated por socket', () => {
  it('equipe da carteira não recebe o token da pesquisa; o solicitante recebe', async () => {
    const template = await prisma.surveyTemplate.create({
      data: { nome: `Modelo ${SUFFIX}`, assunto_email: 'a', corpo_convite_auto: 'b', corpo_convite_macro: 'c', ativo: false },
    })
    templateId = template.id
    const token = `token-${SUFFIX}`
    await prisma.surveyInstance.create({ data: { ticket_id: ticketId, template_id: template.id, link_token: token } })
    const cliente = sock(cliId, 'user')
    const analista = sock(anId, 'agent')
    listen(cliente, analista)

    await TicketService.broadcastTicketUpdate(ticketId, 'ticket:updated')

    expect(JSON.stringify(analista.emit.mock.calls)).not.toContain(token)
    expect(JSON.stringify(cliente.emit.mock.calls)).toContain(token)
  })

  it('equipe fora da carteira no próprio chamado recebe sem nota interna', async () => {
    const own = (await TicketService.createTicket({ title: `T ${SUFFIX}`, description: 'd', user_id: foraId, org_id: orgA }))!.id
    await prisma.ticketMessage.create({ data: { ticket_id: own, user_id: anId, type: 'internal', text: 'NOTA-SECRETA' } })
    const dono = sock(foraId, 'agent')
    listen(dono)

    await TicketService.broadcastTicketUpdate(own, 'ticket:updated')

    expect(events(dono)).toContain('ticket:updated')
    expect(JSON.stringify(dono.emit.mock.calls)).not.toContain('NOTA-SECRETA')
  })
})
