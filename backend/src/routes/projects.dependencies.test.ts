import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn() },
  taskDependency: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  // createDependency confere o projeto das duas tasks e checa ciclo (CTE) numa transação.
  task: { findUnique: vi.fn(async () => ({ project_id: 'proj-1', archived_at: null })) },
  $executeRaw: vi.fn(async () => 0),
  $queryRaw: vi.fn(async () => []),
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
  prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
  prismaMock.taskDependency.findMany.mockResolvedValue([])
})

describe('task dependencies routes', () => {
  it('creates a dependency', async () => {
    prismaMock.taskDependency.create.mockResolvedValue({ id: 'dep-1', task_id: 'task-A', depends_on_id: 'task-B' })
    const res = await request(app)
      .post('/api/projects/proj-1/tasks/task-A/dependencies')
      .set('Authorization', bearer('manager'))
      .send({ dependsOnId: 'task-B' })
    expect(res.status).toBe(201)
  })

  it('lists dependencies', async () => {
    const res = await request(app)
      .get('/api/projects/proj-1/tasks/task-A/dependencies')
      .set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ blockedBy: [], blocking: [] })
  })
})
