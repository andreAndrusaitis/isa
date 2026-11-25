import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn(), count: vi.fn(async () => 1) }, // count: destinatário de send_notification é membro
  automation: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  automationRun: { findMany: vi.fn() },
}))

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' },
}))
// Acesso ao módulo tem teste próprio (projects.authz.test): aqui o usuário já tem o módulo.
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))
vi.mock('../middlewares/projectScope', () => ({ scopeParamsToProject: () => {}, assertRefsInProject: async () => {} })) // IDOR tem teste próprio (projects.idor.test)
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import projectsRoutes from './projects'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/projects', projectsRoutes)
app.use(errorHandler)

function bearer(role: string, sub = 'user-1') {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
  prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
})

describe('automation rules routes', () => {
  it('creates an automation with valid trigger/actions', async () => {
    prismaMock.automation.create.mockResolvedValue({ id: 'auto-1', name: 'Auto', trigger: 'status_changed', actions: [] })
    const res = await request(app)
      .post('/api/projects/proj-1/automations')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Auto', trigger: 'status_changed', actions: [{ type: 'send_notification', userId: 'user-2', message: 'oi' }] })
    expect(res.status).toBe(201)
  })

  it('lists automations for a project', async () => {
    prismaMock.automation.findMany.mockResolvedValue([{ id: 'auto-1', name: 'Auto' }])
    const res = await request(app).get('/api/projects/proj-1/automations').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('toggles is_active via PATCH', async () => {
    prismaMock.automation.update.mockResolvedValue({ id: 'auto-1', is_active: false })
    const res = await request(app)
      .patch('/api/projects/proj-1/automations/auto-1')
      .set('Authorization', bearer('manager'))
      .send({ isActive: false })
    expect(res.status).toBe(200)
    expect(res.body.data.isActive).toBe(false)
  })

  it('lists runs for an automation', async () => {
    prismaMock.automationRun.findMany.mockResolvedValue([{ id: 'run-1', status: 'success' }])
    const res = await request(app).get('/api/projects/proj-1/automations/auto-1/runs').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('rejects automation creation for a member (only owner/manager)', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
    const res = await request(app)
      .post('/api/projects/proj-1/automations')
      .set('Authorization', bearer('manager'))
      .send({ name: 'X', trigger: 'status_changed', actions: [] })
    expect(res.status).toBe(403)
  })
})
