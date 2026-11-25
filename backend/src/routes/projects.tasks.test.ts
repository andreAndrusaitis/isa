import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  projectMember: { findUnique: vi.fn() },
  project: { update: vi.fn(), findUnique: vi.fn(async () => null) },
  task: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  taskActivity: { create: vi.fn(), findMany: vi.fn() },
  taskType: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  sprint: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  notification: { create: vi.fn() },
  checklistItem: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  taskComment: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  automation: { findMany: vi.fn(async () => []) },
  projectWebhook: { findMany: vi.fn(async () => []) },
  projectWebhookDelivery: { create: vi.fn() },
  $transaction: vi.fn(async (fn: any) => (Array.isArray(fn) ? Promise.all(fn) : fn(prismaMock))),
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

function bearer(role: string, sub = 'user-1') {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
  prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
  prismaMock.checklistItem.count.mockResolvedValue(0)
  // Toda task tem tipo e ID por tipo: o informado (se existir) ou o "Tarefa" do projeto.
  prismaMock.taskType.findFirst.mockImplementation(async (args: any) => (
    args?.where?.id ? { id: args.where.id, prefix: 'BUG' } : { id: 'tt-task', prefix: 'TASK' }
  ))
  prismaMock.taskType.update.mockResolvedValue({ prefix: 'TASK', next_number: 2 })
})

const STATUS_1 = '11111111-1111-1111-1111-111111111111'
const STATUS_2 = '22222222-2222-2222-2222-222222222222'

describe('task CRUD routes', () => {
  it('creates a task', async () => {
    prismaMock.project.update.mockResolvedValue({ next_task_seq: 2 })
    prismaMock.task.create.mockResolvedValue({ id: 'task-1', seq: 1, title: 'Nova Task' })
    prismaMock.taskActivity.create.mockResolvedValue({})

    const res = await request(app)
      .post('/api/projects/proj-1/tasks')
      .set('Authorization', bearer('manager'))
      .send({ title: 'Nova Task', statusId: STATUS_1 })

    expect(res.status).toBe(201)
    expect(res.body.data.title).toBe('Nova Task')
  })

  it('rejects task creation for a viewer', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'viewer' })
    const res = await request(app)
      .post('/api/projects/proj-1/tasks')
      .set('Authorization', bearer('manager'))
      .send({ title: 'Nova Task', statusId: STATUS_1 })
    expect(res.status).toBe(403)
  })

  it('GET /tasks retorna tags, multiAssignees, contagens e blocking em camelCase', async () => {
    prismaMock.task.findMany.mockResolvedValue([{
      id: 'task-1', project_id: 'proj-1', list_id: null, status_id: STATUS_1, parent_id: null,
      seq: 1, title: 'Com metadados', description: null, priority: 'none', assignee_id: null,
      creator_id: 'user-1', start_date: null, due_date: null, is_milestone: false, archived_at: null,
      tags: [{ task_id: 'task-1', tag_id: 'tag-1', tag: { id: 'tag-1', project_id: 'proj-1', name: 'bug', color: '#dc2626' } }],
      multi_assignees: [{ id: 'ma-1', task_id: 'task-1', user_id: 'user-2', user: { id: 'user-2', name: 'Colega', avatar: null } }],
      blocking: [{ id: 'dep-1', task_id: 'task-1', depends_on_id: 'task-2' }],
      _count: { subtasks: 2, comments: 3 },
    }])

    const res = await request(app)
      .get('/api/projects/proj-1/tasks')
      .set('Authorization', bearer('manager'))

    expect(res.status).toBe(200)
    const task = res.body.data[0]
    expect(task.tags[0].tag.name).toBe('bug')
    expect(task.multiAssignees[0].user.name).toBe('Colega')
    expect(task.subtasksCount).toBe(2)
    expect(task.commentsCount).toBe(3)
    expect(task.blocking).toHaveLength(1)
  })

  it('GET /task-types lista os tipos do projeto em camelCase', async () => {
    prismaMock.taskType.findMany.mockResolvedValue([
      { id: 'tt-1', project_id: 'proj-1', name: 'Story', icon: 'BookmarkCheck', color: '#16a34a', position: 0, is_active: true },
    ])
    const res = await request(app)
      .get('/api/projects/proj-1/task-types')
      .set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data[0]).toEqual(expect.objectContaining({ id: 'tt-1', name: 'Story', icon: 'BookmarkCheck', isActive: true }))
  })

  it('POST /task-types cria um tipo com ícone válido', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
    prismaMock.taskType.count.mockResolvedValue(0)
    prismaMock.taskType.create.mockResolvedValue({ id: 'tt-2', project_id: 'proj-1', name: 'Bug', icon: 'Bug', color: '#dc2626', position: 0, is_active: true })
    const res = await request(app)
      .post('/api/projects/proj-1/task-types')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Bug', icon: 'Bug', color: '#dc2626' })
    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Bug')
  })

  it('POST /task-types rejeita ícone fora da lista permitida', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
    const res = await request(app)
      .post('/api/projects/proj-1/task-types')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Custom', icon: 'NotARealIcon', color: '#000' })
    expect(res.status).toBe(400)
  })

  it('creates a task with a taskTypeId', async () => {
    const TASK_TYPE_1 = '33333333-3333-3333-3333-333333333333'
    prismaMock.project.update.mockResolvedValue({ next_task_seq: 2 })
    prismaMock.task.create.mockResolvedValue({ id: 'task-2', seq: 1, title: 'Bug urgente', task_type_id: TASK_TYPE_1 })
    prismaMock.taskActivity.create.mockResolvedValue({})

    const res = await request(app)
      .post('/api/projects/proj-1/tasks')
      .set('Authorization', bearer('manager'))
      .send({ title: 'Bug urgente', statusId: STATUS_1, taskTypeId: TASK_TYPE_1 })

    expect(res.status).toBe(201)
    expect(prismaMock.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ task_type_id: TASK_TYPE_1 }),
    }))
  })

  it('creates a task with valid storyPoints', async () => {
    prismaMock.project.update.mockResolvedValue({ next_task_seq: 2 })
    prismaMock.task.create.mockResolvedValue({ id: 'task-3', seq: 1, title: 'Com pontos', story_points: 5 })
    prismaMock.taskActivity.create.mockResolvedValue({})

    const res = await request(app)
      .post('/api/projects/proj-1/tasks')
      .set('Authorization', bearer('manager'))
      .send({ title: 'Com pontos', statusId: STATUS_1, storyPoints: 5 })

    expect(res.status).toBe(201)
    expect(prismaMock.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ story_points: 5 }),
    }))
  })

  it('rejects storyPoints fora da escala Fibonacci', async () => {
    const res = await request(app)
      .post('/api/projects/proj-1/tasks')
      .set('Authorization', bearer('manager'))
      .send({ title: 'Inválida', statusId: STATUS_1, storyPoints: 4 })
    expect(res.status).toBe(400)
  })

  it('updates a task via PATCH', async () => {
    prismaMock.task.findUniqueOrThrow.mockResolvedValue({ id: 'task-1', project_id: 'proj-1', seq: 1, status_id: STATUS_1, priority: 'none', assignee_id: null, title: 'X', description: null, list_id: null, due_date: null })
    prismaMock.task.update.mockResolvedValue({ id: 'task-1', project_id: 'proj-1', seq: 1, status_id: STATUS_2 })
    const res = await request(app)
      .patch('/api/projects/proj-1/tasks/task-1')
      .set('Authorization', bearer('manager'))
      .send({ statusId: STATUS_2 })
    expect(res.status).toBe(200)
  })

  it('adds a checklist item', async () => {
    prismaMock.checklistItem.create.mockResolvedValue({ id: 'item-1', text: 'Passo 1', done: false })
    const res = await request(app)
      .post('/api/projects/proj-1/tasks/task-1/checklist')
      .set('Authorization', bearer('manager'))
      .send({ text: 'Passo 1' })
    expect(res.status).toBe(201)
  })

  it('adds a comment', async () => {
    prismaMock.taskComment.create.mockResolvedValue({ id: 'comment-1', body: 'Comentário' })
    prismaMock.task.findUniqueOrThrow.mockResolvedValue({ id: 'task-1', project_id: 'proj-1', seq: 1 })
    const res = await request(app)
      .post('/api/projects/proj-1/tasks/task-1/comments')
      .set('Authorization', bearer('manager'))
      .send({ body: 'Comentário' })
    expect(res.status).toBe(201)
  })

  it('GET /sprints lista os sprints do projeto em camelCase', async () => {
    prismaMock.sprint.findMany.mockResolvedValue([
      { id: 'sp-1', project_id: 'proj-1', name: 'Sprint 1', status: 'planned', start_date: null, end_date: null, position: 0 },
    ])
    const res = await request(app)
      .get('/api/projects/proj-1/sprints')
      .set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data[0]).toEqual(expect.objectContaining({ id: 'sp-1', name: 'Sprint 1', status: 'planned' }))
  })

  it('POST /sprints/:id/start rejeita quando já existe sprint ativo', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
    prismaMock.sprint.findFirst.mockResolvedValueOnce({ id: 'sp-2', status: 'planned' })
    prismaMock.sprint.findFirst.mockResolvedValueOnce({ id: 'sp-1', status: 'active' })
    const res = await request(app)
      .post('/api/projects/proj-1/sprints/sp-2/start')
      .set('Authorization', bearer('manager'))
    expect(res.status).toBe(409)
  })

  it('creates a task with a sprintId', async () => {
    const SPRINT_1 = '55555555-5555-5555-5555-555555555555'
    prismaMock.project.update.mockResolvedValue({ next_task_seq: 2 })
    prismaMock.task.create.mockResolvedValue({ id: 'task-4', seq: 1, title: 'Na sprint', sprint_id: SPRINT_1 })
    prismaMock.taskActivity.create.mockResolvedValue({})

    const res = await request(app)
      .post('/api/projects/proj-1/tasks')
      .set('Authorization', bearer('manager'))
      .send({ title: 'Na sprint', statusId: STATUS_1, sprintId: SPRINT_1 })

    expect(res.status).toBe(201)
    expect(prismaMock.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sprint_id: SPRINT_1 }),
    }))
  })
})
