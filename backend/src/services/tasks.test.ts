// Prisma real (não mockado): rodar contra banco de teste.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createTask, updateTask, listTasksByProject, getTaskById } from './tasks'

describe('tasks service', () => {
  let projectId: string
  let statusId: string
  let userId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { name: 'Teste Tasks', email: `tasks-${Date.now()}@test.com`, role: 'manager' },
    })
    userId = user.id
    const project = await prisma.project.create({
      data: { name: `Projeto Tasks ${Date.now()}`, owner_id: userId },
    })
    projectId = project.id
    const status = await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'A Fazer', color: '#000', category: 'open', position: 0 },
    })
    statusId = status.id
  })

  afterEach(async () => {
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('assigns sequential seq numbers scoped to the project', async () => {
    const task1 = await createTask(projectId, userId, { title: 'Task 1', statusId })
    const task2 = await createTask(projectId, userId, { title: 'Task 2', statusId })
    expect(task1.seq).toBe(1)
    expect(task2.seq).toBe(2)
  })

  it('records a "created" activity on task creation', async () => {
    const task = await createTask(projectId, userId, { title: 'Task 1', statusId })
    const activities = await prisma.taskActivity.findMany({ where: { task_id: task.id } })
    expect(activities).toHaveLength(1)
    expect(activities[0].type).toBe('created')
  })

  it('records a status_changed activity with from/to values on update', async () => {
    const task = await createTask(projectId, userId, { title: 'Task 1', statusId })
    const otherStatus = await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'Concluído', color: '#0f0', category: 'done', position: 1 },
    })

    await updateTask(task.id, userId, { statusId: otherStatus.id })

    const activities = await prisma.taskActivity.findMany({ where: { task_id: task.id }, orderBy: { created_at: 'asc' } })
    const statusChange = activities.find((a) => a.type === 'status_changed')
    expect(statusChange).toBeDefined()
    expect(statusChange!.from_value).toBe(statusId)
    expect(statusChange!.to_value).toBe(otherStatus.id)
  })

  it('does NOT record an activity when the field value is unchanged', async () => {
    const task = await createTask(projectId, userId, { title: 'Task 1', statusId })
    await updateTask(task.id, userId, { statusId }) // mesmo status
    const activities = await prisma.taskActivity.findMany({ where: { task_id: task.id } })
    expect(activities).toHaveLength(1) // só o "created"
  })

  it('records a title_changed activity with the previous and new title', async () => {
    const task = await createTask(projectId, userId, { title: 'Título Original', statusId })
    await updateTask(task.id, userId, { title: 'Título Novo' })
    const activities = await prisma.taskActivity.findMany({ where: { task_id: task.id, type: 'title_changed' } })
    expect(activities).toHaveLength(1)
    expect(activities[0].from_value).toBe('Título Original')
    expect(activities[0].to_value).toBe('Título Novo')
  })

  it('subtarefa: a mãe traz o resumo das filhas e a filha traz a mãe; a lista só mostra a raiz', async () => {
    const parent = await createTask(projectId, userId, { title: 'Mãe', statusId })
    const child = await createTask(projectId, userId, { title: 'Filha', statusId, parentId: parent.id })

    expect((await getTaskById(parent.id))!.subtasks).toEqual([expect.objectContaining({ id: child.id, title: 'Filha', status_id: statusId })])
    expect((await getTaskById(child.id))!.parent).toMatchObject({ id: parent.id, title: 'Mãe' })
    expect((await listTasksByProject(projectId)).map((t) => t.id)).toEqual([parent.id])
  })

  it('includes tags, subtasks count, comments count and multi-assignees in listTasksByProject', async () => {
    const task = await createTask(projectId, userId, { title: 'Task com metadados', statusId })

    const tag = await prisma.tag.create({ data: { project_id: projectId, name: 'bug', color: '#dc2626' } })
    await prisma.taskTag.create({ data: { task_id: task.id, tag_id: tag.id } })

    await prisma.task.create({
      data: { project_id: projectId, status_id: statusId, seq: 999, title: 'Subtask', creator_id: userId, parent_id: task.id },
    })

    await prisma.taskComment.create({ data: { task_id: task.id, author_id: userId, body: 'Um comentário' } })

    const otherUser = await prisma.user.create({
      data: { name: 'Colega', email: `colega-${Date.now()}@test.com`, role: 'agent' },
    })
    await prisma.taskAssignee.create({ data: { task_id: task.id, user_id: otherUser.id } })

    const blockerTask = await createTask(projectId, userId, { title: 'Bloqueadora', statusId })
    await prisma.taskDependency.create({ data: { task_id: task.id, depends_on_id: blockerTask.id } })

    const result = await listTasksByProject(projectId, {})
    const found = result.find((t) => t.id === task.id)!

    expect(found.tags).toHaveLength(1)
    expect(found.tags[0].tag.name).toBe('bug')
    expect(found.subtasks_count).toBe(1)
    expect(found.comments_count).toBe(1)
    expect(found.multi_assignees).toHaveLength(1)
    expect(found.multi_assignees[0].user.id).toBe(otherUser.id)
    expect(found.blocked_by).toHaveLength(1)

    await prisma.taskDependency.deleteMany({ where: { task_id: task.id } })
    await prisma.taskAssignee.deleteMany({ where: { task_id: task.id } })
    await prisma.taskComment.deleteMany({ where: { task_id: task.id } })
    await prisma.taskTag.deleteMany({ where: { task_id: task.id } })
    await prisma.tag.delete({ where: { id: tag.id } })
    await prisma.user.delete({ where: { id: otherUser.id } })
  })
})
