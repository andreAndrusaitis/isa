import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { updateTask } from './tasks'
import { emitProjectWebhook, webhookTask } from './projectWebhooks'

export const setAssigneesSchema = z.object({
  userIds: z.array(z.string().uuid()),
})

/**
 * Substitui a lista completa de responsáveis da task; o primeiro é o
 * principal (Task.assignee_id, que Kanban/Lista leem). A troca do principal
 * passa por updateTask (histórico, notificação, webhook, automação) e o
 * conjunto vira atividade assignees_changed — é dela que o tempo da task
 * sai para todos os responsáveis (taskTime).
 */
export async function setAssignees(taskId: string, actorId: string, userIds: string[]) {
  const unique = [...new Set(userIds)]
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { id: true, seq: true, title: true, key: true, project_id: true, assignee_id: true } })
  // Só membros do projeto da task podem ser responsáveis (antes qualquer id passava).
  if (unique.length > 0) {
    const members = await prisma.projectMember.count({ where: { project_id: task.project_id, user_id: { in: unique } } })
    if (members !== unique.length) throw new AppError(400, 'Responsável precisa ser membro do projeto.', 'ASSIGNEE_NOT_MEMBER')
  }
  const before = await currentAssignees(taskId, task.assignee_id)

  const primary = unique[0] ?? null
  if (primary !== task.assignee_id) await updateTask(taskId, actorId, { assigneeId: primary })

  const setChanged = [...before].sort().join(',') !== [...unique].sort().join(',')
  await prisma.$transaction(async (tx) => {
    await tx.taskAssignee.deleteMany({ where: { task_id: taskId } })
    if (unique.length > 0) {
      await tx.taskAssignee.createMany({ data: unique.map((userId) => ({ task_id: taskId, user_id: userId })) })
    }
    if (setChanged) {
      await tx.taskActivity.create({
        data: { task_id: taskId, actor_id: actorId, type: 'assignees_changed', from_value: before.join(',') || null, to_value: unique.join(',') || null },
      })
    }
  })
  // Troca do principal já saiu pelo updateTask; aqui só a mudança que ficou nos co-responsáveis.
  if (setChanged && primary === task.assignee_id) {
    const data = { task: webhookTask(task), changes: { assignees: { from: before, to: unique } } }
    void emitProjectWebhook('task.updated', { projectId: task.project_id, actor: { id: actorId }, data })
    void emitProjectWebhook('task.assignee_changed', { projectId: task.project_id, actor: { id: actorId }, data })
  }
  return unique
}

/** Principal primeiro; task antiga pode ter só assignee_id, sem linha em task_assignees. */
async function currentAssignees(taskId: string, primaryId: string | null) {
  const rows = await prisma.taskAssignee.findMany({ where: { task_id: taskId }, select: { user_id: true } })
  return [...new Set([...(primaryId ? [primaryId] : []), ...rows.map((r) => r.user_id)])]
}

export async function listAssignees(taskId: string) {
  const rows = await prisma.taskAssignee.findMany({ where: { task_id: taskId } })
  return rows.map((r) => r.user_id)
}
