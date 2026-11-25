import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  template: { create: vi.fn(), findMany: vi.fn() },
}))

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' },
}))
// Acesso ao módulo tem teste próprio (projects.authz.test): aqui o usuário já tem o módulo.
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))
vi.mock('../middlewares/projectScope', () => ({ scopeParamsToProject: () => {}, assertRefsInProject: async () => {} })) // IDOR tem teste próprio (projects.idor.test)
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import templatesRoutes from './templates'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'
import { getEffectiveModules } from '../services/moduleAccess'

const app = express()
app.use(express.json())
app.use('/api/templates', templatesRoutes)
app.use(errorHandler)

function bearer(role: string, sub = 'user-1') {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
})

describe('templates routes', () => {
  it('creates a project template', async () => {
    prismaMock.template.create.mockResolvedValue({ id: 'tpl-1', scope: 'project', name: 'Sprint padrão' })
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', bearer('manager'))
      .send({ scope: 'project', name: 'Sprint padrão', structure: { statuses: [] } })
    expect(res.status).toBe(201)
  })

  it('lists templates filtered by scope', async () => {
    prismaMock.template.findMany.mockResolvedValue([{ id: 'tpl-1', scope: 'task', name: 'Bug padrão' }])
    const res = await request(app).get('/api/templates?scope=task').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('rejects creation when the projects module is off', async () => {
    vi.mocked(getEffectiveModules).mockResolvedValueOnce({ tickets: true, projects: false, documents: false })
    prismaMock.user.findUnique.mockResolvedValue({ role: 'agent', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', bearer('agent'))
      .send({ scope: 'project', name: 'X', structure: {} })
    expect(res.status).toBe(403)
  })
})
