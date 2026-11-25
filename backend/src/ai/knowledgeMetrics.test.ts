import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../services/email/ticketCreatedNotice', () => ({ notifyTicketCreated: vi.fn(async () => {}) }))
vi.mock('../services/email/ticketUpdateDigest', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/email/ticketUpdateDigest')>(), queueRequesterUpdate: vi.fn(),
}))
vi.mock('../services/webhookEvents', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/webhookEvents')>(), emitWebhookEvent: vi.fn(),
}))
vi.mock('../services/routing', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/routing')>(), runRoutingRules: vi.fn(async () => {}),
}))
vi.mock('./agents/triage/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('./agents/triage/agent')>(), triageTicket: vi.fn(async () => {}),
}))
vi.mock('./agents/intake/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('./agents/intake/agent')>(), intakeTicket: vi.fn(async () => {}),
}))
vi.mock('./agents/guidance/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('./agents/guidance/agent')>(), guidanceTicket: vi.fn(async () => {}),
}))
vi.mock('./agents/resolution/distill', async (importOriginal) => ({
  ...await importOriginal<typeof import('./agents/resolution/distill')>(), distillTicket: vi.fn(async () => {}),
}))

import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { errorHandler } from '../middlewares/errorHandler'
import { getOverview } from '../services/dashboard'
import { TicketService } from '../services/tickets'
import insightsRoutes from './insights'

const SUFFIX = `kbmet-${Date.now()}`
const app = express()
app.use(express.json())
app.use('/api/ai/insights', insightsRoutes)
app.use(errorHandler)

let inScope: string, outOfScope: string, requester: string, outRequester: string, manager: string, supervisor: string, agent: string, admin: string
let articleA: string, articleB: string
const tickets: string[] = []
const interactions: string[] = []

// Dias de São Paulo num passado que nenhum outro teste usa.
const D1 = '2021-05-10', D2 = '2021-05-11', D3 = '2021-05-12'
const noon = (day: string) => new Date(`${day}T15:00:00Z`)
const window3 = `from=${D1}&to=${D3}`

const get = (id: string, role: string, q = window3) =>
  request(app).get(`/api/ai/insights/knowledge?${q}`).set('Authorization', `Bearer ${jwt.sign({ sub: id, role, orgId: inScope, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`)

let seq = 0
async function ticket(org: string, status: 'open' | 'in_progress' | 'resolved' | 'closed', ai: boolean, day = D1, extra: object = {}) {
  const id = `${SUFFIX}-${++seq}`
  await prisma.ticket.create({
    data: {
      id, display_number: `INC-${id}`, title: 'Cenário', description: 'd', status, ai_resolved: ai, created_at: noon(day), org_id: org,
      user_id: org === inScope ? requester : outRequester, sla_deadline: new Date(Date.now() + 864e5),
      resolved_at: ['resolved', 'closed'].includes(status) ? new Date() : null, ...extra,
    },
  })
  tickets.push(id)
  return id
}

async function interaction(org: string, data: { answer?: string; feedback?: 'useful' | 'not_useful'; sources?: object[]; day?: string }) {
  const { id } = await prisma.aiInteraction.create({
    data: {
      question: 'Pergunta', org_id: org, user_id: org === inScope ? requester : outRequester, created_at: noon(data.day ?? D1),
      answer: data.answer ?? null, feedback: data.feedback ?? null, sources: data.sources ?? [],
    },
  })
  interactions.push(id)
}

beforeAll(async () => {
  inScope = (await prisma.organization.create({ data: { name: `Dentro ${SUFFIX}` } })).id
  outOfScope = (await prisma.organization.create({ data: { name: `Fora ${SUFFIX}` } })).id
  const mk = async (role: 'user' | 'manager' | 'supervisor' | 'agent' | 'admin', org: string, tag = role) =>
    (await prisma.user.create({ data: { name: `${tag} ${SUFFIX}`, email: `${tag}-${SUFFIX}@t.com`, password: 'x', role, org_id: org } })).id
  requester = await mk('user', inScope)
  outRequester = await mk('user', outOfScope, 'user' + 'fora' as any)
  manager = await mk('manager', inScope)
  supervisor = await mk('supervisor', inScope)
  agent = await mk('agent', inScope)
  admin = await mk('admin', inScope)
  await prisma.userOrgScope.create({ data: { user_id: manager, org_id: inScope } })

  const article = (title: string) => prisma.knowledgeArticle.create({ data: { title, content: 'c', created_by_id: admin, updated_by_id: admin } })
  articleA = (await article(`Reset de senha ${SUFFIX}`)).id
  articleB = (await article(`Manual da VPN ${SUFFIX}`)).id

  // Empresa da carteira: 2 da IA (um já fechado) e 3 da equipe.
  await ticket(inScope, 'resolved', true, D1)
  await ticket(inScope, 'closed', true, D2)
  await ticket(inScope, 'open', false, D1)
  await ticket(inScope, 'resolved', false, D2)
  await ticket(inScope, 'closed', false, D3)
  // Nada disto conta: excluído e fora do período.
  await ticket(inScope, 'resolved', true, D2, { deleted_at: new Date() })
  await ticket(inScope, 'resolved', true, '2021-05-20')
  // Empresa fora da carteira.
  await ticket(outOfScope, 'resolved', true, D1)
  await ticket(outOfScope, 'open', false, D1)

  const a = { articleId: articleA, title: 'Título antigo' }, b = { articleId: articleB, title: 'Manual da VPN' }
  await interaction(inScope, { answer: 'r', feedback: 'useful', sources: [a], day: D1 })
  await interaction(inScope, { answer: 'r', feedback: 'useful', sources: [a, b], day: D1 })
  await interaction(inScope, { answer: 'r', feedback: 'not_useful', sources: [a], day: D3 })
  await interaction(inScope, { answer: 'r', day: D3 })
  await interaction(inScope, { day: D3 })
  await interaction(inScope, { answer: 'r', feedback: 'useful', day: '2021-05-20' })
  await interaction(outOfScope, { answer: 'r', feedback: 'not_useful', sources: [{ articleId: 'artigo-de-fora', title: `Segredo ${SUFFIX}` }], day: D1 })
})

afterAll(async () => {
  await prisma.aiInteraction.deleteMany({ where: { id: { in: interactions } } })
  await prisma.knowledgeArticle.deleteMany({ where: { id: { in: [articleA, articleB] } } })
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: tickets } } })
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: tickets } } })
  await prisma.ticket.deleteMany({ where: { id: { in: tickets } } })
  await prisma.userOrgScope.deleteMany({ where: { user_id: { in: [manager, agent] } } })
  await prisma.user.deleteMany({ where: { id: { in: [requester, outRequester, manager, supervisor, agent, admin] } } })
  await prisma.organization.deleteMany({ where: { id: { in: [inScope, outOfScope] } } })
  await prisma.$disconnect()
})

describe('GET /api/ai/insights/knowledge', () => {
  it('só gerente e admin', async () => {
    expect((await get(requester, 'user')).status).toBe(403)
    expect((await get(agent, 'agent')).status).toBe(403)
    expect((await get(supervisor, 'supervisor')).status).toBe(403)
    expect((await request(app).get('/api/ai/insights/knowledge')).status).toBe(401)
  })

  it('gerente: cada número bate com a contagem manual do cenário, só da carteira', async () => {
    const r = await get(manager, 'manager')
    expect(r.status).toBe(200)
    const d = r.body.data
    expect(d.period).toEqual({ from: D1, to: D3 })
    // 2 ÷ (2 + 3)
    expect(d.resolution).toEqual({ ai_resolved: 2, team_opened: 3, rate: 0.4, target: 0.35 })
    // 2 úteis ÷ 3 avaliadas; a sem avaliação não pesa.
    expect(d.feedback.useful).toBe(2)
    expect(d.feedback.not_useful).toBe(1)
    expect(d.feedback.rate).toBeCloseTo(2 / 3)
    expect(d.interactions).toEqual({
      total: 5, answered: 4, bucket: 'day',
      series: [{ date: D1, count: 2 }, { date: D2, count: 0 }, { date: D3, count: 3 }],
    })
    expect(d.top_articles).toEqual([
      { article_id: articleA, title: `Reset de senha ${SUFFIX}`, uses: 3 },
      { article_id: articleB, title: `Manual da VPN ${SUFFIX}`, uses: 1 },
    ])
    expect(d.empty).toBe(false)
  })

  it('gerente não vê a empresa fora da carteira, nem pedindo por ela', async () => {
    const all = await get(manager, 'manager')
    expect(JSON.stringify(all.body)).not.toContain('Segredo')
    const r = await get(manager, 'manager', `${window3}&org_id=${outOfScope}`)
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({
      resolution: { ai_resolved: 0, team_opened: 0, rate: null }, feedback: { useful: 0, not_useful: 0, rate: null },
      interactions: { total: 0, answered: 0 }, top_articles: [], empty: true,
    })
  })

  it('gerente sem carteira não vê nada', async () => {
    await prisma.userOrgScope.deleteMany({ where: { user_id: manager } })
    try {
      expect((await get(manager, 'manager')).body.data).toMatchObject({ resolution: { ai_resolved: 0, team_opened: 0 }, interactions: { total: 0 }, empty: true })
    } finally {
      await prisma.userOrgScope.create({ data: { user_id: manager, org_id: inScope } })
    }
  })

  it('admin soma as duas empresas e filtra por uma', async () => {
    const all = (await get(admin, 'admin')).body.data
    expect(all.resolution).toMatchObject({ ai_resolved: 3, team_opened: 4 })
    expect(all.resolution.rate).toBeCloseTo(3 / 7)
    expect(all.interactions.total).toBe(6)
    expect(all.top_articles).toHaveLength(3)
    const one = (await get(admin, 'admin', `${window3}&org_id=${outOfScope}`)).body.data
    expect(one.resolution).toMatchObject({ ai_resolved: 1, team_opened: 1, rate: 0.5 })
    expect(one.top_articles).toEqual([{ article_id: 'artigo-de-fora', title: `Segredo ${SUFFIX}`, uses: 1 }])
  })

  it('o período selecionado muda os números, e janela longa agrupa por mês', async () => {
    const d = (await get(manager, 'manager', `from=${D3}&to=${D3}`)).body.data
    expect(d.resolution).toMatchObject({ ai_resolved: 0, team_opened: 1, rate: 0 })
    expect(d.interactions.total).toBe(3)
    const long = (await get(manager, 'manager', 'from=2021-01-01&to=2021-06-30')).body.data
    expect(long.interactions.bucket).toBe('month')
    expect(long.interactions.series).toHaveLength(6)
    expect(long.interactions.series.find((p: any) => p.date === '2021-05').count).toBe(6)
  })

  it('data inválida = 400', async () => {
    expect((await get(admin, 'admin', 'from=2021-13-45')).status).toBe(400)
  })
})

describe('Visão geral: total separado', () => {
  const overview = (who = manager, role = 'manager', orgId?: string) => getOverview(role, who, { period: 'month', orgId })
  const manual = { open: 1, in_progress: 0, pending: 0, resolved: 1, ai_resolved: 3, closed: 1 }

  it('"Resolvidos" conta só a equipe e "Resolvidos pela IA" tem número próprio, inclusive os já fechados', async () => {
    // Na Visão geral não há recorte de datas: entra também o de fora da janela acima.
    const { counts } = await overview()
    expect(counts).toEqual(manual)
    expect(Object.keys(counts)).toEqual(['open', 'in_progress', 'pending', 'resolved', 'ai_resolved', 'closed'])
  })

  it('a soma dos cards é o total de chamados, sem contar nada duas vezes', async () => {
    const { counts } = await overview()
    const total = await prisma.ticket.count({ where: { org_id: inScope, deleted_at: null } })
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(total)
  })

  it('gerente não vê a empresa fora da carteira', async () => {
    const { counts } = await overview(manager, 'manager', outOfScope)
    expect(Object.values(counts).every(n => n === 0)).toBe(true)
    const admins = (await overview(admin, 'admin', outOfScope)).counts
    expect(admins).toMatchObject({ open: 1, ai_resolved: 1, resolved: 0 })
  })

  it('série temporal separa a equipe da IA e o detalhe do ponto lista os dois', async () => {
    const id = await ticket(inScope, 'resolved', true, new Date().toISOString().slice(0, 10))
    const human = await ticket(inScope, 'open', false, new Date().toISOString().slice(0, 10))
    try {
      const { timeSeries } = await getOverview('manager', manager, { period: 'day' })
      const today = timeSeries.at(-1)!
      expect(today).toMatchObject({ count: 1, aiResolved: 1 })
      expect(today.tickets.map(t => t.id).sort()).toEqual([id, human].sort())
    } finally {
      await prisma.ticket.deleteMany({ where: { id: { in: [id, human] } } })
    }
  })

  it('reaberto perde a marca e, resolvido por analista, volta a contar como da equipe', async () => {
    const id = await ticket(inScope, 'resolved', true, D2)
    const before = (await overview()).counts
    expect(before).toMatchObject({ resolved: manual.resolved, ai_resolved: manual.ai_resolved + 1 })

    await TicketService.reopenTicket(id, requester, 'A sugestão não resolveu')
    const reopened = await prisma.ticket.findUniqueOrThrow({ where: { id } })
    expect(reopened).toMatchObject({ ai_resolved: false, status: 'open' })
    expect((await overview()).counts).toMatchObject({ open: manual.open + 1, resolved: manual.resolved, ai_resolved: manual.ai_resolved })

    // Analista da carteira e da fila em que o chamado entrou: só ele pode assumir.
    await prisma.userOrgScope.create({ data: { user_id: agent, org_id: inScope } })
    await prisma.user.update({ where: { id: agent }, data: { queues: [reopened.queue!] } })
    await TicketService.updateTicket(id, agent, 'agent', { assigned_to_id: agent })
    await TicketService.updateTicket(id, agent, 'agent', { status: 'resolved', resolution_details: 'Analista trocou o toner da impressora.' })
    expect((await overview()).counts).toMatchObject({ open: manual.open, resolved: manual.resolved + 1, ai_resolved: manual.ai_resolved })

    const metrics = (await get(manager, 'manager')).body.data
    expect(metrics.resolution).toMatchObject({ ai_resolved: 2, team_opened: 4 })

    await prisma.ticketEvent.deleteMany({ where: { ticket_id: id } })
    await prisma.ticketMessage.deleteMany({ where: { ticket_id: id } })
    await prisma.ticket.deleteMany({ where: { id } })
  })
})
