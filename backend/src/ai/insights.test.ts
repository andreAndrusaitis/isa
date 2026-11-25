import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { errorHandler } from '../middlewares/errorHandler'
import aiRoutes from './routes'
import triageRoutes from './agents/triage/routes'
import insightsRoutes from './insights'

const SUFFIX = `aiins-${Date.now()}`
let orgId: string, catId: string, userId: string, agentId: string, supId: string, mgrId: string, adminId: string
let t1: string, t2: string, runId: string

const app = express()
app.use(express.json())
app.use('/api/ai/tickets', triageRoutes)
app.use('/api/ai/insights', insightsRoutes)
app.use('/api/ai', aiRoutes)
app.use(errorHandler)
const get = (url: string, id: string, role: string) =>
  request(app).get(url).set('Authorization', `Bearer ${jwt.sign({ sub: id, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`)

const mkUser = async (role: string) =>
  (await prisma.user.create({ data: { name: `${role} ${SUFFIX}`, email: `${role}-${SUFFIX}@t.com`, password: 'x', role: role as any, org_id: orgId } })).id

// Janela estreita no passado: só os chamados deste teste caem nela.
const DAY = '2020-03-10'
const at = new Date(`${DAY}T12:00:00Z`)

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  catId = (await prisma.category.create({ data: { name: `Cat ${SUFFIX}` } })).id
  ;[userId, agentId, supId, mgrId, adminId] = [await mkUser('user'), await mkUser('agent'), await mkUser('supervisor'), await mkUser('manager'), await mkUser('admin')]
  await prisma.userOrgScope.create({ data: { user_id: mgrId, org_id: orgId } })
  const base = { title: 'Wi-Fi caiu', user_id: userId, org_id: orgId, sla_deadline: new Date(Date.now() + 864e5), created_at: at }
  // t1: triado e resolvido, IA acertou tipo/categoria e errou a prioridade; atribuído 30 min depois.
  t1 = `AIINS1-${Date.now()}`
  await prisma.ticket.create({ data: { ...base, id: t1, display_number: `INC-${t1}`, status: 'resolved', type: 'incident', priority: 'high', category_id: catId, first_assigned_at: new Date(at.getTime() + 30 * 60_000) } })
  // t2: sem triagem.
  t2 = `AIINS2-${Date.now()}`
  await prisma.ticket.create({ data: { ...base, id: t2, display_number: `INC-${t2}` } })
  runId = (await prisma.aiAgentRun.create({
    data: {
      agent: 'triage', ticket_id: t1, mode: 'apply', model: 'm', prompt_version: 'v', status: 'ok', latency_ms: 1,
      result: {
        questions: [
          { key: 'type', chosen: 'incident', chosenLabel: 'Incidente', confidence: 0.9, wouldApply: true, evidence: 'caiu', evidenceSource: 'texto', evidenceValid: true },
          { key: 'category', chosen: catId, chosenLabel: 'Rede', confidence: 0.9, wouldApply: true, evidence: null, evidenceSource: null, evidenceValid: false },
        ],
        priority: { value: 'low', confidence: 0.8, wouldApply: true },
        justification: 'teste',
        input: { text: 'SEGREDO-DO-CLIENTE', images: 0, userCategory: null },
        applied: [{ field: 'category', label: 'Categoria', from: null, fromLabel: '—', to: catId, toLabel: 'Rede', confidence: 0.9 }],
      },
    },
  })).id
  // O analista trocou a categoria aplicada pela IA.
  await prisma.aiFeedback.create({ data: { run_id: runId, ticket_id: t1, agent: 'triage', field: 'category', ai_value: catId, ai_label: 'Rede', from_value: catId, to_value: null, user_id: agentId } })
})

afterAll(async () => {
  await prisma.aiFeedback.deleteMany({ where: { run_id: runId } })
  await prisma.aiAgentRun.deleteMany({ where: { id: runId } })
  await prisma.ticket.deleteMany({ where: { id: { in: [t1, t2] } } })
  await prisma.userOrgScope.deleteMany({ where: { user_id: mgrId } })
  await prisma.user.deleteMany({ where: { id: { in: [userId, agentId, supId, mgrId, adminId] } } })
  await prisma.category.deleteMany({ where: { id: catId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('GET /api/ai/tickets/:id/triage', () => {
  it('nega usuário final e analista sem acesso ao chamado', async () => {
    expect((await get(`/api/ai/tickets/${t1}/triage`, userId, 'user')).status).toBe(403)
    expect((await get(`/api/ai/tickets/${t1}/triage`, agentId, 'agent')).status).toBe(403)
  })

  it('404 para chamado inexistente', async () => {
    expect((await get('/api/ai/tickets/NAO-EXISTE/triage', adminId, 'admin')).status).toBe(404)
  })

  it('devolve campos, alterações e correções, sem o texto de entrada', async () => {
    const r = await get(`/api/ai/tickets/${t1}/triage`, mgrId, 'manager')
    expect(r.status).toBe(200)
    const d = r.body.data
    expect(d.id).toBe(runId)
    expect(d.fields.map((f: any) => f.label)).toEqual(['Tipo', 'Categoria'])
    expect(d.priority).toEqual({ value: 'low', confidence: 0.8, would_apply: true })
    expect(d.changes).toHaveLength(1)
    expect(d.feedback).toHaveLength(1)
    expect(d.feedback[0]).toMatchObject({ field: 'category', from_value: catId, from_label: `Cat ${SUFFIX}`, to_value: null, to_label: null, user: { id: agentId } })
    expect(JSON.stringify(r.body)).not.toContain('SEGREDO-DO-CLIENTE')
    expect(d).not.toHaveProperty('input')
  })

  it('data null quando não há triagem', async () => {
    const r = await get(`/api/ai/tickets/${t2}/triage`, adminId, 'admin')
    expect(r.status).toBe(200)
    expect(r.body.data).toBeNull()
  })
})

describe('GET /api/ai/insights', () => {
  const url = `/api/ai/insights?from=${DAY}&to=${DAY}&org_id=`

  it('nega usuário final e analista', async () => {
    expect((await get(url + orgId, userId, 'user')).status).toBe(403)
    expect((await get(url + orgId, agentId, 'agent')).status).toBe(403)
  })

  it('admin: contagens, acerto e tempo até a atribuição', async () => {
    const r = await get(url + orgId, adminId, 'admin')
    expect(r.status).toBe(200)
    const d = r.body.data
    expect(d.period).toEqual({ from: DAY, to: DAY })
    expect(d).toMatchObject({ tickets: 2, triaged: 1, automatic: 1, manual: 0, automatic_rate: 1, reclassified: 1, reclassification_rate: 1, empty: false })
    const acc = Object.fromEntries(d.accuracy.map((a: any) => [a.field, a]))
    expect(acc.type).toMatchObject({ total: 1, correct: 1, rate: 1 })
    expect(acc.category).toMatchObject({ total: 1, correct: 1 })
    expect(acc.subcategory).toMatchObject({ total: 0, rate: 0 })
    expect(acc.priority).toMatchObject({ total: 1, correct: 0, rate: 0 })
    expect(d.time_to_assign.triaged).toEqual({ count: 1, median_minutes: 30, p90_minutes: 30 })
    expect(d.time_to_assign.not_triaged.count).toBe(0)
  })

  it('gerente com a empresa na carteira vê os mesmos chamados', async () => {
    const r = await get(url + orgId, mgrId, 'manager')
    expect(r.status).toBe(200)
    expect(r.body.data.tickets).toBe(2)
  })

  it('gerente com org_id fora da carteira não vê nada', async () => {
    const other = (await prisma.organization.create({ data: { name: `Out ${SUFFIX}` } })).id
    try {
      const r = await get(url + other, mgrId, 'manager')
      expect(r.status).toBe(200)
      expect(r.body.data).toMatchObject({ tickets: 0, empty: true })
    } finally { await prisma.organization.deleteMany({ where: { id: other } }) }
  })

  it.each(['2020-13-45', '2020-3-10', 'ontem', '2020-02-30'])('data inválida %s = 400', async bad => {
    const r = await get(`/api/ai/insights?from=${bad}`, adminId, 'admin')
    expect(r.status).toBe(400)
    expect(r.body.error?.code ?? r.body.code).toBe('INVALID_DATE')
  })

  it('período maior que 366 dias = 400', async () => {
    expect((await get('/api/ai/insights?from=2019-01-01&to=2020-03-10', adminId, 'admin')).status).toBe(400)
  })

  it('reclassificação: só conta campo aplicado e revertido', async () => {
    // t2 ganha triagem: tipo aplicado (e revertido), categoria só proposta (e revertida).
    const run = await prisma.aiAgentRun.create({
      data: {
        agent: 'triage', ticket_id: t2, mode: 'apply', model: 'm', prompt_version: 'v', status: 'ok', latency_ms: 1,
        result: { questions: [], applied: [{ field: 'type', label: 'Tipo', to: 'incident', toLabel: 'Incidente', confidence: 0.9 }], proposed: [{ field: 'category', label: 'Categoria', to: catId, toLabel: 'Rede', confidence: 0.9 }] },
      },
    })
    try {
      const count = async () => (await get(url + orgId, adminId, 'admin')).body.data
      expect((await count()).reclassified).toBe(1) // só o t1
      await prisma.aiFeedback.create({ data: { run_id: run.id, ticket_id: t2, agent: 'triage', field: 'category', ai_value: catId, ai_label: 'Rede', from_value: catId, to_value: null, user_id: agentId } })
      expect((await count()).reclassified).toBe(1) // categoria só proposta: não conta
      await prisma.aiFeedback.create({ data: { run_id: run.id, ticket_id: t2, agent: 'triage', field: 'type', ai_value: 'incident', ai_label: 'Incidente', from_value: 'incident', to_value: 'request', user_id: agentId } })
      expect((await count()).reclassified).toBe(2)
    } finally {
      await prisma.aiFeedback.deleteMany({ where: { run_id: run.id } })
      await prisma.aiAgentRun.deleteMany({ where: { id: run.id } })
    }
  })

  it('supervisor sem carteira não vê nada', async () => {
    const r = await get(`/api/ai/insights?from=${DAY}&to=${DAY}`, supId, 'supervisor')
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ tickets: 0, triaged: 0, automatic_rate: 0, empty: true })
  })
})

describe('GET /api/ai/feedback', () => {
  it('só admin', async () => {
    expect((await get('/api/ai/feedback', mgrId, 'manager')).status).toBe(403)
  })

  it('admin lista as correções com nomes resolvidos', async () => {
    const r = await get('/api/ai/feedback?field=category&days=365&limit=200', adminId, 'admin')
    expect(r.status).toBe(200)
    expect(r.body).toHaveProperty('next_cursor')
    const row = r.body.data.find((x: any) => x.run_id === runId)
    // days=365 não alcança o chamado de 2020, mas a correção foi criada agora
    expect(row).toMatchObject({ field: 'category', from_label: `Cat ${SUFFIX}`, to_label: null, user: { id: agentId }, ticket: { id: t1, display_number: `INC-${t1}` } })
  })
})
