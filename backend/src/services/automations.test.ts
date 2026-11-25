// PENDENTE DE MIGRATION: ver nota em backend/src/services/tasks.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'
import { createTask } from './tasks'
import { runAutomationsFor } from './automations'

vi.mock('../config/socket', () => ({ getIo: () => undefined }))

describe('automations engine', () => {
  let projectId: string
  let ownerId: string
  let statusTodoId: string
  let statusDoneId: string

  beforeEach(async () => {
    const owner = await prisma.user.create({ data: { name: 'Owner', email: `owner-${Date.now()}@test.com`, role: 'manager' } })
    ownerId = owner.id
    const project = await prisma.project.create({ data: { name: `Projeto Automations ${Date.now()}`, owner_id: ownerId } })
    projectId = project.id
    const statusTodo = await prisma.projectStatus.create({ data: { project_id: projectId, name: 'A Fazer', color: '#000', category: 'open', position: 0 } })
    const statusDone = await prisma.projectStatus.create({ data: { project_id: projectId, name: 'Concluído', color: '#0f0', category: 'done', position: 1 } })
    statusTodoId = statusTodo.id
    statusDoneId = statusDone.id
  })

  afterEach(async () => {
    await prisma.automationRun.deleteMany({ where: { automation: { project_id: projectId } } })
    await prisma.automation.deleteMany({ where: { project_id: projectId } })
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: ownerId } })
  })

  it('runs a change_status action when status_changed trigger matches, and records a successful run', async () => {
    await prisma.automation.create({
      data: {
        project_id: projectId,
        name: 'Auto-concluir',
        trigger: 'status_changed',
        conditions: undefined,
        actions: [{ type: 'change_status', statusId: statusDoneId }],
        created_by: ownerId,
      },
    })

    const task = await createTask(projectId, ownerId, { title: 'Task', statusId: statusTodoId })
    await runAutomationsFor('status_changed', task, { actorId: ownerId, depth: 0 })

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status_id).toBe(statusDoneId)

    const runs = await prisma.automationRun.findMany({ where: { task_id: task.id } })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('success')
  })

  it('does not run automations that are inactive', async () => {
    await prisma.automation.create({
      data: {
        project_id: projectId,
        name: 'Desativada',
        trigger: 'status_changed',
        actions: [{ type: 'change_status', statusId: statusDoneId }],
        is_active: false,
        created_by: ownerId,
      },
    })

    const task = await createTask(projectId, ownerId, { title: 'Task', statusId: statusTodoId })
    await runAutomationsFor('status_changed', task, { actorId: ownerId, depth: 0 })

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status_id).toBe(statusTodoId) // não mudou

    const runs = await prisma.automationRun.findMany({ where: { task_id: task.id } })
    expect(runs).toHaveLength(0)
  })

  it('stops at MAX_AUTOMATION_DEPTH and records an error run instead of looping forever', async () => {
    // Uma automação que dispara a si mesma indiretamente: muda status,
    // o que aciona status_changed de novo (via updateTask -> chamado
    // manualmente aqui simulando o encadeamento real de produção).
    await prisma.automation.create({
      data: {
        project_id: projectId,
        name: 'Loop',
        trigger: 'status_changed',
        actions: [{ type: 'change_status', statusId: statusDoneId }],
        created_by: ownerId,
      },
    })

    const task = await createTask(projectId, ownerId, { title: 'Task', statusId: statusTodoId })
    await runAutomationsFor('status_changed', task, { actorId: ownerId, depth: 5 })

    const runs = await prisma.automationRun.findMany({ where: { task_id: task.id } })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('error')
    expect(runs[0].error_message).toMatch(/profundidade|encadeamento/i)
  })

  it('evaluates conditions before running actions — skips when condition does not match', async () => {
    await prisma.automation.create({
      data: {
        project_id: projectId,
        name: 'Só se prioridade alta',
        trigger: 'status_changed',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [{ type: 'change_status', statusId: statusDoneId }],
        created_by: ownerId,
      },
    })

    const task = await createTask(projectId, ownerId, { title: 'Task', statusId: statusTodoId, priority: 'none' })
    await runAutomationsFor('status_changed', task, { actorId: ownerId, depth: 0 })

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status_id).toBe(statusTodoId)

    const runs = await prisma.automationRun.findMany({ where: { task_id: task.id } })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('skipped')
  })
})
