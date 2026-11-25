import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn() },
  approval: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  task: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  taskActivity: { create: vi.fn() },
  notification: { create: vi.fn() },
  automation: { findMany: vi.fn(async () => []) },
  projectWebhook: { findMany: vi.fn(async () => []) },
  projectWebhookDelivery: { create: vi.fn() },
  $transaction: vi.fn(async (fn: any) => fn(prismaMock)),
}))

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' },
}))
// Acesso ao módulo tem teste próprio (projects.authz.test): aqui o usuário já tem o módulo.
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))
vi.mock('../middlewares/projectScope', () => ({ scopeParamsToProject: () => {}, assertRefsInProject: async () => {} })) // IDOR tem teste próprio (projects.idor.test)
vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../config/socket', () => ({ getIo: () => undefined }))

import projectsRoutes from './projects'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/projects', projectsRoutes)
app.use(errorHandler)

const APPROVER_ID = '33333333-3333-3333-3333-333333333333'
const STATUS_DONE = '44444444-4444-4444-4444-444444444444'

function bearer(role: string, sub = APPROVER_ID) {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
  prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
})

describe('task approvals routes', () => {
  it('requests an approval for a task', async () => {
    prismaMock.task.findUniqueOrThrow.mockResolvedValue({ project_id: 'proj-1', project: { owner_id: 'owner-1' } })
    prismaMock.approval.create.mockResolvedValue({ id: 'appr-1', task_id: 'task-1', approver_id: APPROVER_ID, status: 'pending' })
    const res = await request(app)
      .post('/api/projects/proj-1/tasks/task-1/approvals')
      .set('Authorization', bearer('manager', 'requester-1'))
      .send({ approverId: APPROVER_ID })
    expect(res.status).toBe(201)
  })

  it('approving moves the task via updateTask (status changes, activity recorded)', async () => {
    prismaMock.approval.findUnique.mockResolvedValue({ id: 'appr-1', task_id: 'task-1', approver_id: APPROVER_ID, status: 'pending' })
    prismaMock.approval.update.mockResolvedValue({ id: 'appr-1', status: 'approved' })
    prismaMock.task.findUniqueOrThrow.mockResolvedValue({ id: 'task-1', project_id: 'proj-1', seq: 1, status_id: 'status-pending', priority: 'none', assignee_id: null, title: 'X', description: null, list_id: null, due_date: null })
    prismaMock.task.update.mockResolvedValue({ id: 'task-1', project_id: 'proj-1', status_id: STATUS_DONE })

    const res = await request(app)
      .patch('/api/projects/proj-1/tasks/task-1/approvals/appr-1')
      .set('Authorization', bearer('manager'))
      .send({ status: 'approved', targetStatusId: STATUS_DONE })

    expect(res.status).toBe(200)
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status_id: STATUS_DONE }) })
    )
  })

  it('rejects "changes_requested" without a comment', async () => {
    prismaMock.approval.findUnique.mockResolvedValue({ id: 'appr-1', task_id: 'task-1', approver_id: APPROVER_ID, status: 'pending' })
    const res = await request(app)
      .patch('/api/projects/proj-1/tasks/task-1/approvals/appr-1')
      .set('Authorization', bearer('manager'))
      .send({ status: 'changes_requested' })
    expect(res.status).toBe(400)
  })
})
