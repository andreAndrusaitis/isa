import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'

export const createFolderSchema = z.object({
  name: z.string().min(1),
})

export const createListSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
})

export const createStatusSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  category: z.enum(['backlog', 'open', 'in_progress', 'in_review', 'done', 'cancelled']),
  wipLimit: z.number().int().positive().nullable().optional(),
  // id do status logo antes de onde o novo deve entrar; omitido = insere no fim.
  afterId: z.string().uuid().optional(),
})

export async function createFolder(projectId: string, data: z.infer<typeof createFolderSchema>) {
  const count = await prisma.projectFolder.count({ where: { project_id: projectId } })
  return prisma.projectFolder.create({ data: { project_id: projectId, name: data.name, position: count } })
}

export async function listFolders(projectId: string) {
  return prisma.projectFolder.findMany({ where: { project_id: projectId, archived_at: null }, orderBy: { position: 'asc' } })
}

export async function createList(projectId: string, data: z.infer<typeof createListSchema>) {
  const count = await prisma.projectList.count({ where: { project_id: projectId } })
  return prisma.projectList.create({
    data: {
      project_id: projectId,
      name: data.name,
      description: data.description ?? null,
      folder_id: data.folderId ?? null,
      position: count,
    },
  })
}

export async function listLists(projectId: string) {
  return prisma.projectList.findMany({ where: { project_id: projectId, archived_at: null }, orderBy: { position: 'asc' } })
}

export async function createStatus(projectId: string, data: z.infer<typeof createStatusSchema>) {
  // afterId ("add QA entre Backlog e X"): insere logo depois do status
  // indicado, reindexando os que vêm depois, em vez de sempre no fim da lista.
  return prisma.$transaction(async (tx) => {
    const statuses = await tx.projectStatus.findMany({
      where: { project_id: projectId, is_active: true },
      orderBy: { position: 'asc' },
    })

    const afterIndex = data.afterId ? statuses.findIndex((s) => s.id === data.afterId) : statuses.length - 1
    if (data.afterId && afterIndex < 0) throw new AppError(400, 'O status de referência (afterId) não existe neste projeto.', 'STATUS_NOT_FOUND')
    const insertPosition = afterIndex + 1

    for (const status of statuses.slice(insertPosition)) {
      await tx.projectStatus.update({ where: { id: status.id }, data: { position: status.position + 1 } })
    }

    return tx.projectStatus.create({
      data: { project_id: projectId, name: data.name, color: data.color, category: data.category, position: insertPosition, wip_limit: data.wipLimit ?? null },
    })
  })
}

export async function listStatuses(projectId: string) {
  return prisma.projectStatus.findMany({ where: { project_id: projectId, is_active: true }, orderBy: { position: 'asc' } })
}

export const updateStatusSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  category: z.enum(['backlog', 'open', 'in_progress', 'in_review', 'done', 'cancelled']).optional(),
  requiresApproval: z.boolean().optional(),
  wipLimit: z.number().int().positive().nullable().optional(),
})

export async function updateStatus(projectId: string, statusId: string, data: z.infer<typeof updateStatusSchema>) {
  const updated = await prisma.projectStatus.updateMany({
    where: { id: statusId, project_id: projectId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.requiresApproval !== undefined ? { requires_approval: data.requiresApproval } : {}),
      ...(data.wipLimit !== undefined ? { wip_limit: data.wipLimit } : {}),
    },
  })
  if (updated.count === 0) throw new AppError(404, 'Status não encontrado', 'NOT_FOUND')
  return prisma.projectStatus.findUniqueOrThrow({ where: { id: statusId } })
}

export const reorderStatusesSchema = z.object({
  // lista completa de ids na nova ordem — mais simples e menos propenso a
  // erro do que aceitar um único move (from/to) e recalcular no servidor.
  statusIds: z.array(z.string().uuid()).min(1),
})

export async function reorderStatuses(projectId: string, data: z.infer<typeof reorderStatusesSchema>) {
  const existing = await prisma.projectStatus.findMany({
    where: { project_id: projectId, is_active: true },
    select: { id: true },
  })
  const existingIds = new Set(existing.map((s) => s.id))

  if (data.statusIds.length !== existing.length || !data.statusIds.every((id) => existingIds.has(id))) {
    throw new AppError(400, 'A lista deve conter exatamente os status ativos do projeto', 'STATUS_REORDER_MISMATCH')
  }

  await prisma.$transaction(
    data.statusIds.map((id, index) => prisma.projectStatus.update({ where: { id }, data: { position: index } })),
  )

  return listStatuses(projectId)
}

export const deleteStatusSchema = z.object({
  // Para onde vão as tasks que estavam neste status — obrigatório: não faz
  // sentido apagar um status e deixar tasks "órfãs" sem status_id válido.
  reassignToId: z.string().uuid(),
})

/**
 * Exclui um status do projeto. Tasks nele são realocadas para reassignToId
 * antes da exclusão (nunca ficam sem status — a FK obrigaria de qualquer
 * forma, mas fazer explícito aqui gera o TaskActivity de cada realocação).
 */
export async function deleteStatus(projectId: string, statusId: string, actorId: string, data: z.infer<typeof deleteStatusSchema>) {
  if (statusId === data.reassignToId) {
    throw new AppError(400, 'Escolha um status diferente do que está sendo excluído', 'STATUS_DELETE_SAME_TARGET')
  }

  // Tudo na transação: lidas antes, as tasks que entrassem no status até a
  // inativação ficariam presas num status excluído.
  return prisma.$transaction(async (tx) => {
    const [status, target] = await Promise.all([
      tx.projectStatus.findFirst({ where: { id: statusId, project_id: projectId } }),
      tx.projectStatus.findFirst({ where: { id: data.reassignToId, project_id: projectId, is_active: true } }),
    ])
    if (!status) throw new AppError(404, 'Status não encontrado', 'NOT_FOUND')
    if (!target) throw new AppError(400, 'Status de destino inválido', 'STATUS_DELETE_INVALID_TARGET')

    // Inativa antes de listar as tasks: estreita a janela em que uma task ainda entra nele.
    await tx.projectStatus.update({ where: { id: statusId }, data: { is_active: false } })
    const tasksToMove = await tx.task.findMany({ where: { status_id: statusId }, select: { id: true } })
    for (const task of tasksToMove) {
      await tx.task.update({ where: { id: task.id }, data: { status_id: data.reassignToId } })
      await tx.taskActivity.create({
        data: { task_id: task.id, actor_id: actorId, type: 'status_changed', from_value: statusId, to_value: data.reassignToId },
      })
    }
    // Soft delete (is_active=false acima), não apaga a linha — mantém o histórico
    // (TaskActivity de status_changed anteriores ainda referenciam este id).
    return { movedTaskCount: tasksToMove.length }
  })
}
