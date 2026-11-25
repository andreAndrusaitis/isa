import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn() },
  document: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  taskDocument: { create: vi.fn() },
}))

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' },
}))
// Acesso ao módulo tem teste próprio (projects.authz.test): aqui o usuário já tem o módulo.
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))
vi.mock('../middlewares/projectScope', () => ({ scopeParamsToProject: () => {}, assertRefsInProject: async () => {} })) // IDOR tem teste próprio (projects.idor.test)
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import documentsRoutes from './documents'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/projects/:projectId/docs', documentsRoutes)
app.use(errorHandler)

function bearer(role: string, sub = 'user-1') {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
  prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
  prismaMock.document.count.mockResolvedValue(0)
})

describe('documents routes', () => {
  it('creates a document with blocks content', async () => {
    prismaMock.document.create.mockResolvedValue({ id: 'doc-1', title: 'Runbook', content: [{ type: 'heading', text: 'Runbook' }] })
    const res = await request(app)
      .post('/api/projects/proj-1/docs')
      .set('Authorization', bearer('manager'))
      .send({ title: 'Runbook', content: [{ type: 'heading', text: 'Runbook' }] })
    expect(res.status).toBe(201)
  })

  it('lists documents for a project', async () => {
    prismaMock.document.findMany.mockResolvedValue([{ id: 'doc-1', title: 'Runbook' }])
    const res = await request(app).get('/api/projects/proj-1/docs').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('updates a document and stamps updated_by', async () => {
    prismaMock.document.update.mockResolvedValue({ id: 'doc-1', title: 'Runbook v2' })
    const res = await request(app)
      .patch('/api/projects/proj-1/docs/doc-1')
      .set('Authorization', bearer('manager'))
      .send({ title: 'Runbook v2' })
    expect(res.status).toBe(200)
    expect(prismaMock.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ updated_by: 'user-1' }) })
    )
  })

  it('rejects document creation for a viewer', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'viewer' })
    const res = await request(app)
      .post('/api/projects/proj-1/docs')
      .set('Authorization', bearer('manager'))
      .send({ title: 'X', content: [] })
    expect(res.status).toBe(403)
  })
})
