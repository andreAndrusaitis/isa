import { z } from 'zod'
import prisma from '../config/prisma'
import { logTaskActivity } from './taskActivity'
import { AppError } from '../middlewares/errorHandler'

export const createTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
})

export async function createTag(projectId: string, data: z.infer<typeof createTagSchema>) {
  return prisma.tag.create({ data: { project_id: projectId, name: data.name, color: data.color } })
}

export async function listTags(projectId: string) {
  return prisma.tag.findMany({ where: { project_id: projectId } })
}

/** Lista da tela de configuração: inclui em quantas tasks cada tag está, para avisar antes de excluir. */
export async function listTagsWithUsage(projectId: string) {
  const tags = await prisma.tag.findMany({ where: { project_id: projectId }, include: { _count: { select: { tasks: true } } } })
  return tags.map(({ _count, ...tag }) => ({ ...tag, taskCount: _count.tasks }))
}

/** Exclui a tag do projeto: ela sai de todas as tasks, e cada uma registra a saída no histórico. */
export async function deleteTag(projectId: string, tagId: string, actorId: string) {
  const tag = await prisma.tag.findFirst({ where: { id: tagId, project_id: projectId }, include: { tasks: { select: { task_id: true } } } })
  if (!tag) throw new AppError(404, 'Tag não encontrada neste projeto', 'NOT_FOUND')
  await prisma.$transaction([
    prisma.taskTag.deleteMany({ where: { tag_id: tagId } }),
    prisma.tag.delete({ where: { id: tagId } }),
  ])
  for (const { task_id } of tag.tasks) await logTaskActivity(task_id, actorId, 'tag_changed', { from: tag.name })
  return { removedFrom: tag.tasks.length }
}

export async function addTagToTask(taskId: string, tagId: string, actorId?: string) {
  const link = await prisma.taskTag.create({ data: { task_id: taskId, tag_id: tagId }, include: { tag: { select: { name: true } } } })
  if (actorId) await logTaskActivity(taskId, actorId, 'tag_changed', { to: link.tag.name })
  return link
}

export async function removeTagFromTask(taskId: string, tagId: string, actorId?: string) {
  const link = await prisma.taskTag.delete({ where: { task_id_tag_id: { task_id: taskId, tag_id: tagId } }, include: { tag: { select: { name: true } } } })
  if (actorId) await logTaskActivity(taskId, actorId, 'tag_changed', { from: link.tag.name })
}
