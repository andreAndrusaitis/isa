import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { errorHandler } from '../middlewares/errorHandler'
import aiRoutes, { getStatus, listRuns, listChanges, getMetrics, PRICE_PER_M } from './routes'

// Agente com chave única: as métricas filtram só as linhas deste teste, mesmo com outras suítes no banco.
const SUFFIX = `aiadm-${Date.now()}`
const AGENT = `test-${SUFFIX}`
// Segundo agente só com execuções que alteram campos (não mexe nas contagens do primeiro).
const AGENT_CHG = `test-chg-${SUFFIX}`
let orgId: string, adminId: string, agentUserId: string, ticketId: string

const result = (applyType: boolean, conf: number) => ({
  questions: [
    { key: 'type', chosenLabel: 'Incidente', confidence: conf, margin: 0.5, wouldApply: applyType },
    { key: 'category', chosenLabel: 'Rede', confidence: 0.5, margin: 0.1, wouldApply: false },
  ],
  priority: { value: 'low', confidence: 0.9, wouldApply: true },
  justification: 'teste',
})

const app = express()
app.use(express.json())
app.use('/api/ai', aiRoutes)
app.use(errorHandler)
const bearer = (id: string, role: string) =>
  `Bearer ${jwt.sign({ sub: id, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  adminId = (await prisma.user.create({ data: { name: `Adm ${SUFFIX}`, email: `adm-${SUFFIX}@t.com`, password: 'x', role: 'admin', org_id: orgId } })).id
  agentUserId = (await prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId } })).id
  ticketId = `AIADM-${Date.now()}`
  await prisma.ticket.create({
    data: {
      id: ticketId, title: 'Wi-Fi caiu', user_id: agentUserId, org_id: orgId,
      display_number: `INC-AIADM${Date.now()}`, sla_deadline: new Date(Date.now() + 864e5),
    },
  })
  const base = { agent: AGENT, mode: 'shadow', model: 'gpt-4.1-mini', prompt_version: 'v1' }
  const t0 = Date.now() - 60_000
  await prisma.aiAgentRun.createMany({
    data: [
      { ...base, ticket_id: ticketId, status: 'ok', latency_ms: 100, input_tokens: 1000, output_tokens: 100, result: result(true, 0.95), created_at: new Date(t0) },
      { ...base, ticket_id: ticketId, status: 'ok', latency_ms: 300, input_tokens: 1000, output_tokens: 100, result: result(false, 0.6), created_at: new Date(t0 + 1000) },
      { ...base, ticket_id: null, status: 'error', error: 'LLM 503', latency_ms: 9000, created_at: new Date(t0 + 2000) },
      // fora da janela de 7 dias
      { ...base, ticket_id: null, status: 'ok', latency_ms: 50, created_at: new Date(Date.now() - 10 * 864e5) },
    ],
  })
  const chg = (field: string, label: string, fromLabel: string, toLabel: string, confidence: number) =>
    ({ field, label, from: 'x', fromLabel, to: 'y', toLabel, confidence })
  const typeChg = (n: number) => chg('type', 'Tipo', `Incidente (INC-${n})`, `Requisição (REQ-${n})`, 0.95)
  const prioChg = (conf: number) => chg('priority', 'Prioridade', 'Média', 'Alta', conf)
  const cbase = { ...base, agent: AGENT_CHG, ticket_id: ticketId, status: 'ok', latency_ms: 100 }
  await prisma.aiAgentRun.createMany({
    data: [
      { ...cbase, mode: 'apply', result: { ...result(true, 0.95), applied: [typeChg(1), prioChg(0.94)] }, created_at: new Date(t0) },
      { ...cbase, mode: 'shadow', result: { ...result(true, 0.95), proposed: [prioChg(0.85)] }, created_at: new Date(t0 + 1000) },
      // execução antiga: sem applied/proposed
      { ...cbase, mode: 'shadow', result: result(true, 0.95), created_at: new Date(t0 + 2000) },
      { ...cbase, mode: 'apply', result: { ...result(true, 0.95), applied: [typeChg(2)] }, created_at: new Date(t0 + 3000) },
      { ...cbase, mode: 'apply', status: 'error', error: 'falhou', result: { applied: [typeChg(3)] }, created_at: new Date(t0 + 4000) },
    ],
  })
})

afterAll(async () => {
  await prisma.aiAgentRun.deleteMany({ where: { agent: { in: [AGENT, AGENT_CHG] } } })
  await prisma.ticket.deleteMany({ where: { id: ticketId } })
  await prisma.user.deleteMany({ where: { id: { in: [adminId, agentUserId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('Motor IA — serviço', () => {
  it('status lista os agentes do registry com modo e contagens', async () => {
    const s = await getStatus()
    expect(s.model).toBe(env.AZURE_AI_DEPLOYMENT)
    const triage = s.agents.find(a => a.key === 'triage')!
    expect(triage).toMatchObject({ name: 'Triagem de chamados', mode: env.AI_TRIAGE_MODE })
    expect(typeof triage.runs_24h).toBe('number')
  })

  it('runs pagina por cursor (mais recente primeiro) e traz o chamado', async () => {
    const p1 = await listRuns({ agent: AGENT, limit: 2 })
    expect(p1.data.map(r => r.status)).toEqual(['error', 'ok'])
    expect(p1.data[1].ticket).toMatchObject({ id: ticketId, title: 'Wi-Fi caiu' })
    expect(p1.next_cursor).toBe(p1.data[1].id)
    const p2 = await listRuns({ agent: AGENT, limit: 2, cursor: p1.next_cursor! })
    expect(p2.data).toHaveLength(2)
    expect(p2.next_cursor).toBeNull()
    const errs = await listRuns({ agent: AGENT, status: 'error' })
    expect(errs.data).toHaveLength(1)
  })

  it('metrics agrega execuções, erros, latência, custo e % aplicaria por campo', async () => {
    const m = await getMetrics({ agent: AGENT, days: 7 })
    expect(m).toMatchObject({ runs: 3, errors: 1, latency_p50_ms: 200, input_tokens: 2000, output_tokens: 200 })
    expect(m.error_rate).toBeCloseTo(1 / 3)
    expect(m.latency_p95_ms).toBe(290)
    expect(m.cost_usd).toBeCloseTo((2000 * PRICE_PER_M.input + 200 * PRICE_PER_M.output) / 1e6)
    const byKey = Object.fromEntries(m.fields.map(f => [f.key, f]))
    expect(byKey.type).toMatchObject({ total: 2, would_apply: 1, would_apply_rate: 0.5 })
    expect(byKey.type.avg_confidence).toBeCloseTo(0.775)
    expect(byKey.category).toMatchObject({ total: 2, would_apply: 0 })
    expect(byKey.priority).toMatchObject({ total: 2, would_apply: 2, would_apply_rate: 1 })
  })
})

describe('Motor IA — alterações', () => {
  it('changes achata applied/proposed, do mais recente, com o chamado, e pagina por cursor', async () => {
    const all = await listChanges({ agent: AGENT_CHG })
    expect(all.data.map(c => `${c.kind}:${c.field}`)).toEqual(['applied:type', 'proposed:priority', 'applied:priority', 'applied:type'])
    expect(all.data[0]).toMatchObject({
      agent: AGENT_CHG, mode: 'apply', field: 'type', label: 'Tipo',
      from_label: 'Incidente (INC-2)', to_label: 'Requisição (REQ-2)', confidence: 0.95,
      ticket: { id: ticketId, title: 'Wi-Fi caiu' },
    })
    expect(all.next_cursor).toBeNull()
    const p1 = await listChanges({ agent: AGENT_CHG, limit: 2 })
    expect(p1.next_cursor).toBeTruthy()
    const p2 = await listChanges({ agent: AGENT_CHG, limit: 2, cursor: p1.next_cursor! })
    expect([...p1.data, ...p2.data]).toEqual(all.data)
    expect(p2.next_cursor).toBeNull()
  })

  it('changes filtra por campo, tipo e período; cursor inválido é 400', async () => {
    expect((await listChanges({ agent: AGENT_CHG, field: 'type' })).data).toHaveLength(2)
    expect((await listChanges({ agent: AGENT_CHG, kind: 'proposed' })).data.map(c => c.field)).toEqual(['priority'])
    expect((await listChanges({ agent: AGENT_CHG, days: 1 })).data).toHaveLength(4)
    await expect(listChanges({ cursor: 'lixo' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('metrics conta alterações por campo e as transições mais comuns (sem o número do chamado)', async () => {
    const m = await getMetrics({ agent: AGENT_CHG, days: 7 })
    expect(m.changes.by_field).toEqual([
      { field: 'priority', label: 'Prioridade', applied: 1, proposed: 1 },
      { field: 'type', label: 'Tipo', applied: 2, proposed: 0 },
    ])
    expect(m.changes.top_transitions).toEqual([
      { field: 'priority', label: 'Prioridade', from_label: 'Média', to_label: 'Alta', applied: 1, proposed: 1, total: 2 },
      { field: 'type', label: 'Tipo', from_label: 'Incidente', to_label: 'Requisição', applied: 2, proposed: 0, total: 2 },
    ])
  })

  it('runs traz as alterações achatadas de cada execução (antiga = [])', async () => {
    const { data } = await listRuns({ agent: AGENT_CHG, status: 'ok' })
    expect(data[0].changes).toEqual([{ kind: 'applied', field: 'type', label: 'Tipo', from: 'x', from_label: 'Incidente (INC-2)', to: 'y', to_label: 'Requisição (REQ-2)', confidence: 0.95, rule: null, reason: null }])
    expect(data[0].apply_error).toBeNull()
    expect(data[1].changes).toEqual([])
    expect(data[3].changes.map(c => c.field)).toEqual(['type', 'priority'])
  })
})

describe('Motor IA — rotas', () => {
  it('nega quem não é admin', async () => {
    const res = await request(app).get('/api/ai/status').set('Authorization', bearer(agentUserId, 'agent'))
    expect(res.status).toBe(403)
  })

  it('admin lê status, runs e metrics no envelope { data }', async () => {
    const auth = bearer(adminId, 'admin')
    const status = await request(app).get('/api/ai/status').set('Authorization', auth)
    expect(status.status).toBe(200)
    expect(status.body.data.agents[0].key).toBe('triage')
    const runs = await request(app).get('/api/ai/runs').query({ agent: AGENT, limit: 1 }).set('Authorization', auth)
    expect(runs.body.data).toHaveLength(1)
    expect(runs.body.next_cursor).toBeTruthy()
    const metrics = await request(app).get('/api/ai/metrics').query({ agent: AGENT, days: 30 }).set('Authorization', auth)
    expect(metrics.body.data).toMatchObject({ runs: 4, days: 30 })
    const changes = await request(app).get('/api/ai/changes').query({ agent: AGENT_CHG, kind: 'applied', limit: 2 }).set('Authorization', auth)
    expect(changes.status).toBe(200)
    expect(changes.body.data).toHaveLength(2)
    expect(changes.body.data[0]).toMatchObject({ kind: 'applied', field: 'type', to_label: 'Requisição (REQ-2)' })
    expect(changes.body.next_cursor).toBeTruthy()
    const bad = await request(app).get('/api/ai/changes').query({ cursor: 'x' }).set('Authorization', auth)
    expect(bad.status).toBe(400)
  })
})

describe('Motor IA — ligar e desligar agentes', () => {
  // Restaura a escolha do admin para o intake (só essa linha) ao final.
  let saved: { agent: string; mode: string; config: any } | null = null
  beforeAll(async () => {
    const row = await prisma.aiAgentSetting.findUnique({ where: { agent: 'intake' } })
    saved = row ? { agent: row.agent, mode: row.mode, config: row.config ?? undefined } : null
  })
  afterAll(async () => {
    if (saved) await prisma.aiAgentSetting.upsert({ where: { agent: 'intake' }, create: saved, update: { mode: saved.mode, config: saved.config } })
    else await prisma.aiAgentSetting.deleteMany({ where: { agent: 'intake' } })
    await prisma.auditLog.deleteMany({ where: { user_id: adminId, action: { in: ['UPDATE_AI_AGENT_MODE', 'UPDATE_AI_AGENT_CONFIG'] } } })
  })

  it('admin troca o modo de um agente e o status reflete na hora, com auditoria', async () => {
    const auth = bearer(adminId, 'admin')
    const put = await request(app).put('/api/ai/agents/intake/mode').set('Authorization', auth).send({ mode: 'shadow' })
    expect(put.status).toBe(200)
    expect(put.body.data).toEqual({ key: 'intake', mode: 'shadow' })
    const status = await request(app).get('/api/ai/status').set('Authorization', auth)
    expect(status.body.data.agents.find((a: any) => a.key === 'intake').mode).toBe('shadow')
    await request(app).put('/api/ai/agents/intake/mode').set('Authorization', auth).send({ mode: 'off' })
    const off = await request(app).get('/api/ai/status').set('Authorization', auth)
    expect(off.body.data.agents.find((a: any) => a.key === 'intake')).toMatchObject({ mode: 'off', active: false })
    await vi.waitFor(async () => {
      const log = await prisma.auditLog.findFirst({ where: { user_id: adminId, action: 'UPDATE_AI_AGENT_MODE' }, orderBy: { created_at: 'desc' } })
      expect(log?.details).toMatchObject({ agent: 'intake', from: 'shadow', to: 'off' })
    })
  })

  it('valida o modo e o agente', async () => {
    const auth = bearer(adminId, 'admin')
    expect((await request(app).put('/api/ai/agents/intake/mode').set('Authorization', auth).send({ mode: 'ligado' })).status).toBe(400)
    expect((await request(app).put('/api/ai/agents/nao-existe/mode').set('Authorization', auth).send({ mode: 'off' })).status).toBe(404)
  })

  it('status traz a declaração das configurações e os valores; admin altera com validação e auditoria', async () => {
    const auth = bearer(adminId, 'admin')
    const status = await request(app).get('/api/ai/status').set('Authorization', auth)
    const intake = status.body.data.agents.find((a: any) => a.key === 'intake')
    expect(intake.settings.map((f: any) => f.key)).toEqual(['rigor', 'maxAsks', 'personalize'])
    expect(intake.settings[0]).not.toHaveProperty('default')
    const knowledge = status.body.data.agents.find((a: any) => a.key === 'knowledge')
    expect(knowledge).toMatchObject({ mode: 'off', active: false, config: { rigor: 'balanced', pilotOrgIds: [], pilotCategoryIds: [] } })
    expect(knowledge.settings.find((f: any) => f.key === 'pilotOrgIds').options).toContainEqual({ value: orgId, label: `Org ${SUFFIX}` })
    expect(intake.config).toHaveProperty('maxAsks')
    const put = await request(app).put('/api/ai/agents/intake/config').set('Authorization', auth).send({ config: { maxAsks: 2, rigor: 'conservative' } })
    expect(put.status).toBe(200)
    expect(put.body.data.config).toMatchObject({ maxAsks: 2, rigor: 'conservative' })
    const again = await request(app).get('/api/ai/status').set('Authorization', auth)
    expect(again.body.data.agents.find((a: any) => a.key === 'intake').config).toMatchObject({ maxAsks: 2, rigor: 'conservative' })
    await vi.waitFor(async () => {
      const log = await prisma.auditLog.findFirst({ where: { user_id: adminId, action: 'UPDATE_AI_AGENT_CONFIG' }, orderBy: { created_at: 'desc' } })
      expect(log?.details).toMatchObject({ agent: 'intake', changes: { maxAsks: 2, rigor: 'conservative' } })
    })
    expect((await request(app).put('/api/ai/agents/intake/config').set('Authorization', auth).send({ config: { maxAsks: 7 } })).status).toBe(400)
    expect((await request(app).put('/api/ai/agents/intake/config').set('Authorization', auth).send({ config: { inventado: 1 } })).status).toBe(400)
    expect((await request(app).put('/api/ai/agents/nao-existe/config').set('Authorization', auth).send({ config: {} })).status).toBe(404)
    expect((await request(app).put('/api/ai/agents/intake/config').set('Authorization', bearer(agentUserId, 'agent')).send({ config: { maxAsks: 1 } })).status).toBe(403)
  })

  it('piloto do agente knowledge: id que não existe é recusado, o que existe é gravado', async () => {
    const auth = bearer(adminId, 'admin')
    const send = (config: object) => request(app).put('/api/ai/agents/knowledge/config').set('Authorization', auth).send({ config })
    try {
      expect((await send({ pilotOrgIds: ['nao-existe'] })).status).toBe(400)
      const ok = await send({ pilotOrgIds: [orgId] })
      expect(ok.status).toBe(200)
      expect(ok.body.data.config).toMatchObject({ pilotOrgIds: [orgId], pilotCategoryIds: [] })
    } finally {
      await prisma.aiAgentSetting.deleteMany({ where: { agent: 'knowledge' } })
    }
  })

  it('só admin troca o modo', async () => {
    const r = await request(app).put('/api/ai/agents/intake/mode').set('Authorization', bearer(agentUserId, 'agent')).send({ mode: 'apply' })
    expect(r.status).toBe(403)
  })
})
