// Prisma real contra o banco local. Cleanup restrito aos IDs criados aqui —
// nunca deleteMany amplo em user/organization.
//   cd backend && npx vitest run --fileParallelism=false src/services/projectStructure.statuses.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { createTask } from './tasks'
import {
  createStatus, updateStatus, deleteStatus, reorderStatuses, listStatuses,
} from './projectStructure'
import { AppError } from '../middlewares/errorHandler'

describe('gerenciamento de status do projeto', () => {
  let projectId: string
  let userId: string
  let backlogId: string
  let doneId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { name: 'Teste Status', email: `status-${Date.now()}-${Math.random()}@test.com`, role: 'manager' },
    })
    userId = user.id
    const project = await prisma.project.create({ data: { name: `Projeto Status ${Date.now()}`, owner_id: userId } })
    projectId = project.id
    backlogId = (await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'Backlog', color: '#888', category: 'backlog', position: 0 },
    })).id
    doneId = (await prisma.projectStatus.create({
      data: { project_id: projectId, name: 'Concluído', color: '#0a0', category: 'done', position: 1 },
    })).id
  })

  afterEach(async () => {
    await prisma.taskActivity.deleteMany({ where: { task: { project_id: projectId } } })
    await prisma.task.deleteMany({ where: { project_id: projectId } })
    await prisma.projectStatus.deleteMany({ where: { project_id: projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('insere um novo status logo depois do indicado (add QA entre Backlog e Concluído)', async () => {
    const qa = await createStatus(projectId, { name: 'QA', color: '#f0a', category: 'in_review', afterId: backlogId })

    const ordered = await listStatuses(projectId)
    expect(ordered.map((s) => s.name)).toEqual(['Backlog', 'QA', 'Concluído'])
    expect(qa.position).toBe(1)
    expect((await prisma.projectStatus.findUniqueOrThrow({ where: { id: doneId } })).position).toBe(2)
  })

  it('sem afterId, insere no fim da lista', async () => {
    await createStatus(projectId, { name: 'Arquivado', color: '#000', category: 'cancelled' })
    const ordered = await listStatuses(projectId)
    expect(ordered.map((s) => s.name)).toEqual(['Backlog', 'Concluído', 'Arquivado'])
  })

  it('atualiza nome, cor, categoria e requiresApproval', async () => {
    const updated = await updateStatus(projectId, backlogId, {
      name: 'A Fazer', color: '#123456', category: 'open', requiresApproval: true,
    })
    expect(updated.name).toBe('A Fazer')
    expect(updated.color).toBe('#123456')
    expect(updated.category).toBe('open')
    expect(updated.requires_approval).toBe(true)
  })

  it('recusa atualizar status de outro projeto', async () => {
    const other = await prisma.project.create({ data: { name: `Outro ${Date.now()}`, owner_id: userId } })
    await expect(updateStatus(other.id, backlogId, { name: 'Hack' })).rejects.toThrow(AppError)
    await prisma.project.delete({ where: { id: other.id } })
  })

  it('reordena a lista completa de status', async () => {
    const qa = await createStatus(projectId, { name: 'QA', color: '#f0a', category: 'in_review', afterId: backlogId })
    const reordered = await reorderStatuses(projectId, { statusIds: [doneId, qa.id, backlogId] })
    expect(reordered.map((s) => s.name)).toEqual(['Concluído', 'QA', 'Backlog'])
  })

  it('recusa reordenar com lista que não bate com os status ativos', async () => {
    await expect(reorderStatuses(projectId, { statusIds: [backlogId] })).rejects.toThrow(/exatamente os status ativos/)
  })

  it('exclui um status realocando as tasks para o destino e preserva o histórico', async () => {
    const task = await createTask(projectId, userId, { title: 'Presa no Backlog', statusId: backlogId })

    const result = await deleteStatus(projectId, backlogId, userId, { reassignToId: doneId })
    expect(result.movedTaskCount).toBe(1)

    const updatedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updatedTask.status_id).toBe(doneId)

    // Soft delete: não aparece mais em listStatuses, mas a linha continua existindo.
    expect((await listStatuses(projectId)).map((s) => s.id)).not.toContain(backlogId)
    expect(await prisma.projectStatus.findUnique({ where: { id: backlogId } })).not.toBeNull()

    const activity = await prisma.taskActivity.findFirst({
      where: { task_id: task.id, type: 'status_changed' },
      orderBy: { created_at: 'desc' },
    })
    expect(activity?.from_value).toBe(backlogId)
    expect(activity?.to_value).toBe(doneId)
  })

  it('recusa excluir um status usando ele mesmo como destino', async () => {
    await expect(deleteStatus(projectId, backlogId, userId, { reassignToId: backlogId })).rejects.toThrow(/diferente do que está sendo excluído/)
  })

  it('recusa excluir com destino de outro projeto', async () => {
    const other = await prisma.project.create({ data: { name: `Outro2 ${Date.now()}`, owner_id: userId } })
    const foreignStatus = await prisma.projectStatus.create({
      data: { project_id: other.id, name: 'Externo', color: '#000', category: 'open', position: 0 },
    })
    await expect(deleteStatus(projectId, backlogId, userId, { reassignToId: foreignStatus.id })).rejects.toThrow(/destino inválido/)
    await prisma.projectStatus.delete({ where: { id: foreignStatus.id } })
    await prisma.project.delete({ where: { id: other.id } })
  })
})
