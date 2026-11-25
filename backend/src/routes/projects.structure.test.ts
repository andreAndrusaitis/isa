import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn() },
  projectFolder: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  projectList: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  projectStatus: {
    create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    count: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(),
  },
  task: { findMany: vi.fn(), update: vi.fn() },
  taskActivity: { create: vi.fn() },
  $transaction: vi.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prismaMock))),
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
  prismaMock.projectFolder.count.mockResolvedValue(0)
  prismaMock.projectList.count.mockResolvedValue(0)
  prismaMock.projectStatus.count.mockResolvedValue(0)
})

describe('project structure (folders/lists/statuses)', () => {
  it('creates a list when the member role is manager', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
    prismaMock.projectList.create.mockResolvedValue({ id: 'list-1', name: 'Sprint 1' })
    const res = await request(app)
      .post('/api/projects/proj-1/lists')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Sprint 1' })
    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Sprint 1')
  })

  it('rejects list creation for a viewer', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'viewer' })
    const res = await request(app)
      .post('/api/projects/proj-1/lists')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Sprint 1' })
    expect(res.status).toBe(403)
  })

  it('creates a status with a valid category', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'owner' })
    prismaMock.projectStatus.findMany.mockResolvedValue([])
    prismaMock.projectStatus.create.mockResolvedValue({ id: 'status-1', name: 'QA', category: 'in_review' })
    const res = await request(app)
      .post('/api/projects/proj-1/statuses')
      .set('Authorization', bearer('manager'))
      .send({ name: 'QA', color: '#ff0000', category: 'in_review' })
    expect(res.status).toBe(201)
  })

  it('cria um status com wipLimit e retorna camelizado', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'owner' })
    prismaMock.projectStatus.findMany.mockResolvedValue([])
    prismaMock.projectStatus.create.mockResolvedValue({
      id: 'st-1', project_id: 'proj-1', name: 'Em Progresso', color: '#3b82f6',
      category: 'in_progress', position: 0, is_active: true, requires_approval: false, wip_limit: 3,
    })
    const res = await request(app)
      .post('/api/projects/proj-1/statuses')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Em Progresso', color: '#3b82f6', category: 'in_progress', wipLimit: 3 })
    expect(res.status).toBe(201)
    expect(res.body.data.wipLimit).toBe(3)
    expect(prismaMock.projectStatus.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ wip_limit: 3 }) }),
    )
  })

  it('atualiza wipLimit para null (remove o limite)', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
    prismaMock.projectStatus.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.projectStatus.findUniqueOrThrow.mockResolvedValue({
      id: 'st-1', project_id: 'proj-1', name: 'Em Progresso', color: '#3b82f6',
      category: 'in_progress', position: 0, is_active: true, requires_approval: false, wip_limit: null,
    })
    const res = await request(app)
      .patch('/api/projects/proj-1/statuses/st-1')
      .set('Authorization', bearer('manager'))
      .send({ wipLimit: null })
    expect(res.status).toBe(200)
    expect(res.body.data.wipLimit).toBeNull()
    expect(prismaMock.projectStatus.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ wip_limit: null }) }),
    )
  })

  it('rejects a status with an invalid category', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'owner' })
    const res = await request(app)
      .post('/api/projects/proj-1/statuses')
      .set('Authorization', bearer('manager'))
      .send({ name: 'QA', color: '#ff0000', category: 'not-a-real-category' })
    expect(res.status).toBe(400)
  })

  it('inserts a new status right after the given one (add QA between Backlog and Done)', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'owner' })
    prismaMock.projectStatus.findMany.mockResolvedValue([
      { id: '11111111-1111-1111-1111-111111111111', position: 0 },
      { id: '22222222-2222-2222-2222-222222222222', position: 1 },
    ])
    prismaMock.projectStatus.create.mockResolvedValue({ id: '33333333-3333-3333-3333-333333333333', name: 'QA', position: 1 })
    const res = await request(app)
      .post('/api/projects/proj-1/statuses')
      .set('Authorization', bearer('manager'))
      .send({ name: 'QA', color: '#ff0000', category: 'in_review', afterId: '11111111-1111-1111-1111-111111111111' })
    expect(res.status).toBe(201)
    expect(prismaMock.projectStatus.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 1 }) }),
    )
  })

  it('updates a status when caller is manager', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
    prismaMock.projectStatus.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.projectStatus.findUniqueOrThrow.mockResolvedValue({ id: '44444444-4444-4444-4444-444444444444', name: 'A Fazer' })
    const res = await request(app)
      .patch('/api/projects/proj-1/statuses/status-1')
      .set('Authorization', bearer('manager'))
      .send({ name: 'A Fazer' })
    expect(res.status).toBe(200)
  })

  it('rejects updating a status for a member (not manager/owner)', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
    const res = await request(app)
      .patch('/api/projects/proj-1/statuses/status-1')
      .set('Authorization', bearer('manager'))
      .send({ name: 'A Fazer' })
    expect(res.status).toBe(403)
  })

  it('returns 404 when updating a status that does not belong to the project', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'owner' })
    prismaMock.projectStatus.updateMany.mockResolvedValue({ count: 0 })
    const res = await request(app)
      .patch('/api/projects/proj-1/statuses/status-1')
      .set('Authorization', bearer('manager'))
      .send({ name: 'A Fazer' })
    expect(res.status).toBe(404)
  })

  it('reorders statuses via PATCH .../statuses/reorder without matching :statusId', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'owner' })
    prismaMock.projectStatus.findMany.mockResolvedValue([{ id: '66666666-6666-6666-6666-666666666666' }, { id: '77777777-7777-7777-7777-777777777777' }])
    const res = await request(app)
      .patch('/api/projects/proj-1/statuses/reorder')
      .set('Authorization', bearer('manager'))
      .send({ statusIds: ['77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666'] })
    expect(res.status).toBe(200)
    // A rota /reorder não pode ter caído no controller de updateStatus,
    // que trataria "reorder" como um statusId literal.
    expect(prismaMock.projectStatus.updateMany).not.toHaveBeenCalled()
  })

  it('deletes a status reassigning its tasks', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'owner' })
    prismaMock.projectStatus.findFirst
      .mockResolvedValueOnce({ id: '44444444-4444-4444-4444-444444444444' })
      .mockResolvedValueOnce({ id: '55555555-5555-5555-5555-555555555555' })
    prismaMock.task.findMany.mockResolvedValue([{ id: '88888888-8888-8888-8888-888888888888' }])
    const res = await request(app)
      .delete('/api/projects/proj-1/statuses/status-1')
      .set('Authorization', bearer('manager'))
      .send({ reassignToId: '55555555-5555-5555-5555-555555555555' })
    expect(res.status).toBe(200)
    expect(res.body.data.movedTaskCount).toBe(1)
  })

  it('rejects deleting a status for a viewer', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'viewer' })
    const res = await request(app)
      .delete('/api/projects/proj-1/statuses/status-1')
      .set('Authorization', bearer('manager'))
      .send({ reassignToId: '55555555-5555-5555-5555-555555555555' })
    expect(res.status).toBe(403)
  })

  it('creates a folder', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
    prismaMock.projectFolder.create.mockResolvedValue({ id: 'folder-1', name: 'Fase 1' })
    const res = await request(app)
      .post('/api/projects/proj-1/folders')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Fase 1' })
    expect(res.status).toBe(201)
  })
})
