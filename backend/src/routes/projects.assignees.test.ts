import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn(), count: vi.fn() },
  project: { findUnique: vi.fn() },
  taskAssignee: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  task: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
  taskActivity: { create: vi.fn() },
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

const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
  prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
})

describe('task assignees (multiple)', () => {
  it('sets multiple assignees for a task', async () => {
    prismaMock.taskAssignee.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.taskAssignee.createMany.mockResolvedValue({ count: 2 })
    // Principal já é USER_A: não passa por updateTask, só o conjunto muda.
    prismaMock.task.findUniqueOrThrow.mockResolvedValue({ project_id: 'proj-1', assignee_id: USER_A })
    prismaMock.taskAssignee.findMany.mockResolvedValue([{ user_id: USER_A }])
    prismaMock.projectMember.count.mockResolvedValue(2) // os dois são membros

    const res = await request(app)
      .put('/api/projects/proj-1/tasks/task-1/assignees')
      .set('Authorization', bearer('manager'))
      .send({ userIds: [USER_A, USER_B] })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.arrayContaining([USER_A, USER_B]))
    expect(prismaMock.taskActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'assignees_changed', from_value: USER_A, to_value: `${USER_A},${USER_B}` }),
    })
  })

  it('recusa responsável que não é membro do projeto', async () => {
    prismaMock.task.findUniqueOrThrow.mockResolvedValue({ project_id: 'proj-1' })
    prismaMock.projectMember.count.mockResolvedValue(1)
    const res = await request(app)
      .put('/api/projects/proj-1/tasks/task-1/assignees')
      .set('Authorization', bearer('manager'))
      .send({ userIds: [USER_A, USER_B] })
    expect(res.status).toBe(400)
    expect(prismaMock.taskAssignee.createMany).not.toHaveBeenCalled()
  })

  it('lists assignees for a task', async () => {
    prismaMock.taskAssignee.findMany.mockResolvedValue([{ user_id: USER_A }])
    const res = await request(app)
      .get('/api/projects/proj-1/tasks/task-1/assignees')
      .set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([USER_A])
  })

  it('rejects assignee change for a viewer', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'viewer' })
    const res = await request(app)
      .put('/api/projects/proj-1/tasks/task-1/assignees')
      .set('Authorization', bearer('manager'))
      .send({ userIds: [USER_A] })
    expect(res.status).toBe(403)
  })
})
