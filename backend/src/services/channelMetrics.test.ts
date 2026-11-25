// Canal de origem gravado na abertura e métricas por canal.
// Prisma real contra o banco descartável; cleanup restrito aos IDs criados aqui.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'
import { TicketController } from '../controllers/tickets'
import { TicketService } from './tickets'
import { getChannelMetrics, summarizeChannels, surveyScore, type ChannelRow } from './channelMetrics'
import { createTicketFromEmail } from './externalApi'

vi.mock('./email/mailer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./email/mailer')>()),
  sendWelcomeEmail: vi.fn(async () => ({ status: 'SKIPPED_ACS_NOT_CONFIGURED' as const })),
}))
// O aviso de abertura por e-mail não interessa aqui e nunca deve sair de um teste.
vi.mock('./email/ticketCreatedNotice', () => ({ notifyTicketCreated: vi.fn(async () => {}) }))

const S = `channels-${Date.now()}`
let orgId: string
let otherOrgId: string
let clientId: string
let agentId: string
let managerId: string
const ticketIds: string[] = []
const userIds: string[] = []

function makeReqRes(body: any, user: any) {
  const req: any = { body, user, ip: '127.0.0.1', headers: {}, socket: {} }
  const json = vi.fn()
  const res: any = { status: vi.fn(() => ({ json })), json }
  const next = vi.fn()
  return { req, res, next, json }
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${S}`, domains: [`${S}.com.br`] } })).id
  otherOrgId = (await prisma.organization.create({ data: { name: `Outra ${S}` } })).id
  clientId = (await prisma.user.create({ data: { name: `Cliente ${S}`, email: `cli@${S}.com.br`, password: 'x', role: 'user', org_id: orgId } })).id
  agentId = (await prisma.user.create({ data: { name: `Analista ${S}`, email: `ag-${S}@t.com`, password: 'x', role: 'agent' } })).id
  managerId = (await prisma.user.create({ data: { name: `Gerente ${S}`, email: `ger-${S}@t.com`, password: 'x', role: 'manager' } })).id
  userIds.push(clientId, agentId, managerId)
  await prisma.userOrgScope.create({ data: { user_id: managerId, org_id: orgId } })
})

afterAll(async () => {
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {})
  await prisma.userOrgScope.deleteMany({ where: { user_id: managerId } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {})
})

describe('canal de origem gravado na abertura', () => {
  it('portal grava canal e tempo de preenchimento', async () => {
    const { req, res, next, json } = makeReqRes({ title: 't', description: 'd', openingSeconds: 95 }, { sub: clientId, role: 'user', orgId })
    await TicketController.create(req, res, next)
    expect(next).not.toHaveBeenCalled()
    const id = json.mock.calls[0][0].data.id
    ticketIds.push(id)
    expect(await prisma.ticket.findUnique({ where: { id }, select: { channel: true, opening_seconds: true } })).toEqual({ channel: 'portal', opening_seconds: 95 })
  })

  it('tempo de preenchimento fora do intervalo é recusado', async () => {
    const { req, res, next } = makeReqRes({ title: 't', description: 'd', openingSeconds: -1 }, { sub: clientId, role: 'user', orgId })
    await TicketController.create(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('e-mail grava canal email', async () => {
    const { ticket } = await createTicketFromEmail({ fromEmail: `cli@${S}.com.br`, fromName: 'Cliente', subject: 'Impressora', text: 'não imprime', attachments: [], notImported: [] } as any)
    ticketIds.push(ticket!.id)
    expect((await prisma.ticket.findUnique({ where: { id: ticket!.id } }))!.channel).toBe('email')
  })
})

describe('métricas por canal', () => {
  beforeAll(async () => {
    // Portal: resolvido com 1 resposta (1º contato), respondido.
    const a = await TicketService.createTicket({ title: 'a', description: 'd', user_id: clientId, org_id: orgId, channel: 'portal', opening_seconds: 60 }, clientId)
    // API: resolvido com 2 respostas (não é 1º contato).
    const b = await TicketService.createTicket({ title: 'b', description: 'd', user_id: clientId, org_id: orgId, channel: 'api' }, clientId)
    // Antigo, sem canal: "Não identificado".
    const c = await TicketService.createTicket({ title: 'c', description: 'd', user_id: clientId, org_id: orgId }, clientId)
    // Outra empresa: fora da carteira do gerente.
    const d = await TicketService.createTicket({ title: 'd', description: 'd', user_id: clientId, org_id: otherOrgId, channel: 'portal' }, clientId)
    ticketIds.push(a!.id, b!.id, c!.id, d!.id)
    await prisma.ticket.updateMany({ where: { id: { in: [a!.id, b!.id] } }, data: { status: 'resolved' } })
    await prisma.ticketMessage.createMany({
      data: [
        { ticket_id: a!.id, user_id: agentId, type: 'agent', text: 'resolvido' },
        { ticket_id: a!.id, user_id: agentId, type: 'internal', text: 'nota interna não conta' },
        { ticket_id: b!.id, user_id: agentId, type: 'agent', text: 'primeira' },
        { ticket_id: b!.id, user_id: agentId, type: 'agent', text: 'segunda' },
      ],
    })
  })

  const period = () => ({ from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 60_000) })
  const mine = (channels: Awaited<ReturnType<typeof getChannelMetrics>>['channels']) => channels

  it('gerente vê só a carteira, agrupado por canal com "Não identificado"', async () => {
    const { channels } = await getChannelMetrics('manager', managerId, period())
    const byChannel = Object.fromEntries(mine(channels).map((c) => [c.channel, c]))
    // portal: o do 1º teste + "a" (o "d" é de outra empresa)
    expect(byChannel.portal.tickets).toBe(2)
    expect(byChannel.portal.avgOpeningSeconds).toBe(77.5)
    expect(byChannel.portal.resolved).toBe(1)
    expect(byChannel.portal.firstContactRate).toBe(100)
    expect(byChannel.portal.responded).toBe(1)
    expect(byChannel.api).toMatchObject({ tickets: 1, resolved: 1, firstContactRate: 0, responded: 1 })
    expect(byChannel.email.tickets).toBe(1)
    expect(byChannel.unknown.tickets).toBe(1)
    expect(channels.map((c) => c.channel)).toEqual(['portal', 'email', 'api', 'unknown'])
  })

  it('admin vê todas as empresas', async () => {
    const { channels } = await getChannelMetrics('admin', managerId, period())
    const portal = channels.find((c) => c.channel === 'portal')!
    expect(portal.tickets).toBeGreaterThanOrEqual(3)
  })
})

describe('regras puras', () => {
  const base: ChannelRow = { channel: 'portal', status: 'open', isReopened: false, openingSeconds: null, createdAt: new Date('2026-10-05T12:00:00Z'), firstAgentReplyAt: null, agentReplies: 0, csat: null }

  it('reabertura tira do 1º contato e sem resolvidos a taxa fica vazia', () => {
    const rows: ChannelRow[] = [
      { ...base, status: 'closed', agentReplies: 1, isReopened: true },
      { ...base, status: 'resolved', agentReplies: 0 },
      { ...base, channel: 'teams' },
    ]
    const [portal, teams] = summarizeChannels(rows, () => 0)
    expect(portal.firstContactRate).toBe(50)
    expect(teams.firstContactRate).toBeNull()
  })

  it('1ª resposta usa o calendário recebido e CSAT faz média das notas', () => {
    const rows: ChannelRow[] = [
      { ...base, firstAgentReplyAt: new Date('2026-10-05T14:00:00Z'), csat: 100 },
      { ...base, firstAgentReplyAt: new Date('2026-10-05T13:00:00Z'), csat: 50 },
    ]
    const [portal] = summarizeChannels(rows, (a, b) => (b.getTime() - a.getTime()) / 60_000)
    expect(portal.avgFirstResponseHours).toBe(1.5)
    expect(portal.csat).toBe(75)
    expect(portal.csatResponses).toBe(2)
  })

  it('nota da pesquisa normalizada pela escala de cada pergunta', () => {
    const scale = (vals: number[]) => ({ opcoes: vals.map((v) => ({ valor: String(v) })) })
    expect(surveyScore([{ valor_numero: 5, question: scale([1, 2, 3, 4, 5]) }, { valor_numero: 0, question: scale([0, 10]) }])).toBe(50)
    expect(surveyScore([{ valor_numero: null, question: scale([1, 5]) }])).toBeNull()
  })
})
