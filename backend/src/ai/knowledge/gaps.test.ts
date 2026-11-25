import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../../config/prisma'
import { env } from '../../config/env'
import { errorHandler } from '../../middlewares/errorHandler'
import { suggest } from '../agents/knowledge/agent'
import type { EmbedFn } from '../core/embeddings'
import { clearGapsCache, knowledgeGaps, MAX_GAP_INTERACTIONS, type KnowledgeGaps } from './gaps'
import knowledgeRoutes from './routes'

const ai = vi.hoisted(() => ({ configured: false }))
vi.mock('../core/llm', async importOriginal => ({ ...await importOriginal<object>(), aiConfigured: () => ai.configured }))
vi.mock('../agents/registry', async importOriginal => ({
  ...await importOriginal<object>(),
  agentRuntime: async () => ({ mode: 'apply', config: { rigor: 'balanced', pilotOrgIds: [], pilotCategoryIds: [] } }),
}))

const SUFFIX = `kbgaps-${Date.now()}`
const app = express()
app.use(express.json())
app.use('/api/knowledge', knowledgeRoutes)
app.use(errorHandler)

let orgId: string, userId: string, adminId: string, managerId: string
const bearer = (id: string, role: string) =>
  `Bearer ${jwt.sign({ sub: id, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

const created: string[] = []
const runs: string[] = []
const DAY = 864e5

/** Interação como o agente grava: a execução ok carrega o id; falha do provedor não deixa execução ligada. */
async function ask(question: string, extra: { answer?: string; feedback?: 'useful' | 'not_useful'; run?: 'ok' | 'none'; ago?: number } = {}) {
  const { id } = await prisma.aiInteraction.create({
    data: {
      question, user_id: userId, org_id: orgId, answer: extra.answer ?? null, feedback: extra.feedback ?? null,
      created_at: new Date(Date.now() - (extra.ago ?? 0)),
    },
  })
  created.push(id)
  if ((extra.run ?? 'ok') === 'ok') {
    runs.push((await prisma.aiAgentRun.create({
      data: { agent: 'knowledge', mode: 'apply', model: 'm', prompt_version: 'v', status: 'ok', latency_ms: 1, result: { outcome: 'no_match', interactionId: id } },
    })).id)
  }
  return id
}

// Vetores 2D: mesmo assunto = mesma direção. Similaridade acima de 1 impede qualquer junção.
const embedBy = (rule: (text: string) => number[]) => vi.fn<EmbedFn>(async texts => texts.map(rule))
const NEVER_MERGE = 1.1
const mine = (r: KnowledgeGaps) => r.gaps.filter(g => g.example.includes(SUFFIX))

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  const mk = async (role: 'user' | 'admin' | 'manager') =>
    (await prisma.user.create({ data: { name: `Pessoa Sigilosa ${role} ${SUFFIX}`, email: `${role}-${SUFFIX}@t.com`, password: 'x', role, org_id: orgId } })).id
  ;[userId, adminId, managerId] = [await mk('user'), await mk('admin'), await mk('manager')]
})

beforeEach(async () => {
  clearGapsCache()
  ai.configured = false
  await prisma.aiAgentRun.deleteMany({ where: { id: { in: runs.splice(0) } } })
  await prisma.aiInteraction.deleteMany({ where: { id: { in: created.splice(0) } } })
})

afterAll(async () => {
  await prisma.aiAgentRun.deleteMany({ where: { id: { in: runs } } })
  await prisma.aiInteraction.deleteMany({ where: { id: { in: created } } })
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminId, managerId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('quais interações contam como lacuna', () => {
  it('sem resposta e resposta não útil entram; resposta útil, sem avaliação e falha do provedor, não', async () => {
    await ask(`Sem resposta ${SUFFIX}`)
    await ask(`Respondida e reprovada ${SUFFIX}`, { answer: 'Tente reiniciar', feedback: 'not_useful' })
    await ask(`Respondida e aprovada ${SUFFIX}`, { answer: 'Tente reiniciar', feedback: 'useful' })
    await ask(`Respondida sem avaliação ${SUFFIX}`, { answer: 'Tente reiniciar' })
    await ask(`Provedor fora do ar ${SUFFIX}`, { run: 'none' })

    const r = await knowledgeGaps(30, { embed: embedBy(() => [1, 0]), similarity: NEVER_MERGE })
    expect(mine(r).map(g => g.example).sort()).toEqual([`Respondida e reprovada ${SUFFIX}`, `Sem resposta ${SUFFIX}`])
  })

  it('resposta reprovada conta mesmo sem execução ligada', async () => {
    await ask(`Reprovada sem execução ${SUFFIX}`, { answer: 'Tente reiniciar', feedback: 'not_useful', run: 'none' })
    expect(mine(await knowledgeGaps(30))).toHaveLength(1)
  })

  it('respeita a janela em dias', async () => {
    await ask(`Recente ${SUFFIX}`, { ago: 2 * DAY })
    await ask(`Antiga ${SUFFIX}`, { ago: 10 * DAY })
    expect(mine(await knowledgeGaps(7)).map(g => g.example)).toEqual([`Recente ${SUFFIX}`])
    expect(mine(await knowledgeGaps(30))).toHaveLength(2)
  })

  it('analisa só as mais recentes até o limite e avisa que cortou', async () => {
    expect(MAX_GAP_INTERACTIONS).toBeGreaterThan(0)
    for (let i = 0; i < 4; i++) await ask(`Pergunta ${i} ${SUFFIX}`, { ago: (4 - i) * 1000 })
    const r = await knowledgeGaps(30, { limit: 2 })
    expect(r).toMatchObject({ analyzed: 2, truncated: true })
    expect(mine(r).map(g => g.example).sort()).toEqual([`Pergunta 2 ${SUFFIX}`, `Pergunta 3 ${SUFFIX}`])
  })
})

describe('com o agente de verdade', () => {
  it('pergunta sem artigo vira lacuna; falha do provedor grava a interação, mas não vira', async () => {
    ai.configured = true
    const since = new Date()
    await suggest({ title: `Sem artigo ${SUFFIX}`, description: '' }, userId, { chat: vi.fn(), embed: embedBy(() => [1, 0]) })
    // Orçamento zerado: a busca desiste antes de tudo, como num provedor fora do ar.
    await suggest({ title: `Provedor caiu ${SUFFIX}`, description: '' }, userId, { chat: vi.fn(), embed: embedBy(() => [1, 0]), budgetMs: 0 })

    const saved = await prisma.aiInteraction.findMany({ where: { user_id: userId, created_at: { gte: since } }, select: { id: true } })
    created.push(...saved.map(i => i.id))
    expect(saved).toHaveLength(2)
    const made = await prisma.aiAgentRun.findMany({
      where: { agent: 'knowledge', created_at: { gte: since }, OR: saved.map(i => ({ result: { path: ['interactionId'], equals: i.id } })) }, select: { id: true },
    })
    runs.push(...made.map(r => r.id))
    await prisma.aiAgentRun.deleteMany({ where: { agent: 'knowledge', status: 'error', created_at: { gte: since }, error: { contains: 'orçamento de 0 ms' } } })

    expect(mine(await knowledgeGaps(30, { embed: embedBy(() => [1, 0]), similarity: NEVER_MERGE })).map(g => g.example)).toEqual([expect.stringContaining('Sem artigo')])
  })
})

describe('agrupamento', () => {
  it('junta assuntos parecidos pelo cosseno, ordena por frequência e guarda a última ocorrência', async () => {
    await ask(`Impressora não imprime ${SUFFIX}`, { ago: 3 * DAY })
    await ask(`A impressora parou ${SUFFIX}`, { ago: 2 * DAY })
    await ask(`Impressora offline ${SUFFIX}`, { ago: DAY })
    await ask(`VPN caiu ${SUFFIX}`, { ago: DAY / 2 })
    await ask(`VPN sem conexão ${SUFFIX}`, { ago: DAY / 4 })
    await ask(`Trocar monitor ${SUFFIX}`, { ago: DAY / 8 })
    const embed = embedBy(t => (/impressora/i.test(t) ? [1, 0] : /vpn/i.test(t) ? [0, 1] : [0.7, -0.7]))

    const r = await knowledgeGaps(30, { embed })
    expect(r.grouped_by).toBe('subject')
    expect(mine(r).map(g => g.count)).toEqual([3, 2, 1])
    const [top, second] = mine(r)
    expect(top.example).toMatch(/impressora/i)
    expect(second.example).toMatch(/VPN/)
    expect(Math.abs(top.last_at.getTime() - (Date.now() - DAY))).toBeLessThan(60_000)
  })

  it('manda as perguntas em lote, sem repetir texto igual', async () => {
    await ask(`Senha expirou ${SUFFIX}`)
    await ask(`  SENHA   expirou ${SUFFIX}!`)
    await ask(`Tela azul ${SUFFIX}`)
    const embed = embedBy(() => [1, 0])
    await knowledgeGaps(30, { embed, similarity: NEVER_MERGE })
    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed.mock.calls[0][0].filter(t => t.includes(SUFFIX))).toHaveLength(2)
  })

  it('devolve no máximo dez assuntos', async () => {
    for (let i = 0; i < 12; i++) await ask(`Assunto número ${'x'.repeat(i + 1)} ${SUFFIX}`)
    const r = await knowledgeGaps(30, { embed: embedBy(() => [1, 0]), similarity: NEVER_MERGE })
    expect(r.gaps).toHaveLength(10)
  })

  it('sem IA configurada agrupa por texto normalizado, ignorando caixa, acento e pontuação', async () => {
    await ask(`Não consigo acessar ${SUFFIX}`)
    await ask(`nao consigo ACESSAR, ${SUFFIX}!`)
    await ask(`VPN caiu ${SUFFIX}`)
    const r = await knowledgeGaps(30)
    expect(r.grouped_by).toBe('text')
    expect(mine(r).map(g => g.count)).toEqual([2, 1])
  })

  it('embedding falhou: cai para o texto normalizado sem erro', async () => {
    await ask(`Mesma pergunta ${SUFFIX}`)
    await ask(`mesma pergunta ${SUFFIX}`)
    const r = await knowledgeGaps(30, { embed: vi.fn<EmbedFn>(async () => { throw new Error('LLM 500') }) })
    expect(r.grouped_by).toBe('text')
    expect(mine(r)).toMatchObject([{ count: 2 }])
  })

  it('título sugerido é a primeira linha da pergunta, cortada no limite do artigo', async () => {
    await ask(`${'T'.repeat(250)} ${SUFFIX}\nDescrição longa`)
    await ask(`Primeira linha ${SUFFIX}\nSegunda linha`)
    const r = mine(await knowledgeGaps(30))
    expect(r.find(g => g.example.startsWith('Primeira'))!.title).toBe(`Primeira linha ${SUFFIX}`)
    expect(r.find(g => g.example.startsWith('TTT'))!.title).toHaveLength(200)
  })
})

describe('cache curto', () => {
  it('agrupamento por texto, plano B de uma falha, não fica guardado', async () => {
    clearGapsCache()
    await ask(`Sem cache ${SUFFIX}`)
    const embed = vi.fn(async () => { throw new Error('Foundry fora') })
    await knowledgeGaps(30, { embed })
    await new Promise(resolve => setTimeout(resolve))
    await knowledgeGaps(30, { embed })
    expect(embed).toHaveBeenCalledTimes(2)
    clearGapsCache()
  })

  it('não recalcula nem chama embedding de novo para a mesma janela', async () => {
    await ask(`Com cache ${SUFFIX}`)
    const embed = embedBy(() => [1, 0])
    await knowledgeGaps(30, { embed })
    await knowledgeGaps(30, { embed })
    expect(embed).toHaveBeenCalledTimes(1)
    await knowledgeGaps(7, { embed })
    expect(embed).toHaveBeenCalledTimes(2)
  })
})

describe('GET /api/knowledge/gaps', () => {
  const get = (id: string, role: string, q = '') => request(app).get(`/api/knowledge/gaps${q}`).set('Authorization', bearer(id, role))

  it('só admin', async () => {
    expect((await get(managerId, 'manager')).status).toBe(403)
    expect((await get(userId, 'user')).status).toBe(403)
    expect((await request(app).get('/api/knowledge/gaps')).status).toBe(401)
  })

  it('devolve exemplo, quantidade e última ocorrência, sem nada de quem perguntou', async () => {
    await ask(`Pergunta anônima ${SUFFIX}`)
    const r = await get(adminId, 'admin', '?days=30')
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ days: 30, grouped_by: 'text', truncated: false })
    const gap = r.body.data.gaps.find((g: any) => g.example.includes(SUFFIX))
    expect(Object.keys(gap).sort()).toEqual(['count', 'example', 'last_at', 'title'])
    const raw = JSON.stringify(r.body)
    for (const leak of [userId, orgId, 'Pessoa Sigilosa', `user-${SUFFIX}@t.com`]) expect(raw).not.toContain(leak)
  })

  it('days padrão é 30; fora de 1 a 365 é recusado', async () => {
    expect((await get(adminId, 'admin')).body.data.days).toBe(30)
    expect((await get(adminId, 'admin', '?days=0')).status).toBe(400)
    expect((await get(adminId, 'admin', '?days=366')).status).toBe(400)
  })
})
