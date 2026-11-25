import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn(async () => []) }, // findMany: equipe do gerente (vazia)
  task: { findMany: vi.fn() },
  project: { findMany: vi.fn() },
}))

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' },
}))
// Acesso ao módulo tem teste próprio (projects.authz.test): aqui o usuário já tem o módulo.
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))
vi.mock('../middlewares/projectScope', () => ({ scopeParamsToProject: () => {}, assertRefsInProject: async () => {} })) // IDOR tem teste próprio (projects.idor.test)
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import projectsTeamRoutes from './projectsTeam'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/projects', projectsTeamRoutes)
app.use(errorHandler)

function bearer(role: string, sub = 'user-1') {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
})

describe('GET /api/projects/search', () => {
  it('searches tasks and projects scoped to the user membership', async () => {
    prismaMock.task.findMany.mockResolvedValue([{ id: 'task-1', title: 'Corrigir bug de login' }])
    prismaMock.project.findMany.mockResolvedValue([])

    const res = await request(app).get('/api/projects/search?q=login').set('Authorization', bearer('manager'))

    expect(res.status).toBe(200)
    expect(res.body.data.tasks).toHaveLength(1)
    // Confirma que o filtro de membership foi aplicado na query, não pós-filtrado
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project: expect.objectContaining({ members: expect.objectContaining({ some: { user_id: 'user-1' } }) }),
        }),
      })
    )
  })
})
