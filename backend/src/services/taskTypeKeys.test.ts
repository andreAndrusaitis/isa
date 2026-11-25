// Prisma real contra o banco descartável. Cleanup restrito aos IDs criados aqui.
//   cd backend && DATABASE_URL=postgresql://isa:isa@127.0.0.1:5434/isa DIRECT_URL=$DATABASE_URL npx vitest run --fileParallelism=false src/services/taskTypeKeys.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createProject } from './projects'
import { createTask, updateTask } from './tasks'
import { createTaskType, updateTaskType, deleteTaskType, listTaskTypes } from './taskTypes'
import { spawnNextOccurrence } from './taskCollab'
import { derivePrefix } from './taskTypeKeys'

describe('ID da task por tipo (BUG-12, FEAT-3…)', () => {
  let userId: string
  let projectId: string
  let statusId: string
  const typeId = async (prefix: string) => (await prisma.taskType.findFirstOrThrow({ where: { project_id: projectId, prefix, is_active: true } })).id

  beforeEach(async () => {
    const user = await prisma.user.create({ data: { name: 'Teste Keys', email: `keys-${Date.now()}-${Math.random()}@test.com`, role: 'manager' } })
    userId = user.id
    const project = await createProject(userId, { name: `Projeto Keys ${Date.now()}`, privacy: 'organization' })
    projectId = project.id
    statusId = (await prisma.projectStatus.findFirstOrThrow({ where: { project_id: projectId, category: 'open' } })).id
  })

  afterEach(async () => {
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.taskType.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.projectMember.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('projeto novo nasce com os 8 tipos padrão, cada um com prefixo', async () => {
    const types = await listTaskTypes(projectId)
    expect(types.map((t) => `${t.name}:${t.prefix}`)).toEqual([
      'Epic:EPIC', 'Feature:FEAT', 'User Story:US', 'Tarefa:TASK', 'Bug:BUG', 'Melhoria:MEL', 'QA:QA', 'Documentação:DOC',
    ])
  })

  it('numera por tipo, independente do #seq do projeto', async () => {
    const bug = await typeId('BUG')
    const feat = await typeId('FEAT')
    const a = await createTask(projectId, userId, { title: 'a', statusId, taskTypeId: bug })
    const b = await createTask(projectId, userId, { title: 'b', statusId, taskTypeId: feat })
    const c = await createTask(projectId, userId, { title: 'c', statusId, taskTypeId: bug })
    expect([a.key, b.key, c.key]).toEqual(['BUG-1', 'FEAT-1', 'BUG-2'])
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3])
  })

  it('sem tipo informado (API, MCP), a task vira Tarefa e ganha ID', async () => {
    const task = await createTask(projectId, userId, { title: 'sem tipo', statusId })
    expect(task.key).toBe('TASK-1')
    expect(task.task_type_id).toBe(await typeId('TASK'))
  })

  it('recusa tipo de outro projeto', async () => {
    const other = await createProject(userId, { name: `Outro ${Date.now()}`, privacy: 'organization' })
    const foreign = (await prisma.taskType.findFirstOrThrow({ where: { project_id: other.id, prefix: 'BUG' } })).id
    await expect(createTask(projectId, userId, { title: 'x', statusId, taskTypeId: foreign })).rejects.toThrow()
    await prisma.taskType.deleteMany({ where: { project_id: other.id } })
    await prisma.projectStatus.deleteMany({ where: { project_id: other.id } })
    await prisma.projectMember.deleteMany({ where: { project_id: other.id } })
    await prisma.project.delete({ where: { id: other.id } })
  })

  it('trocar o tipo dá o próximo número do tipo novo; tirar o tipo é recusado', async () => {
    const task = await createTask(projectId, userId, { title: 'era bug', statusId, taskTypeId: await typeId('BUG') })
    await createTask(projectId, userId, { title: 'feat 1', statusId, taskTypeId: await typeId('FEAT') })
    const { task: moved } = await updateTask(task.id, userId, { taskTypeId: await typeId('FEAT') })
    expect(moved.key).toBe('FEAT-2')
    await expect(updateTask(task.id, userId, { taskTypeId: null })).rejects.toThrow(/obrigatório/)
  })

  it('mudar o prefixo do tipo refaz a chave das tasks e mantém o número', async () => {
    const bug = await typeId('BUG')
    const t = await createTask(projectId, userId, { title: 'x', statusId, taskTypeId: bug })
    await updateTaskType(projectId, bug, { prefix: 'DEF' })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).key).toBe('DEF-1')
    const next = await createTask(projectId, userId, { title: 'y', statusId, taskTypeId: bug })
    expect(next.key).toBe('DEF-2')
  })

  it('prefixo repetido ou fora do padrão é recusado', async () => {
    await expect(updateTaskType(projectId, await typeId('BUG'), { prefix: 'FEAT' })).rejects.toThrow(/já é usado/)
    await expect(updateTaskType(projectId, await typeId('BUG'), { prefix: '9X' })).rejects.toThrow(/inválido/)
  })

  it('tipo novo sem prefixo recebe um derivado do nome, sem repetir', async () => {
    const a = await createTaskType(projectId, { name: 'Débito Técnico', icon: 'Layers', color: '#000' })
    const b = await createTaskType(projectId, { name: 'Débito técnico 2', icon: 'Layers', color: '#000' })
    expect(a.prefix).toBe('DEBI')
    expect(b.prefix).toBe('DEBI2')
    expect(derivePrefix('123 Ação')).toBe('ACAO')
  })

  it('excluir um tipo move as tasks para Tarefa com IDs novos; o último tipo não sai', async () => {
    const bug = await typeId('BUG')
    const t1 = await createTask(projectId, userId, { title: 'b1', statusId, taskTypeId: bug })
    await createTask(projectId, userId, { title: 't1', statusId })
    await deleteTaskType(projectId, bug)
    const moved = await prisma.task.findUniqueOrThrow({ where: { id: t1.id } })
    expect(moved.task_type_id).toBe(await typeId('TASK'))
    expect(moved.key).toBe('TASK-2')

    for (const t of await listTaskTypes(projectId)) {
      if (t.prefix !== 'DOC') await deleteTaskType(projectId, t.id)
    }
    await expect(deleteTaskType(projectId, await typeId('DOC'))).rejects.toThrow(/pelo menos um tipo/)
  })

  it('a próxima ocorrência de task recorrente mantém o tipo e ganha número novo', async () => {
    const task = await createTask(projectId, userId, {
      title: 'semanal', statusId, taskTypeId: await typeId('QA'), dueDate: new Date().toISOString(),
      recurrence: { freq: 'weekly', interval: 1, mode: 'on_complete' },
    })
    const nextId = await spawnNextOccurrence(task.id)
    const next = await prisma.task.findUniqueOrThrow({ where: { id: nextId! } })
    expect(next.key).toBe('QA-2')
  })
})
