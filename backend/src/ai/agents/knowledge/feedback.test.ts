import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../../../config/prisma'
import { env } from '../../../config/env'
import { errorHandler } from '../../../middlewares/errorHandler'
import { feedbackRouter } from './routes'

const SUFFIX = `kbfeedback-${Date.now()}`
let ownerId: string, otherId: string

const app = express()
app.use(express.json())
app.use('/api/ai/feedback', feedbackRouter)
app.use(errorHandler)

const bearer = (id: string) => `Bearer ${jwt.sign({ sub: id, role: 'user', orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`
const send = (body: object, id = ownerId) => request(app).post('/api/ai/feedback').set('Authorization', bearer(id)).send(body)
const interaction = async (user_id = ownerId) =>
  (await prisma.aiInteraction.create({ data: { user_id, question: 'Impressora', answer: 'Reinicie o spooler.' } })).id
const feedbackOf = async (id: string) => (await prisma.aiInteraction.findUniqueOrThrow({ where: { id } })).feedback

beforeAll(async () => {
  const user = async (name: string) => (await prisma.user.create({
    data: { name: `${name} ${SUFFIX}`, email: `${name}-${SUFFIX}@t.com`, password: 'x', role: 'user' },
  })).id
  ownerId = await user('dono')
  otherId = await user('outro')
})

afterAll(async () => {
  await prisma.aiInteraction.deleteMany({ where: { user_id: { in: [ownerId, otherId] } } })
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } })
  await prisma.$disconnect()
})

describe('POST /api/ai/feedback', () => {
  it('sem login = 401', async () => {
    expect((await request(app).post('/api/ai/feedback').send({})).status).toBe(401)
  })

  it('grava a avaliação e devolve 200', async () => {
    const id = await interaction()
    const r = await send({ interactionId: id, value: 'useful' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ feedback: 'useful' })
    expect(await feedbackOf(id)).toBe('useful')
  })

  it('segunda avaliação substitui a primeira', async () => {
    const id = await interaction()
    await send({ interactionId: id, value: 'useful' })
    const r = await send({ interactionId: id, value: 'not_useful' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ feedback: 'not_useful' })
    expect(await feedbackOf(id)).toBe('not_useful')
  })

  it('de outro usuário = 404 idêntico ao de inexistente, sem gravar', async () => {
    const id = await interaction()
    const other = await send({ interactionId: id, value: 'not_useful' }, otherId)
    const missing = await send({ interactionId: '7f0f2a3c-6a0c-4a43-9e2d-0c5f7b1d1a11', value: 'not_useful' }, otherId)
    expect(other.status).toBe(404)
    expect(other.body).toEqual(missing.body)
    expect(await feedbackOf(id)).toBeNull()
  })

  it.each([
    ['valor desconhecido', (interactionId: string) => ({ interactionId, value: 'talvez' })],
    ['sem valor', (interactionId: string) => ({ interactionId })],
    ['id fora do formato', () => ({ interactionId: 'lixo', value: 'useful' })],
  ])('%s = 400', async (_name, payload) => {
    const id = await interaction()
    const r = await send(payload(id))
    expect(r.status).toBe(400)
    expect(await feedbackOf(id)).toBeNull()
  })
})
