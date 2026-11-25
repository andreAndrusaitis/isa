// PENDENTE DE MIGRATION: ver nota no topo de tasks.test.ts — mesma causa.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'
import { createTask, updateTask } from './tasks'

const emitMock = vi.hoisted(() => vi.fn())
vi.mock('../config/socket', () => ({
  getIo: () => ({ to: () => ({ emit: emitMock }) }),
}))

describe('tasks service — realtime and notifications', () => {
  let projectId: string
  let statusId: string
  let ownerId: string
  let assigneeId: string

  beforeEach(async () => {
    const owner = await prisma.user.create({ data: { name: 'Owner', email: `owner-${Date.now()}@test.com`, role: 'manager' } })
    const assignee = await prisma.user.create({ data: { name: 'Assignee', email: `assignee-${Date.now()}@test.com`, role: 'agent' } })
    ownerId = owner.id
    assigneeId = assignee.id
    const project = await prisma.project.create({ data: { name: `Projeto Notif ${Date.now()}`, owner_id: ownerId } })
    projectId = project.id
    // Responsável precisa ser membro do projeto.
    await prisma.projectMember.create({ data: { project_id: projectId, user_id: assigneeId, role: 'member' } })
    const status = await prisma.projectStatus.create({ data: { project_id: projectId, name: 'A Fazer', color: '#000', category: 'open', position: 0 } })
    statusId = status.id
    emitMock.mockClear()
  })

  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { user_id: { in: [ownerId, assigneeId] } } })
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.projectMember.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, assigneeId] } } })
  })

  it('emits task.updated to the project room with the activities as the reason', async () => {
    const task = await createTask(projectId, ownerId, { title: 'Task', statusId })
    emitMock.mockClear()

    await updateTask(task.id, ownerId, { assigneeId })

    expect(emitMock).toHaveBeenCalledWith('task.updated', expect.objectContaining({
      task: expect.objectContaining({ id: task.id }),
      activities: expect.arrayContaining([expect.objectContaining({ type: 'assignee_changed' })]),
    }))
  })

  it('creates a Notification for the new assignee with a specific reason, not a generic message', async () => {
    const task = await createTask(projectId, ownerId, { title: 'Task', statusId })

    await updateTask(task.id, ownerId, { assigneeId })

    const notifications = await prisma.notification.findMany({ where: { user_id: assigneeId } })
    expect(notifications).toHaveLength(1)
    expect(notifications[0].body).not.toMatch(/tarefa atualizada/i)
    expect(notifications[0].body).toMatch(/respons[aá]vel/i)
  })

  it('does not create a notification when the update generates no activity', async () => {
    const task = await createTask(projectId, ownerId, { title: 'Task', statusId })
    await updateTask(task.id, ownerId, { statusId }) // sem mudança real
    const notifications = await prisma.notification.findMany({ where: { user_id: assigneeId } })
    expect(notifications).toHaveLength(0)
  })
})
