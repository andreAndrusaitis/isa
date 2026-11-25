import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

vi.mock('../../../services/email/ticketCreatedNotice', () => ({ notifyTicketCreated: vi.fn(async () => {}) }))
vi.mock('../../../services/email/ticketUpdateDigest', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../services/email/ticketUpdateDigest')>(), queueRequesterUpdate: vi.fn(),
}))
vi.mock('../../../services/webhookEvents', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../services/webhookEvents')>(), emitWebhookEvent: vi.fn(),
}))
vi.mock('../../../services/routing', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../services/routing')>(), runRoutingRules: vi.fn(async () => {}),
}))
vi.mock('../triage/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('../triage/agent')>(), triageTicket: vi.fn(async () => {}),
}))
vi.mock('../intake/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('../intake/agent')>(), intakeTicket: vi.fn(async () => {}),
}))
vi.mock('../guidance/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('../guidance/agent')>(), guidanceTicket: vi.fn(async () => {}),
}))
vi.mock('../resolution/distill', async (importOriginal) => ({
  ...await importOriginal<typeof import('../resolution/distill')>(), distillTicket: vi.fn(async () => {}),
}))

import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../../../config/prisma'
import { env } from '../../../config/env'
import { errorHandler } from '../../../middlewares/errorHandler'
import ticketRoutes from '../../../routes/tickets'
import { getAutoCloseConfig, runAutoCloseJob, upsertAutoCloseConfig } from '../../../services/autoClose'
import { getChannelMetrics } from '../../../services/channelMetrics'
import { notifyTicketCreated } from '../../../services/email/ticketCreatedNotice'
import { queueRequesterUpdate } from '../../../services/email/ticketUpdateDigest'
import { NotificationService } from '../../../services/notifications'
import { runRoutingRules } from '../../../services/routing'
import { SurveyService } from '../../../services/survey'
import { TicketService } from '../../../services/tickets'
import { emitWebhookEvent } from '../../../services/webhookEvents'
import { guidanceTicket } from '../guidance/agent'
import { intakeTicket } from '../intake/agent'
import { distillTicket } from '../resolution/distill'
import { triageTicket } from '../triage/agent'
import { ACCEPT_WINDOW_MS, MAX_ANSWER_IN_RESOLUTION, MAX_EXTRA_ATTACHMENTS } from './accept'
import { suggestRouter } from './routes'

const SUFFIX = `kbaccept-${Date.now()}`
const SOURCE = { articleId: 'artigo-1', title: 'Spooler travado' }

let orgId: string, slaId: string, queueId: string, catId: string, blockedCatId: string
let ownerId: string, otherId: string, agentId: string, adminId: string

const app = express()
app.use(express.json({ limit: '30mb' }))
app.use('/api/ai/suggest', suggestRouter())
app.use('/api/tickets', ticketRoutes)
app.use(errorHandler)

const bearer = (id: string, role = 'user') =>
  `Bearer ${jwt.sign({ sub: id, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

const interaction = async (data: Record<string, unknown> = {}) => (await prisma.aiInteraction.create({
  data: { user_id: ownerId, org_id: orgId, question: 'Impressora', answer: 'Reinicie o spooler.', confidence: 0.97, sources: [SOURCE], ...data },
})).id

let seq = 0
const body = (extra: object = {}) => ({ title: `Impressora ${SUFFIX} ${++seq}`, description: 'não imprime', categoryId: catId, ...extra })
const accept = (id: string, payload: object = body(), userId = ownerId, role = 'user') =>
  request(app).post(`/api/ai/suggest/${id}/accept`).set('Authorization', bearer(userId, role)).send(payload)
const open = (payload: object) =>
  request(app).post('/api/tickets').set('Authorization', bearer(ownerId)).send(payload)

const row = (id: string) => prisma.aiInteraction.findUniqueOrThrow({ where: { id } })
const ticketOf = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } })
const accepted = async () => (await accept(await interaction())).body.data.id as string
const settle = () => new Promise(r => setTimeout(r, 50))

beforeAll(async () => {
  queueId = (await prisma.queue.create({ data: { name: `Fila ${SUFFIX}` } })).id
  catId = (await prisma.category.create({ data: { name: `Cat ${SUFFIX}` } })).id
  blockedCatId = (await prisma.category.create({ data: { name: `Bloqueada ${SUFFIX}` } })).id
  const tier = `plano-${SUFFIX}`
  slaId = (await prisma.slaConfig.create({
    data: { tier, incident_first_response_hours: 2, incident_resolution_hours: 8, default_queue: queueId },
  })).id
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}`, tier } })).id
  await prisma.orgCategoryBlock.create({ data: { org_id: orgId, category_id: blockedCatId } })
  const user = async (name: string, role: string, extra: object = {}) => (await prisma.user.create({
    data: { name: `${name} ${SUFFIX}`, email: `${name}-${SUFFIX}@t.com`, password: 'x', role: role as 'user', org_id: orgId, ...extra },
  })).id
  ownerId = await user('dono', 'user')
  otherId = await user('outro', 'user')
  agentId = await user('analista', 'agent', { queues: [queueId] })
  await prisma.userOrgScope.create({ data: { user_id: agentId, org_id: orgId } })
  adminId = await user('admin', 'admin')
  vi.spyOn(NotificationService, 'create').mockResolvedValue(undefined as any)
  vi.spyOn(NotificationService, 'broadcastQueueAlert').mockResolvedValue(undefined as any)
  vi.spyOn(SurveyService, 'getSurveyTokenForTicket')
  vi.spyOn(SurveyService, 'triggerAutoSurvey').mockResolvedValue(undefined as any)
})

beforeEach(() => { vi.clearAllMocks() })

afterAll(async () => {
  vi.restoreAllMocks()
  const users = [ownerId, otherId, agentId, adminId]
  const tickets = (await prisma.ticket.findMany({ where: { user_id: { in: users } }, select: { id: true } })).map(t => t.id)
  await prisma.aiInteraction.deleteMany({ where: { user_id: { in: users } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: users } } })
  await prisma.autoCloseLog.deleteMany({ where: { ticket_id: { in: tickets } } })
  await prisma.surveyInstance.deleteMany({ where: { ticket_id: { in: tickets } } })
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: tickets } } })
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: tickets } } })
  await prisma.ticket.deleteMany({ where: { id: { in: tickets } } })
  await prisma.user.deleteMany({ where: { id: { in: users } } })
  await prisma.orgCategoryBlock.deleteMany({ where: { org_id: orgId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.slaConfig.deleteMany({ where: { id: slaId } })
  await prisma.category.deleteMany({ where: { id: { in: [catId, blockedCatId] } } })
  await prisma.queue.deleteMany({ where: { id: queueId } })
  await prisma.$disconnect()
})

describe('POST /api/ai/suggest/:interactionId/accept', () => {
  it('sem login = 401', async () => {
    expect((await request(app).post('/api/ai/suggest/x/accept').send(body())).status).toBe(401)
  })

  it('nasce resolvido, fora da fila, com nota, evento, auditoria e ligado à interação', async () => {
    const id = await interaction()
    const payload = body()
    const r = await accept(id, payload)
    expect(r.status).toBe(201)
    expect(r.body.data).toMatchObject({ status: 'resolved', title: payload.title, aiResolved: true, categoryId: catId })

    const t = await ticketOf(r.body.data.id)
    expect(t).toMatchObject({
      status: 'resolved', ai_resolved: true, queue: null, assigned_to_id: null,
      first_response_deadline: null, closed_at: null, channel: 'portal', user_id: ownerId, org_id: orgId,
    })
    expect(t.resolved_at).toBeInstanceOf(Date)
    expect(t.resolution_details).toContain('Resolvido pela Skadi com a base de conhecimento')
    expect(t.resolution_details).toContain('Resposta dada pela Skadi:')
    expect(t.resolution_details).toContain(SOURCE.title)
    // Não pode nascer "violado": resolvido antes do prazo.
    expect(t.resolved_at!.getTime()).toBeLessThanOrEqual(t.sla_deadline.getTime())

    expect(await row(id)).toMatchObject({ accepted: true, ticket_id: t.id })

    const events = await prisma.ticketEvent.findMany({ where: { ticket_id: t.id } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ user_id: ownerId, from_status: null, to_status: 'resolved' })
    expect(events[0].note).toContain('Resolvido pela Skadi com a base de conhecimento')

    const audit = await prisma.auditLog.findFirst({ where: { user_id: ownerId, action: 'TICKET_RESOLVED_BY_AI' }, orderBy: { created_at: 'desc' } })
    expect(audit?.details).toMatchObject({ ticketId: t.id, interactionId: id, articleIds: [SOURCE.articleId] })
    expect(await prisma.surveyInstance.findUnique({ where: { ticket_id: t.id } })).toBeNull()
  })

  it('ninguém é acionado: notificação, e-mail, pesquisa, webhook, regras e cadeia de IA', async () => {
    expect((await accept(await interaction())).status).toBe(201)
    await settle()
    for (const fn of [
      notifyTicketCreated, queueRequesterUpdate, emitWebhookEvent, runRoutingRules,
      triageTicket, intakeTicket, guidanceTicket, distillTicket,
      NotificationService.create, NotificationService.broadcastQueueAlert,
      SurveyService.getSurveyTokenForTicket, SurveyService.triggerAutoSurvey,
    ]) expect(fn).not.toHaveBeenCalled()
  })

  it('clique duplo cria um chamado só', async () => {
    const id = await interaction()
    const payload = body()
    const replies = await Promise.all([accept(id, payload), accept(id, payload)])
    expect(replies.map(r => r.status).sort()).toEqual([201, 409])
    expect(await prisma.ticket.count({ where: { title: payload.title } })).toBe(1)
    expect((await row(id)).ticket_id).toBe(replies.find(r => r.status === 201)!.body.data.id)
  })

  it('interação de outro usuário ou inexistente = 404, sem chamado', async () => {
    const id = await interaction()
    const payload = body()
    expect((await accept(id, payload, otherId)).status).toBe(404)
    expect((await accept('nao-existe', payload)).status).toBe(404)
    expect(await prisma.ticket.count({ where: { title: payload.title } })).toBe(0)
    expect((await row(id)).accepted).toBe(false)
  })

  it.each([
    ['já aceita', { accepted: true }, 'AI_INTERACTION_USED'],
    ['sem resposta gravada', { answer: null }, 'AI_INTERACTION_NO_ANSWER'],
    ['vencida', { created_at: new Date(Date.now() - ACCEPT_WINDOW_MS - 60_000) }, 'AI_INTERACTION_EXPIRED'],
  ])('%s = 409, sem chamado', async (_name, data, code) => {
    const payload = body()
    const r = await accept(await interaction(data), payload)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe(code)
    expect(await prisma.ticket.count({ where: { title: payload.title } })).toBe(0)
  })

  it('interação já ligada a chamado aberto na recusa = 409', async () => {
    const id = await interaction()
    const opened = await open(body({ aiInteractionId: id }))
    expect(opened.status).toBe(201)
    const r = await accept(id)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('AI_INTERACTION_USED')
    expect((await row(id)).ticket_id).toBe(opened.body.data.id)
  })

  it('corpo inválido = 400 e a interação segue livre', async () => {
    const id = await interaction()
    expect((await accept(id, body({ priority: 'urgente' }))).status).toBe(400)
    expect((await row(id)).accepted).toBe(false)
  })

  it('categoria bloqueada para a empresa = 400 e a interação segue livre', async () => {
    const id = await interaction()
    const r = await accept(id, body({ categoryId: blockedCatId }))
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('CATEGORY_NOT_AVAILABLE')
    expect((await row(id)).accepted).toBe(false)
  })

  it('plano vencido = 403; falha na criação desfaz a reserva e dá para tentar de novo', async () => {
    const id = await interaction()
    await prisma.organization.update({ where: { id: orgId }, data: { expires_at: new Date(Date.now() - 864e5) } })
    try {
      const r = await accept(id)
      expect(r.status).toBe(403)
      expect(r.body.code).toBe('SLA_PLAN_EXPIRED')
      expect(await row(id)).toMatchObject({ accepted: false, ticket_id: null })
    } finally {
      await prisma.organization.update({ where: { id: orgId }, data: { expires_at: null } })
    }
    expect((await accept(id)).status).toBe(201)
  })

  it('título em branco falha na criação e desfaz a reserva', async () => {
    const id = await interaction()
    expect((await accept(id, { description: 'só descrição' })).status).toBe(400)
    expect((await row(id)).accepted).toBe(false)
  })

  it('só em nome próprio: em nome de cliente ou empresa = 400', async () => {
    const id = await interaction({ user_id: agentId })
    for (const extra of [{ onBehalfOfUserId: ownerId }, { proactiveOrgId: orgId }]) {
      const r = await accept(id, body(extra), agentId, 'agent')
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('AI_ACCEPT_SELF_ONLY')
    }
    expect((await row(id)).accepted).toBe(false)
  })

  it('admin é somente leitura em chamados', async () => {
    expect((await accept(await interaction({ user_id: adminId }), body(), adminId, 'admin')).status).toBe(403)
  })
})

describe('resolução gravada no chamado', () => {
  it('traz a resposta da IA além da fonte; o evento fica só com a fonte', async () => {
    const r = await accept(await interaction({ answer: 'Abra Serviços e reinicie o spooler.' }))
    const t = await ticketOf(r.body.data.id)
    expect(t.resolution_details).toContain(SOURCE.title)
    expect(t.resolution_details).toContain('Abra Serviços e reinicie o spooler.')
    const [event] = await prisma.ticketEvent.findMany({ where: { ticket_id: t.id } })
    expect(event.note).toContain(SOURCE.title)
    expect(event.note).not.toContain('reinicie o spooler')
  })

  it('não grava dado sensível em claro, nem cortado no meio', async () => {
    const tail = 'fulano.de.tal@empresa.com.br'
    const pad = 'x '.repeat(MAX_ANSWER_IN_RESOLUTION / 2 - 10)
    const r = await accept(await interaction({ answer: `Use a senha: Abc123 e o CPF 123.456.789-09. ${pad}${tail} fim` }))
    const details = (await ticketOf(r.body.data.id)).resolution_details!
    expect(details).toContain('[SENHA]')
    expect(details).toContain('[CPF]')
    for (const clear of ['Abc123', '123.456.789-09', 'fulano', '@empresa']) expect(details).not.toContain(clear)
  })

  it('corta resposta longa num tamanho razoável', async () => {
    const r = await accept(await interaction({ answer: 'a'.repeat(MAX_ANSWER_IN_RESOLUTION * 3) }))
    const details = (await ticketOf(r.body.data.id)).resolution_details!
    expect(details.length).toBeLessThan(MAX_ANSWER_IN_RESOLUTION + 200)
    expect(details.endsWith('…')).toBe(true)
  })

  it('a resposta vem da interação, nunca do corpo', async () => {
    const r = await accept(await interaction(), body({ answer: 'injetada', resolution_details: 'injetada' }))
    expect((await ticketOf(r.body.data.id)).resolution_details).not.toContain('injetada')
  })
})

describe('vários anexos no aceite', () => {
  const file = (text: string) => `data:text/plain;base64,${Buffer.from(text).toString('base64')}`
  const extras = (...names: string[]) => names.map(name => ({ name, url: file(name) }))
  const messagesOf = (id: string) => prisma.ticketMessage.findMany({ where: { ticket_id: id }, orderBy: { created_at: 'asc' } })
  const untouched = async (id: string) => expect(await row(id)).toMatchObject({ accepted: false, ticket_id: null })

  it('3 anexos: segue resolvido, ninguém é avisado e os anexos aparecem', async () => {
    const r = await accept(await interaction(), body({ attachment_url: file('a.txt'), extra_attachments: extras('b.txt', 'c.txt') }))
    expect(r.status).toBe(201)
    await settle()

    const t = await ticketOf(r.body.data.id)
    expect(t).toMatchObject({ status: 'resolved', ai_resolved: true, is_reopened: false, queue: null })
    expect(t.attachment_url).toBe(file('a.txt'))

    // Mesmo formato de addMessage: é ele que o agrupamento de anexos da tela reconhece.
    const messages = await messagesOf(t.id)
    expect(messages.map(m => [m.type, m.user_id, m.text, m.attachment_url, m.is_realtime])).toEqual([
      ['user', ownerId, 'Anexo adicional: b.txt', file('b.txt'), false],
      ['user', ownerId, 'Anexo adicional: c.txt', file('c.txt'), false],
    ])
    // Na conversa do solicitante a resolução vem depois dos anexos.
    expect(messages.every(m => m.created_at < t.resolved_at!)).toBe(true)

    expect(NotificationService.create).not.toHaveBeenCalled()
    expect(NotificationService.broadcastQueueAlert).not.toHaveBeenCalled()
    for (const fn of [queueRequesterUpdate, notifyTicketCreated, emitWebhookEvent, runRoutingRules]) expect(fn).not.toHaveBeenCalled()
    expect((await prisma.ticketEvent.findMany({ where: { ticket_id: t.id } })).map(e => e.to_status)).toEqual(['resolved'])

    const shown = await request(app).get(`/api/tickets/${t.id}`).set('Authorization', bearer(ownerId))
    expect(shown.status).toBe(200)
    expect(shown.body.data.attachmentUrl).toBe(file('a.txt'))
    expect(shown.body.data.messages.map((m: { attachmentUrl: string }) => m.attachmentUrl)).toEqual([file('b.txt'), file('c.txt')])
  })

  it('sem extras não cria mensagem', async () => {
    const r = await accept(await interaction(), body({ attachment_url: file('a.txt') }))
    expect(r.status).toBe(201)
    expect(await messagesOf(r.body.data.id)).toEqual([])
  })

  it('recusa esquema perigoso, anexo vazio ou nome inválido sem gastar a sugestão', async () => {
    const id = await interaction()
    for (const bad of [
      [{ name: 'x.txt', url: 'javascript:alert(1)' }],
      [{ name: 'x.txt', url: '' }],
      [{ name: '', url: file('x') }],
      [{ name: 'a\u0000b.txt', url: file('x') }],
    ]) {
      expect((await accept(id, body({ extra_attachments: bad }))).status).toBe(400)
    }
    await untouched(id)
  })

  it('recusa lista acima do limite sem gastar a sugestão', async () => {
    const id = await interaction()
    const names = Array.from({ length: MAX_EXTRA_ATTACHMENTS + 1 }, (_, i) => `${i}.txt`)
    expect((await accept(id, body({ extra_attachments: extras(...names) }))).status).toBe(400)
    await untouched(id)
  })

  it('anexo extra acima de 10 MB devolve 413, não cria chamado e a sugestão continua válida', async () => {
    const id = await interaction()
    const title = `Grande ${SUFFIX}`
    const big = `data:text/plain;base64,${'A'.repeat(15_000_000)}`
    const r = await accept(id, body({ title, extra_attachments: [{ name: 'grande.txt', url: big }] }))
    expect(r.status).toBe(413)
    expect(r.body.code).toBe('ATTACHMENT_TOO_LARGE')
    await untouched(id)
    expect(await prisma.ticket.count({ where: { title } })).toBe(0)
  })
})

describe('fechamento automático do chamado resolvido pela IA', () => {
  it('fecha sem pesquisa, e-mail, webhook, regras nem base de resoluções', async () => {
    const before = await getAutoCloseConfig()
    await upsertAutoCloseConfig({ enabled: true, inactive_days: 30 })
    try {
      const id = await accepted()
      await prisma.$executeRaw`UPDATE tickets SET updated_at = NOW() - INTERVAL '40 days' WHERE id = ${id}`
      vi.clearAllMocks()
      await runAutoCloseJob()
      await settle()
      const t = await ticketOf(id)
      expect(t.status).toBe('closed')
      expect(t.closed_at).toBeInstanceOf(Date)
      expect(await prisma.surveyInstance.findUnique({ where: { ticket_id: id } })).toBeNull()
      expect(await prisma.autoCloseLog.count({ where: { ticket_id: id } })).toBe(1)
      for (const fn of [queueRequesterUpdate, distillTicket, SurveyService.triggerAutoSurvey, SurveyService.getSurveyTokenForTicket]) {
        expect(vi.mocked(fn).mock.calls.filter(c => JSON.stringify(c).includes(id))).toEqual([])
      }
      expect(vi.mocked(emitWebhookEvent).mock.calls.filter(c => JSON.stringify(c[1]).includes(id))).toEqual([])
      expect(vi.mocked(runRoutingRules).mock.calls.filter(c => c[0] === id)).toEqual([])
    } finally {
      await upsertAutoCloseConfig({ enabled: before.enabled, inactive_days: before.inactive_days })
    }
  })
})

describe('pesquisa do chamado resolvido pela IA', () => {
  it('link sob demanda = 409 e nenhuma instância', async () => {
    const id = await accepted()
    const r = await request(app).get(`/api/tickets/${id}/survey-link`).set('Authorization', bearer(ownerId))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('AI_RESOLVED_NO_SURVEY')
    expect(await prisma.surveyInstance.findUnique({ where: { ticket_id: id } })).toBeNull()
  })
})

describe('reabertura do chamado resolvido pela IA', () => {
  const expectInFlow = async (id: string, status: string) => {
    const t = await ticketOf(id)
    expect(t).toMatchObject({ status, ai_resolved: false, queue: queueId })
    expect(t.first_response_deadline!.getTime()).toBeGreaterThan(Date.now())
    expect(t.sla_deadline.getTime()).toBeGreaterThan(Date.now())
    expect(t.first_response_deadline!.getTime()).toBeLessThan(t.sla_deadline.getTime())
    // Fila avisada e o que a abertura deixou para trás.
    expect(NotificationService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: agentId, ticketId: id, type: 'new_ticket' }))
    expect(NotificationService.broadcastQueueAlert).toHaveBeenCalledWith(expect.objectContaining({ queueId, ticketId: id }))
    expect(emitWebhookEvent).toHaveBeenCalledWith('ticket.created', expect.anything())
    expect(runRoutingRules).toHaveBeenCalledWith(id, 'ticket_created')
    expect(triageTicket).toHaveBeenCalledWith(id)
    return t
  }

  it('pelo botão: volta à fila com prazos do plano e depois segue o fluxo normal', async () => {
    const id = await accepted()
    vi.clearAllMocks()
    const r = await request(app).post(`/api/tickets/${id}/reopen`).set('Authorization', bearer(ownerId)).send({ reason: 'A sugestão não resolveu' })
    expect(r.status).toBe(200)
    const t = await expectInFlow(id, 'open')
    expect(t.is_reopened).toBe(true)
    expect(t.resolved_at).toBeNull()
    expect(runRoutingRules).toHaveBeenCalledWith(id, 'ticket_reopened')

    // Daqui em diante é chamado comum: resolver cria a pesquisa.
    await TicketService.updateTicket(id, agentId, 'agent', { assigned_to_id: agentId })
    await TicketService.updateTicket(id, agentId, 'agent', { status: 'resolved', resolution_details: 'Troquei o toner da impressora.' })
    expect(await prisma.surveyInstance.findUnique({ where: { ticket_id: id } })).not.toBeNull()
  })

  it('por mensagem do cliente: entra como aberto, não em atendimento sem responsável', async () => {
    const id = await accepted()
    vi.clearAllMocks()
    await TicketService.addMessage(id, ownerId, 'Continua sem imprimir', 'user')
    const t = await expectInFlow(id, 'open')
    expect(t.resolved_at).toBeNull()
    expect(await prisma.ticketEvent.findFirst({ where: { ticket_id: id, from_status: 'resolved', to_status: 'open' } })).not.toBeNull()
  })

  it('pelo analista: mesma entrada na fila', async () => {
    const id = await accepted()
    vi.clearAllMocks()
    await TicketService.updateTicket(id, agentId, 'agent', { status: 'in_progress', assigned_to_id: agentId })
    await expectInFlow(id, 'in_progress')
  })
})

describe('relatórios', () => {
  it('não conta nas métricas de atendimento por canal', async () => {
    const period = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) }
    const portal = async () => (await getChannelMetrics('admin', adminId, period)).channels.find(m => m.channel === 'portal')?.resolved ?? 0
    const before = await portal()
    await accepted()
    expect(await portal()).toBe(before)
  })
})

describe('POST /api/tickets com aiInteractionId', () => {
  it('liga o chamado aberto após recusar, sem marcar como aceita, e segue o fluxo normal', async () => {
    const id = await interaction()
    const r = await open(body({ aiInteractionId: id }))
    expect(r.status).toBe(201)
    expect(r.body.data).toMatchObject({ status: 'open', queue: queueId })
    expect(await row(id)).toMatchObject({ ticket_id: r.body.data.id, accepted: false })
    expect(triageTicket).toHaveBeenCalledWith(r.body.data.id)
  })

  it('de outro usuário: abre, sem tocar na interação', async () => {
    const id = await interaction({ user_id: otherId })
    expect((await open(body({ aiInteractionId: id }))).status).toBe(201)
    expect((await row(id)).ticket_id).toBeNull()
  })

  it.each([['inexistente', '7f0f2a3c-6a0c-4a43-9e2d-0c5f7b1d1a11'], ['fora do formato', 'lixo'], ['número', 123], ['nulo', null]])(
    '%s: abre normalmente', async (_name, aiInteractionId) => {
      expect((await open(body({ aiInteractionId }))).status).toBe(201)
    })

  it('já ligada a outro chamado: não troca o vínculo', async () => {
    const id = await interaction()
    const first = await open(body({ aiInteractionId: id }))
    expect((await open(body({ aiInteractionId: id }))).status).toBe(201)
    expect((await row(id)).ticket_id).toBe(first.body.data.id)
  })
})
