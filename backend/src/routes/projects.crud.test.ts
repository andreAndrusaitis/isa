import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn(async () => []) }, // findMany: equipe do gerente (vazia)
  project: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  projectMember: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
  projectStatus: { createMany: vi.fn() },
  taskType: { createMany: vi.fn() },
  $transaction: vi.fn(async (fn: any) => fn(prismaMock)),
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
import { getEffectiveModules } from '../services/moduleAccess'

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
})

describe('POST /api/projects', () => {
  it('creates a project and makes the creator its owner', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    prismaMock.project.create.mockResolvedValue({ id: 'proj-1', name: 'Projeto X', owner_id: 'user-1' })
    prismaMock.projectMember.create.mockResolvedValue({ id: 'pm-1', project_id: 'proj-1', user_id: 'user-1', role: 'owner' })
    prismaMock.projectStatus.createMany.mockResolvedValue({ count: 3 })

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', bearer('manager', 'user-1'))
      .send({ name: 'Projeto X' })

    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Projeto X')
    expect(prismaMock.projectMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'owner', user_id: 'user-1' }) })
    )
  })

  it('rejects creation when the projects module is off', async () => {
    vi.mocked(getEffectiveModules).mockResolvedValueOnce({ tickets: true, projects: false, documents: false })
    prismaMock.user.findUnique.mockResolvedValue({ role: 'agent', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    const res = await request(app).post('/api/projects').set('Authorization', bearer('agent')).send({ name: 'X' })
    expect(res.status).toBe(403)
  })

  it('rejects an empty name with 400', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    const res = await request(app).post('/api/projects').set('Authorization', bearer('manager')).send({ name: '' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/projects/:projectId', () => {
  it('returns 404 for a non-member (private project not leaked)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    prismaMock.projectMember.findUnique.mockResolvedValue(null)
    const res = await request(app).get('/api/projects/proj-1').set('Authorization', bearer('manager'))
    expect(res.status).toBe(404)
  })

  it('returns the project for a member', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', name: 'Projeto X', members: [] })
    const res = await request(app).get('/api/projects/proj-1').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe('proj-1')
  })
})
