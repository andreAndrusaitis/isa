// Prisma real contra o banco local. Cleanup restrito aos IDs criados aqui —
// nunca deleteMany amplo em user/organization.
//   cd backend && DATABASE_URL="postgresql://isa:isa@localhost:5433/isa" npx vitest run --fileParallelism=false src/services/taskTypes.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createTask } from './tasks'
import { createTaskType, listTaskTypes, updateTaskType, deleteTaskType } from './taskTypes'

describe('gerenciamento de tipos de tarefa por projeto', () => {
  let projectId: string
  let userId: string
  let statusId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { name: 'Teste TaskType', email: `tasktype-${Date.now()}-${Math.random()}@test.com`, role: 'manager' },
    })
    userId = user.id
    const project = await prisma.project.create({ data: { name: `Projeto TaskType ${Date.now()}`, owner_id: userId } })
    projectId = project.id
    const status = await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'A Fazer', color: '#000', category: 'open', position: 0 },
    })
    statusId = status.id
  })

  afterEach(async () => {
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.taskType.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('cria um tipo no fim da lista e lista em ordem de posição', async () => {
    const story = await createTaskType(projectId, { name: 'Story', icon: 'BookmarkCheck', color: '#16a34a' })
    const bug = await createTaskType(projectId, { name: 'Bug', icon: 'Bug', color: '#dc2626' })

    expect(story.position).toBe(0)
    expect(bug.position).toBe(1)

    const listed = await listTaskTypes(projectId)
    expect(listed.map((t) => t.name)).toEqual(['Story', 'Bug'])
  })

  it('atualiza nome, ícone e cor', async () => {
    const created = await createTaskType(projectId, { name: 'Story', icon: 'BookmarkCheck', color: '#16a34a' })
    const updated = await updateTaskType(projectId, created.id, { name: 'User Story', icon: 'Flag', color: '#000000' })
    expect(updated.name).toBe('User Story')
    expect(updated.icon).toBe('Flag')
    expect(updated.color).toBe('#000000')
  })

  it('exclui um tipo (soft delete) e as tasks vão para o tipo de destino com ID novo', async () => {
    const bug = await createTaskType(projectId, { name: 'Bug', icon: 'Bug', color: '#dc2626' })
    const task = await createTask(projectId, userId, { title: 'Corrigir crash', statusId, taskTypeId: bug.id } as any)
    expect(task.task_type_id).toBe(bug.id)
    const fallback = await createTaskType(projectId, { name: 'Tarefa', icon: 'CheckSquare', color: '#2563eb', prefix: 'TASK' })

    await deleteTaskType(projectId, bug.id)

    const reloadedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(reloadedTask.task_type_id).toBe(fallback.id)
    expect(reloadedTask.key).toBe('TASK-1')

    // Soft delete: não aparece mais em listTaskTypes, mas a linha continua existindo.
    expect((await listTaskTypes(projectId)).map((t) => t.id)).not.toContain(bug.id)
    expect(await prisma.taskType.findUnique({ where: { id: bug.id } })).not.toBeNull()
  })
})
