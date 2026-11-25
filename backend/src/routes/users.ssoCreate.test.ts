import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Grava em banco real: rodar só contra o banco descartável (127.0.0.1:5434).
vi.mock('../services/webhookEvents', () => ({ emitWebhookEvent: vi.fn(), buildUserPayload: vi.fn(() => ({})) }))
vi.mock('../services/email/mailer', async (orig) => ({
  ...(await orig<typeof import('../services/email/mailer')>()),
  sendWelcomeEmail: vi.fn(async () => ({ status: 'SUCCESS' })),
}))

import prisma from '../config/prisma'
import { env } from '../config/env'
import router from './users'
import { errorHandler } from '../middlewares/errorHandler'
import { resolveOrCreateSsoUser } from '../controllers/authSso'

const app = express()
app.use(express.json())
app.use('/api/users', router)
app.use(errorHandler)

const tag = `ssocreate-${Date.now()}`
const createdUserIds: string[] = []
const createdOrgIds: string[] = []
let orgIn: string
let manager: string
let agent: string
let admin: string

async function mkUser(role: string, permissions: string[], orgScope: string[]) {
  const u = await prisma.user.create({
    data: {
      name: `${role} ${tag}`, email: `${role}-${Math.random().toString(36).slice(2, 8)}-${tag}@test.local`,
      role: role as any, org_id: orgIn, auth_provider: 'local', active: true, permissions,
      org_scopes: { create: orgScope.map((org_id) => ({ org_id })) },
    },
  })
  createdUserIds.push(u.id)
  return u.id
}

const bearer = (id: string, role: string) =>
  `Bearer ${jwt.sign({ sub: id, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

function ssoBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Cliente SSO',
    email: `cliente-${Math.random().toString(36).slice(2, 8)}-${tag}@cliente.test`,
    authProvider: 'microsoft',
    role: 'user',
    orgId: orgIn,
    ...overrides,
  }
}

async function post(asId: string, role: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/users').set('Authorization', bearer(asId, role)).send(body)
  if (res.body?.data?.id) createdUserIds.push(res.body.data.id)
  return res
}

beforeAll(async () => {
  const a = await prisma.organization.create({ data: { name: `Org In ${tag}`, domains: [], active: true } })
  createdOrgIds.push(a.id)
  orgIn = a.id
  manager = await mkUser('manager', [], [orgIn])
  agent = await mkUser('agent', [], [orgIn])
  admin = await mkUser('admin', [], [])
})

afterAll(async () => {
  // Cleanup restrito ao que este arquivo criou.
  await prisma.auditLog.deleteMany({ where: { user_id: { in: createdUserIds } } })
  await prisma.refreshToken.deleteMany({ where: { user_id: { in: createdUserIds } } })
  await prisma.userOrgScope.deleteMany({ where: { user_id: { in: createdUserIds } } })
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } })
})

// Quem tem acesso à área Usuários cria conta SSO com as mesmas regras da conta local.
describe('POST /api/users — pré-cadastro SSO', () => {
  it('admin cria usuário SSO sem senha e registra auditoria', async () => {
    const res = await post(admin, 'admin', ssoBody())
    expect(res.status).toBe(201)
    const u = await prisma.user.findUnique({ where: { id: res.body.data.id } })
    expect(u?.auth_provider).toBe('microsoft')
    expect(u?.password).toBeNull()
    expect(u?.must_change_password).toBe(false)
  })

  it('Analista com acesso a Usuários cria cliente SSO sem senha', async () => {
    const res = await post(agent, 'agent', ssoBody())
    expect(res.status).toBe(201)
    expect(res.body.data.authProvider).toBe('microsoft')
  })

  it('Gerente cria Analista via SSO (hierarquia normal)', async () => {
    const res = await post(manager, 'manager', ssoBody({ role: 'agent' }))
    expect(res.status).toBe(201)
  })

  it('SSO não fura a hierarquia: Analista não cria Gerente', async () => {
    const res = await post(agent, 'agent', ssoBody({ role: 'manager' }))
    expect(res.status).toBe(403)
  })

  it('usuário pré-cadastrado é encontrado no 1º login SSO (e-mail sem diferenciar maiúsculas)', async () => {
    const email = `precad-${tag}@cliente.test`
    const res = await post(agent, 'agent', ssoBody({ email }))
    expect(res.status).toBe(201)
    const r = await resolveOrCreateSsoUser(email.toUpperCase(), { name: 'Outro Nome' })
    expect(r.outcome).toBe('found')
    expect(r.user?.id).toBe(res.body.data.id)
  })
})
