import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(async () => []) }, // findMany: equipe do gerente (vazia)
  task: { findMany: vi.fn() },
}))

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' },
}))
// Acesso ao módulo tem teste próprio (projects.authz.test): aqui o usuário já tem o módulo.
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))
vi.mock('../middlewares/projectScope', () => ({ scopeParamsToProject: () => {}, assertRefsInProject: async () => {} })) // IDOR tem teste próprio (projects.idor.test)
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import myTasksRoutes from './myTasks'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'
import { getEffectiveModules } from '../services/moduleAccess'

const app = express()
app.use(express.json())
app.use('/api/my-tasks', myTasksRoutes)
app.use(errorHandler)

function bearer(role: string, sub = 'user-1') {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/my-tasks', () => {
  it('returns 403 when the projects module is off', async () => {
    vi.mocked(getEffectiveModules).mockResolvedValueOnce({ tickets: true, projects: false, documents: false })
    prismaMock.user.findUnique.mockResolvedValue({ role: 'agent', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    const res = await request(app).get('/api/my-tasks').set('Authorization', bearer('agent'))
    expect(res.status).toBe(403)
  })

  it('returns tasks assigned to the current user across projects', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    prismaMock.task.findMany.mockResolvedValue([{ id: 'task-1', title: 'Minha Task' }])
    const res = await request(app).get('/api/my-tasks').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })
})

describe('GET /api/my-tasks/columns', () => {
  it('returns null when the user never customized columns', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null, my_tasks_columns: null })
    const res = await request(app).get('/api/my-tasks/columns').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toBeNull()
  })

  it('returns the saved column preference', async () => {
    const saved = [{ key: 'title', visible: true }]
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null, my_tasks_columns: saved })
    const res = await request(app).get('/api/my-tasks/columns').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(saved)
  })
})

describe('PUT /api/my-tasks/columns', () => {
  it('validates and saves the column preference', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    prismaMock.user.update.mockResolvedValue({})
    const columns = [{ key: 'title', visible: true }, { key: 'tags', visible: false }]
    const res = await request(app).put('/api/my-tasks/columns').set('Authorization', bearer('manager')).send({ columns })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(columns)
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { my_tasks_columns: columns } })
  })

  it('rejects malformed column payloads', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    const res = await request(app).put('/api/my-tasks/columns').set('Authorization', bearer('manager')).send({ columns: [{ key: 'title' }] })
    expect(res.status).toBe(400)
  })
})
