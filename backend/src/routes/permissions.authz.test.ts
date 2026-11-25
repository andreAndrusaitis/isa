import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-with-at-least-32-chars',
  },
}))

vi.mock('../config/prisma', () => ({ default: prismaMock }))

import { authenticate, authorizeArea } from '../middlewares/auth'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use(authenticate)

// Test endpoints protected by authorizeArea
app.get('/api/test-webhooks', authorizeArea('webhooks'), (_req, res) => {
  res.json({ ok: true, area: 'webhooks' })
})

app.get('/api/test-sla', authorizeArea('sla'), (_req, res) => {
  res.json({ ok: true, area: 'sla' })
})

app.get('/api/test-categories', authorizeArea('categories'), (_req, res) => {
  res.json({ ok: true, area: 'categories' })
})

app.get('/api/test-api-keys', authorizeArea('webhooks', 'admin'), (_req, res) => {
  res.json({ ok: true, area: 'webhooks' })
})

app.post('/api/test-orgs', authorizeArea('orgs', 'admin', 'supervisor'), (_req, res) => {
  res.json({ ok: true, area: 'orgs' })
})

app.post('/api/test-users', authorizeArea('users', 'admin'), (_req, res) => {
  res.json({ ok: true, area: 'users' })
})

app.use(errorHandler)

function issueToken(role: string, permissions: string[] = []) {
  return jwt.sign(
    { sub: 'test-user-id', role, orgId: 'test-org-id', permissions },
    env.JWT_SECRET,
    { algorithm: 'HS256' }
  )
}

function bearer(role: string, permissions: string[] = []) {
  return `Bearer ${issueToken(role, permissions)}`
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Granular Area Permissions and authorizeArea Middleware', () => {
  it('allows admin full access to any area without explicit permissions', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'admin',
      permissions: [],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-webhooks')
      .set('Authorization', bearer('admin'))

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('blocks agent from accessing webhooks by default when permission is not granted', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: [],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-webhooks')
      .set('Authorization', bearer('agent'))

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
    expect(res.body.error).toMatch(/exige a permissão/)
  })

  it('allows agent to access webhooks when "webhooks" permission is explicitly granted in database', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['webhooks'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-webhooks')
      .set('Authorization', bearer('agent', ['webhooks']))

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.area).toBe('webhooks')
  })

  it('allows manager to access SLA when "sla" permission is explicitly granted', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'manager',
      permissions: ['sla'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-sla')
      .set('Authorization', bearer('manager', ['sla']))

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.area).toBe('sla')
  })

  it('blocks manager from accessing SLA when permission is not granted and not in default manager roles', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'manager',
      permissions: ['dash_main'], // explicit permissions without 'sla'
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-sla')
      .set('Authorization', bearer('manager', ['dash_main']))

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
    expect(res.body.error).toMatch(/exige a permissão/)
  })

  it('padrão do perfil NÃO libera área sozinho: só concessão explícita (senão analista criaria/excluiria empresa)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'supervisor',
      permissions: [],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-categories')
      .set('Authorization', bearer('supervisor'))

    expect(res.status).toBe(403)
  })

  it('blocks end-user ("user" role) even if permissions array had values', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'user',
      permissions: ['webhooks'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-webhooks')
      .set('Authorization', bearer('user', ['webhooks']))

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
    expect(res.body.error).toMatch(/exige a permissão/)
  })

  it('allows agent with "webhooks" permission to access api-keys endpoint (needed for webhooks panel)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['webhooks'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-api-keys')
      .set('Authorization', bearer('agent', ['webhooks']))

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('blocks agent without "webhooks" permission from api-keys endpoint', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['orgs'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .get('/api/test-api-keys')
      .set('Authorization', bearer('agent', ['orgs']))

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
  })

  it('allows agent with "orgs" permission to create organizations', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['orgs'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .post('/api/test-orgs')
      .set('Authorization', bearer('agent', ['orgs']))
      .send({ name: 'Nova Organização' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.area).toBe('orgs')
  })

  it('blocks agent without "orgs" permission from creating organizations', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['webhooks'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .post('/api/test-orgs')
      .set('Authorization', bearer('agent', ['webhooks']))
      .send({ name: 'Nova Organização' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
  })

  it('allows agent with "users" permission to create users', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['users'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .post('/api/test-users')
      .set('Authorization', bearer('agent', ['users']))
      .send({ name: 'Novo Usuário' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.area).toBe('users')
  })

  it('blocks agent without "users" permission from creating users', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['webhooks'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const res = await request(app)
      .post('/api/test-users')
      .set('Authorization', bearer('agent', ['webhooks']))
      .send({ name: 'Novo Usuário' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
  })
})
