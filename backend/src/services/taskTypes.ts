import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { assertPrefixAvailable, derivePrefix, allocateTypeNumber, PREFIX_PATTERN } from './taskTypeKeys'

// Lista fechada de ícones lucide-react permitidos — evita salvar um nome
// que o frontend não sabe renderizar (ver TASK_TYPE_ICON_MAP em
// frontend/src/components/projects/TaskTypeManager.tsx).
export const TASK_TYPE_ICONS = [
  'BookmarkCheck', 'Bug', 'CheckSquare', 'Zap',
  'Flag', 'Milestone', 'AlertCircle', 'Package', 'Layers', 'Puzzle',
  'Sparkles', 'FlaskConical', 'FileText',
] as const

const prefixSchema = z.string().trim().transform((v) => v.toUpperCase()).pipe(z.string().regex(PREFIX_PATTERN, 'Prefixo inválido'))

export const createTaskTypeSchema = z.object({
  name: z.string().min(1),
  icon: z.enum(TASK_TYPE_ICONS),
  color: z.string().min(1),
  prefix: prefixSchema.optional(),
})

export const updateTaskTypeSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.enum(TASK_TYPE_ICONS).optional(),
  color: z.string().min(1).optional(),
  prefix: prefixSchema.optional(),
})

export const deleteTaskTypeSchema = z.object({
  replacementTypeId: z.string().uuid().optional(),
})

/** Sem prefixo informado, deriva do nome e, se já existir, numera (DOCU, DOCU2…). */
async function suggestPrefix(projectId: string, name: string) {
  const base = derivePrefix(name)
  const taken = new Set((await prisma.taskType.findMany({
    where: { project_id: projectId, is_active: true }, select: { prefix: true },
  })).map((t) => t.prefix))
  if (!taken.has(base)) return base
  for (let i = 2; i < 100; i++) if (!taken.has(`${base.slice(0, 6)}${i}`)) return `${base.slice(0, 6)}${i}`
  throw new AppError(409, 'Não foi possível gerar um prefixo livre; informe um.', 'PREFIX_TAKEN')
}

export async function createTaskType(projectId: string, data: z.infer<typeof createTaskTypeSchema>) {
  const prefix = data.prefix ?? await suggestPrefix(projectId, data.name)
  if (data.prefix) await assertPrefixAvailable(projectId, prefix)
  const count = await prisma.taskType.count({ where: { project_id: projectId, is_active: true } })
  return prisma.taskType.create({
    data: { project_id: projectId, name: data.name, icon: data.icon, color: data.color, prefix, position: count },
  })
}

export async function listTaskTypes(projectId: string) {
  return prisma.taskType.findMany({ where: { project_id: projectId, is_active: true }, orderBy: { position: 'asc' } })
}

export async function updateTaskType(projectId: string, taskTypeId: string, data: z.infer<typeof updateTaskTypeSchema>) {
  const current = await prisma.taskType.findFirst({ where: { id: taskTypeId, project_id: projectId, is_active: true } })
  if (!current) throw new AppError(404, 'Tipo de tarefa não encontrado', 'NOT_FOUND')
  const prefixChanged = data.prefix !== undefined && data.prefix !== current.prefix
  if (prefixChanged) await assertPrefixAvailable(projectId, data.prefix!, taskTypeId)

  return prisma.$transaction(async (tx) => {
    const updated = await tx.taskType.update({
      where: { id: taskTypeId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(prefixChanged ? { prefix: data.prefix } : {}),
      },
    })
    // O número de cada task é mantido; só a chave muda de BUG-12 para DEF-12.
    if (prefixChanged) {
      await tx.$executeRaw`UPDATE "tasks" SET "key" = ${data.prefix} || '-' || "type_number" WHERE "task_type_id" = ${taskTypeId} AND "type_number" IS NOT NULL`
    }
    return updated
  })
}

/**
 * Exclui um tipo (soft delete). Tipo é obrigatório na task, então as tasks
 * dele vão para outro tipo — o escolhido ou "Tarefa" — e ganham ID novo nele.
 * O último tipo ativo do projeto não pode ser excluído.
 */
export async function deleteTaskType(projectId: string, taskTypeId: string, replacementTypeId?: string) {
  const taskType = await prisma.taskType.findFirst({ where: { id: taskTypeId, project_id: projectId, is_active: true } })
  if (!taskType) throw new AppError(404, 'Tipo de tarefa não encontrado', 'NOT_FOUND')

  const others = await prisma.taskType.findMany({
    where: { project_id: projectId, is_active: true, id: { not: taskTypeId } },
    orderBy: { position: 'asc' },
  })
  if (others.length === 0) throw new AppError(400, 'O projeto precisa de pelo menos um tipo de tarefa.', 'LAST_TASK_TYPE')
  const target = replacementTypeId
    ? others.find((t) => t.id === replacementTypeId)
    : others.find((t) => t.prefix === 'TASK') ?? others[0]
  if (!target) throw new AppError(400, 'Tipo de destino inválido para este projeto.', 'INVALID_TASK_TYPE')

  await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({ where: { task_type_id: taskTypeId }, select: { id: true }, orderBy: { seq: 'asc' } })
    for (const task of tasks) {
      const { number, key } = await allocateTypeNumber(tx, target.id)
      await tx.task.update({ where: { id: task.id }, data: { task_type_id: target.id, type_number: number, key } })
    }
    await tx.taskType.update({ where: { id: taskTypeId }, data: { is_active: false } })
  }, { timeout: 60_000 })
  return { movedTo: target.id }
}
