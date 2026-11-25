import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../../config/prisma'
import { env } from '../../config/env'
import { errorHandler } from '../../middlewares/errorHandler'
import { AiError } from '../core/llm'
import knowledgeRoutes from './routes'

const ai = vi.hoisted(() => ({ configured: true, embed: vi.fn() }))
vi.mock('../core/embeddings', () => ({ embed: ai.embed }))
vi.mock('../core/llm', async importOriginal => ({ ...await importOriginal<object>(), aiConfigured: () => ai.configured }))

const SUFFIX = `kbapi-${Date.now()}`
const BASE = '/api/knowledge'
let orgId: string, adminId: string, managerId: string, agentId: string, endUserId: string, catA: string, catB: string, catOff: string
const articles: string[] = []

const app = express()
app.use(express.json())
app.use(BASE, knowledgeRoutes)
app.use(errorHandler)

const bearer = (id: string, role: string) =>
  `Bearer ${jwt.sign({ sub: id, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`
const asAdmin = () => bearer(adminId, 'admin')

async function draft(body: object = {}) {
  const r = await request(app).post(BASE).set('Authorization', asAdmin())
    .send({ title: `Impressora ${SUFFIX}`, content: 'Reinicie o serviço de impressão.', ...body })
  expect(r.status).toBe(201)
  articles.push(r.body.data.id)
  return r.body.data
}

const expectErrorShape = (body: any, code: string) => {
  expect(body).toMatchObject({ code })
  expect(typeof body.error).toBe('string')
  expect(body.details).toBeTruthy()
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  const user = async (prefix: string, role: 'admin' | 'manager' | 'agent' | 'user') =>
    (await prisma.user.create({ data: { name: `${prefix} ${SUFFIX}`, email: `${prefix}-${SUFFIX}@t.com`, password: 'x', role, org_id: orgId } })).id
  adminId = await user('adm', 'admin')
  managerId = await user('ger', 'manager')
  agentId = await user('ana', 'agent')
  endUserId = await user('usr', 'user')
  catA = (await prisma.category.create({ data: { name: `A ${SUFFIX}` } })).id
  catB = (await prisma.category.create({ data: { name: `B ${SUFFIX}` } })).id
  catOff = (await prisma.category.create({ data: { name: `Off ${SUFFIX}`, active: false } })).id
})

afterAll(async () => {
  await prisma.knowledgeArticle.deleteMany({ where: { id: { in: articles } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [adminId] } } })
  await prisma.category.deleteMany({ where: { id: { in: [catA, catB, catOff] } } })
  await prisma.user.deleteMany({ where: { id: { in: [adminId, managerId, agentId, endUserId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

beforeEach(() => {
  ai.configured = true
  ai.embed.mockReset()
  ai.embed.mockImplementation(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, () => 0.1)))
})

describe('API de artigos', () => {
  it('admin faz o ciclo completo, com auditoria em cada passo', async () => {
    const created = await draft({ categoryIds: [catA] })
    expect(created).toMatchObject({ status: 'draft', published_at: null, created_by_id: adminId, updated_by_id: adminId })
    expect(created.categories.map((c: any) => c.id)).toEqual([catA])
    const url = `${BASE}/${created.id}`

    const got = await request(app).get(url).set('Authorization', asAdmin())
    expect(got.status).toBe(200)
    expect(got.body.data.content).toBe('Reinicie o serviço de impressão.')

    const edited = await request(app).put(url).set('Authorization', asAdmin()).send({ title: `Novo ${SUFFIX}`, categoryIds: [catB] })
    expect(edited.status).toBe(200)
    expect(edited.body.data.title).toBe(`Novo ${SUFFIX}`)
    expect(edited.body.data.content).toBe('Reinicie o serviço de impressão.')
    expect(edited.body.data.categories.map((c: any) => c.id)).toEqual([catB])

    const published = await request(app).post(`${url}/publish`).set('Authorization', asAdmin())
    expect(published.status).toBe(200)
    expect(published.body.data.status).toBe('published')
    expect(published.body.data.published_at).toBeTruthy()

    const unpublished = await request(app).post(`${url}/unpublish`).set('Authorization', asAdmin())
    expect(unpublished.status).toBe(200)
    expect(unpublished.body.data).toMatchObject({ status: 'draft', published_at: null })

    const removed = await request(app).delete(url).set('Authorization', asAdmin())
    expect(removed.status).toBe(204)
    expect((await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: created.id } })).deleted_at).toBeTruthy()
    expect((await request(app).get(url).set('Authorization', asAdmin())).status).toBe(404)

    const logs = await prisma.auditLog.findMany({ where: { user_id: adminId, resource: 'KNOWLEDGE_ARTICLE' }, orderBy: { created_at: 'asc' } })
    const mine = logs.filter(l => (l.details as any).articleId === created.id).map(l => l.action)
    expect(mine).toEqual(['KNOWLEDGE_ARTICLE_CREATE', 'KNOWLEDGE_ARTICLE_UPDATE', 'KNOWLEDGE_ARTICLE_PUBLISH', 'KNOWLEDGE_ARTICLE_UNPUBLISH', 'KNOWLEDGE_ARTICLE_DELETE'])
  })

  it('lista com paginação e filtros por status e categoria, sem excluídos e sem o conteúdo', async () => {
    const onlyMine = async (query: object) => {
      const r = await request(app).get(BASE).set('Authorization', asAdmin()).query({ pageSize: 100, ...query })
      expect(r.status).toBe(200)
      return r
    }
    const catList = (await prisma.category.create({ data: { name: `Lista ${SUFFIX}` } })).id
    const a = await draft({ categoryIds: [catList] })
    const b = await draft({ categoryIds: [catList] })
    const c = await draft({ categoryIds: [catB] })
    const gone = await draft({ categoryIds: [catList] })
    await request(app).post(`${BASE}/${b.id}/publish`).set('Authorization', asAdmin())
    await request(app).delete(`${BASE}/${gone.id}`).set('Authorization', asAdmin())

    const inList = await onlyMine({ categoryId: catList })
    expect(inList.body.data.map((x: any) => x.id).sort()).toEqual([a.id, b.id].sort())
    expect(inList.body.total).toBe(2)
    expect(inList.body.data[0].content).toBeUndefined()
    expect(inList.body.data[0].categories[0].id).toBe(catList)

    const published = await onlyMine({ categoryId: catList, status: 'published' })
    expect(published.body.data.map((x: any) => x.id)).toEqual([b.id])

    const inB = await onlyMine({ categoryId: catB, status: 'draft' })
    expect(inB.body.data.map((x: any) => x.id)).toContain(c.id)

    const page = await request(app).get(BASE).set('Authorization', asAdmin()).query({ categoryId: catList, page: 2, pageSize: 1 })
    expect(page.body).toMatchObject({ total: 2, page: 2, pageSize: 1 })
    expect(page.body.data).toHaveLength(1)

    await prisma.knowledgeArticle.deleteMany({ where: { id: { in: [a.id, b.id, gone.id] } } })
    await prisma.category.delete({ where: { id: catList } })
  })

  it('publicar exige categoria ativa: 422 com error, code e details, também em produção', async () => {
    const none = await draft()
    const off = await draft({ categoryIds: [catOff] })
    for (const a of [none, off]) {
      const r = await request(app).post(`${BASE}/${a.id}/publish`).set('Authorization', asAdmin())
      expect(r.status).toBe(422)
      expectErrorShape(r.body, 'NO_ACTIVE_CATEGORY')
      expect((await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('draft')
    }

    const nodeEnv = env.NODE_ENV
    ;(env as any).NODE_ENV = 'production'
    try {
      const r = await request(app).post(`${BASE}/${none.id}/publish`).set('Authorization', asAdmin())
      expectErrorShape(r.body, 'NO_ACTIVE_CATEGORY')
    } finally {
      ;(env as any).NODE_ENV = nodeEnv
    }
  })

  it('artigo publicado não fica sem categoria ativa pela edição', async () => {
    const a = await draft({ categoryIds: [catA] })
    await request(app).post(`${BASE}/${a.id}/publish`).set('Authorization', asAdmin())
    for (const categoryIds of [[], [catOff]]) {
      const r = await request(app).put(`${BASE}/${a.id}`).set('Authorization', asAdmin()).send({ categoryIds })
      expect(r.status).toBe(422)
      expectErrorShape(r.body, 'NO_ACTIVE_CATEGORY')
    }
    const kept = await request(app).get(`${BASE}/${a.id}`).set('Authorization', asAdmin())
    expect(kept.body.data.categories.map((c: any) => c.id)).toEqual([catA])
  })

  it('publicar duas vezes ou despublicar rascunho dá 409', async () => {
    const a = await draft({ categoryIds: [catA] })
    const notPublished = await request(app).post(`${BASE}/${a.id}/unpublish`).set('Authorization', asAdmin())
    expect(notPublished.status).toBe(409)
    expect(notPublished.body.code).toBe('NOT_PUBLISHED')
    await request(app).post(`${BASE}/${a.id}/publish`).set('Authorization', asAdmin())
    const again = await request(app).post(`${BASE}/${a.id}/publish`).set('Authorization', asAdmin())
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('ALREADY_PUBLISHED')
  })

  it('artigo excluído ou inexistente dá 404 em toda rota', async () => {
    const gone = await draft()
    await request(app).delete(`${BASE}/${gone.id}`).set('Authorization', asAdmin())
    for (const id of [gone.id, 'nao-existe']) {
      const calls = [
        request(app).get(`${BASE}/${id}`),
        request(app).put(`${BASE}/${id}`).send({ title: 'X' }),
        request(app).post(`${BASE}/${id}/publish`),
        request(app).post(`${BASE}/${id}/unpublish`),
        request(app).delete(`${BASE}/${id}`),
      ]
      for (const call of calls) {
        const r = await call.set('Authorization', asAdmin())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('NOT_FOUND')
      }
    }
  })

  it('dado inválido devolve error, code e details', async () => {
    const a = await draft()
    const invalid: Array<[string, string, object]> = [
      ['post', BASE, { title: '', content: 'x' }],
      ['post', BASE, { title: 'Sem conteúdo' }],
      ['post', BASE, { title: 'Só espaço', content: '   ' }],
      ['post', BASE, { title: 'Byte nulo', content: 'a\u0000b' }],
      ['post', BASE, { title: 'x'.repeat(201), content: 'x' }],
      ['post', BASE, { title: 'Categorias', content: 'x', categoryIds: 'nao-e-lista' }],
      ['put', `${BASE}/${a.id}`, {}],
      ['put', `${BASE}/${a.id}`, { content: '' }],
    ]
    for (const [method, url, body] of invalid) {
      const r = await (request(app) as any)[method](url).set('Authorization', asAdmin()).send(body)
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('VALIDATION_ERROR')
      expect(typeof r.body.error).toBe('string')
      expect(r.body.details).toBeDefined()
    }

    const badQuery = await request(app).get(BASE).set('Authorization', asAdmin()).query({ status: 'arquivado' })
    expect(badQuery.status).toBe(400)
    expect(badQuery.body.code).toBe('VALIDATION_ERROR')

    const unknownCategory = await request(app).post(BASE).set('Authorization', asAdmin())
      .send({ title: 'x', content: 'x', categoryIds: ['nao-existe'] })
    expect(unknownCategory.status).toBe(400)
    expectErrorShape(unknownCategory.body, 'INVALID_CATEGORY')
  })

  it('sem IA configurada, publicar devolve erro claro e nada muda', async () => {
    const a = await draft({ categoryIds: [catA] })
    ai.configured = false
    const r = await request(app).post(`${BASE}/${a.id}/publish`).set('Authorization', asAdmin())
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('AI_NOT_CONFIGURED')
    expect(r.body.error).toMatch(/IA não está configurada/)
    expect(ai.embed).not.toHaveBeenCalled()
    expect((await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('draft')
  })

  it('falha do Foundry vira 503 com o code do AiError', async () => {
    const a = await draft({ categoryIds: [catA] })
    ai.embed.mockRejectedValue(new AiError('AI_TIMEOUT', 'LLM timeout'))
    const r = await request(app).post(`${BASE}/${a.id}/publish`).set('Authorization', asAdmin())
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('AI_TIMEOUT')
    expect(typeof r.body.error).toBe('string')
    expect((await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('draft')
    expect(await prisma.knowledgeChunk.count({ where: { article_id: a.id } })).toBe(0)
  })

  it('categoria repetida na lista vale uma vez só', async () => {
    const a = await draft({ categoryIds: [catA, catA] })
    expect(a.categories.map((c: any) => c.id)).toEqual([catA])
  })

  it('só admin: analista, gerente e usuário final recebem 403; sem login, 401', async () => {
    const a = await draft({ categoryIds: [catA] })
    const calls = () => [
      request(app).get(BASE),
      request(app).post(BASE).send({ title: 'x', content: 'x' }),
      request(app).get(`${BASE}/${a.id}`),
      request(app).put(`${BASE}/${a.id}`).send({ title: 'x' }),
      request(app).post(`${BASE}/${a.id}/publish`),
      request(app).post(`${BASE}/${a.id}/unpublish`),
      request(app).delete(`${BASE}/${a.id}`),
    ]
    for (const [id, role] of [[agentId, 'agent'], [managerId, 'manager'], [endUserId, 'user']]) {
      for (const call of calls()) expect((await call.set('Authorization', bearer(id, role))).status).toBe(403)
    }
    for (const call of calls()) expect((await call).status).toBe(401)
    expect(await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'draft', deleted_at: null })
  })
})
