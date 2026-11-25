import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn() },
  customField: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  customFieldValue: { upsert: vi.fn() },
  tag: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  taskTag: { create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  taskActivity: { create: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
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
  prismaMock.customField.count.mockResolvedValue(0)
})

describe('custom fields', () => {
  it('creates a custom field with a valid type', async () => {
    prismaMock.customField.create.mockResolvedValue({ id: 'cf-1', name: 'Story Points', type: 'number' })
    const res = await request(app)
      .post('/api/projects/proj-1/custom-fields')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Story Points', type: 'number' })
    expect(res.status).toBe(201)
  })

  it('rejects an invalid type', async () => {
    const res = await request(app)
      .post('/api/projects/proj-1/custom-fields')
      .set('Authorization', bearer('manager'))
      .send({ name: 'X', type: 'not-a-type' })
    expect(res.status).toBe(400)
  })

  it('sets a custom field value on a task', async () => {
    prismaMock.customFieldValue.upsert.mockResolvedValue({ id: 'cfv-1', value: 5 })
    const res = await request(app)
      .put('/api/projects/proj-1/tasks/task-1/custom-fields/cf-1')
      .set('Authorization', bearer('manager'))
      .send({ value: 5 })
    expect(res.status).toBe(200)
  })
})

describe('tags', () => {
  it('lista com o número de tasks de cada tag', async () => {
    prismaMock.tag.findMany.mockResolvedValue([{ id: 'tag-1', name: 'Bug', color: '#f00', _count: { tasks: 3 } }])
    const res = await request(app).get('/api/projects/proj-1/tags').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([{ id: 'tag-1', name: 'Bug', color: '#f00', taskCount: 3 }])
  })

  it('exclui a tag e registra no histórico de cada task', async () => {
    prismaMock.tag.findFirst.mockResolvedValue({ id: 'tag-1', name: 'Bug', tasks: [{ task_id: 't1' }, { task_id: 't2' }] })
    const res = await request(app).delete('/api/projects/proj-1/tags/tag-1').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ removedFrom: 2 })
    expect(prismaMock.tag.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'tag-1', project_id: 'proj-1' } }))
    expect(prismaMock.taskTag.deleteMany).toHaveBeenCalledWith({ where: { tag_id: 'tag-1' } })
    expect(prismaMock.tag.delete).toHaveBeenCalledWith({ where: { id: 'tag-1' } })
    expect(prismaMock.taskActivity.create).toHaveBeenCalledTimes(2)
  })

  it('tag de outro projeto responde 404 e não apaga nada', async () => {
    prismaMock.tag.findFirst.mockResolvedValue(null)
    const res = await request(app).delete('/api/projects/proj-1/tags/tag-x').set('Authorization', bearer('manager'))
    expect(res.status).toBe(404)
    expect(prismaMock.tag.delete).not.toHaveBeenCalled()
  })

  it('membro comum não exclui tag', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
    const res = await request(app).delete('/api/projects/proj-1/tags/tag-1').set('Authorization', bearer('agent'))
    expect(res.status).toBe(403)
    expect(prismaMock.tag.delete).not.toHaveBeenCalled()
  })

  it('creates a tag', async () => {
    prismaMock.tag.create.mockResolvedValue({ id: 'tag-1', name: 'urgente', color: '#ff0000' })
    const res = await request(app)
      .post('/api/projects/proj-1/tags')
      .set('Authorization', bearer('manager'))
      .send({ name: 'urgente', color: '#ff0000' })
    expect(res.status).toBe(201)
  })

  it('adds a tag to a task', async () => {
    prismaMock.taskTag.create.mockResolvedValue({ task_id: 'task-1', tag_id: 'tag-1', tag: { name: 'urgente' } })
    const res = await request(app)
      .post('/api/projects/proj-1/tasks/task-1/tags/tag-1')
      .set('Authorization', bearer('manager'))
    expect(res.status).toBe(201)
  })

  it('removes a tag from a task', async () => {
    prismaMock.taskTag.delete.mockResolvedValue({ tag: { name: 'urgente' } })
    const res = await request(app)
      .delete('/api/projects/proj-1/tasks/task-1/tags/tag-1')
      .set('Authorization', bearer('manager'))
    expect(res.status).toBe(204)
  })
})
