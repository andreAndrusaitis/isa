import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'

// Notificação de resposta dispara e-mail real — mockado para não depender de rede.
vi.mock('./email/mailer', () => ({
  sendWelcomeEmail: vi.fn(async () => ({ status: 'SUCCESS' as const })),
}))
import { createTicket, createTicketMessage, getTicket, listTicketMessages, listTickets } from './externalApi'
import { SurveyService } from './survey'
import type { ApiKeyContext } from '../middlewares/apiKeyAuth'

// "Meus chamados" de uma integração: chamados e conversa de um solicitante.
const SUFFIX = `requester-${Date.now()}`
const domain = `${SUFFIX}.example.com`
const ana = `ana@${domain}`
const bruno = `bruno@${domain}`

let orgId: string
let ctx: ApiKeyContext
const tickets: string[] = []

async function open(email: string, title: string) {
  const result = await createTicket(ctx, { requester: { email }, ticket: { title, description: `${title} — descrição` } }, {})
  const body = result.body as { resource_id: string; portal_url: string }
  tickets.push(body.resource_id)
  return body
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}`, domains: [domain] } })).id
  const key = await prisma.apiKey.create({
    data: { name: `Key ${SUFFIX}`, key_hash: `hash-${SUFFIX}`, key_prefix: 'isakey_reqt', scopes: [], org_id: null },
  })
  ctx = { id: key.id, scopes: ['create_ticket', 'read_tickets', 'read_messages', 'create_message'], org_id: null }
})

afterAll(async () => {
  await prisma.surveyInstance.deleteMany({ where: { ticket_id: { in: tickets } } }).catch(() => undefined)
  await prisma.ticket.deleteMany({ where: { id: { in: tickets } } }).catch(() => undefined)
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${domain}` } } }).catch(() => undefined)
  await prisma.apiRequestLog.deleteMany({ where: { api_key_id: ctx.id } }).catch(() => undefined)
  await prisma.apiKey.deleteMany({ where: { id: ctx.id } }).catch(() => undefined)
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe.sequential('externalApi — chamados do solicitante', () => {
  it('devolve o link do portal ao criar, listar e consultar', async () => {
    const created = await open(ana, `Chamado A1 ${SUFFIX}`)
    expect(created.portal_url).toMatch(new RegExp(`/c/${created.resource_id}$`)) // link único do chamado; /portal?ticket= antigo redireciona

    const listed = await listTickets(ctx, { requester_email: ana })
    expect(listed.data[0].portal_url).toBe(created.portal_url)
    expect((await getTicket(ctx, created.resource_id)).portal_url).toBe(created.portal_url)
  })

  it('lista só os chamados do solicitante, do mais recente para o mais antigo', async () => {
    await open(bruno, `Chamado B1 ${SUFFIX}`)
    const second = await open(ana, `Chamado A2 ${SUFFIX}`)

    const result = await listTickets(ctx, { requester_email: ana.toUpperCase(), order: 'desc' })
    expect(result.data.map(t => t.title)).toEqual([`Chamado A2 ${SUFFIX}`, `Chamado A1 ${SUFFIX}`])
    expect(result.data[0].id).toBe(second.resource_id)
  })

  it('solicitante responde com anexos e a conversa não mostra nota interna', async () => {
    const [ticketId] = tickets
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })
    await prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: ticket.user_id, type: 'internal', text: 'nota interna' } })

    const log = Buffer.from('ERRO 42').toString('base64')
    const result = await createTicketMessage(ctx, ticketId, {
      requester_email: ana,
      text: 'Segue o log',
      attachments: [{ name: 'app.log', content_type: 'text/plain', content_bytes: log }, { name: 'print.png', content_type: 'image/png', content_bytes: log }],
    }, {})
    expect(result.statusCode).toBe(201)

    // Automações do ambiente (regras de roteamento) podem responder também: confere só o lado do solicitante.
    const messages = await listTicketMessages(ctx, ticketId, { requester_email: ana })
    expect(messages.some(m => m.text === 'nota interna')).toBe(false)
    expect(messages.filter(m => m.from_requester).map(m => [m.text, m.has_attachment])).toEqual([
      ['Segue o log', true],
      ['Anexo adicional: print.png', true],
    ])
  })

  it('não deixa outro solicitante ler nem responder o chamado', async () => {
    const [ticketId] = tickets
    await expect(listTicketMessages(ctx, ticketId, { requester_email: bruno })).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
    await expect(createTicketMessage(ctx, ticketId, { requester_email: bruno, text: 'oi' }, {})).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('chamado fechado recusa resposta', async () => {
    const [ticketId] = tickets
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'closed' } })
    await expect(createTicketMessage(ctx, ticketId, { requester_email: ana, text: 'ainda com erro' }, {}))
      .rejects.toMatchObject({ code: 'TICKET_CLOSED' })
  })

  it('mostra a pesquisa pendente só em chamado encerrado', async () => {
    const ticketId = tickets[2]
    expect((await getTicket(ctx, ticketId)).survey_url).toBeNull()

    const token = await SurveyService.getSurveyTokenForTicket(ticketId)
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'resolved' } })
    expect((await getTicket(ctx, ticketId)).survey_url).toMatch(new RegExp(`/survey/${token}$`))
  })
})
