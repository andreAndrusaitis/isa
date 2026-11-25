import { z } from 'zod'
import prisma from '../config/prisma'
import { runAutomationsFor } from './automations'
import { fireProjectWebhook, webhookTask } from './projectWebhooks'
import { AppError } from '../middlewares/errorHandler'

export const createCommentSchema = z.object({
  body: z.string().min(1),
  mentionedUserIds: z.array(z.string().uuid()).default([]),
})

export async function createComment(taskId: string, authorId: string, data: z.infer<typeof createCommentSchema>) {
  const { comment, task } = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } })
    // Menção vira notificação com o texto do comentário: não sai do projeto.
    const others = [...new Set(data.mentionedUserIds)].filter((userId) => userId !== authorId)
    if (others.length > 0) {
      const members = await tx.projectMember.count({ where: { project_id: task.project_id, user_id: { in: others } } })
      if (members !== others.length) throw new AppError(400, 'Só membros do projeto podem ser mencionados.', 'MENTION_NOT_MEMBER')
    }
    const comment = await tx.taskComment.create({ data: { task_id: taskId, author_id: authorId, body: data.body } })

    if (data.mentionedUserIds.length > 0) {
      await tx.mention.createMany({
        data: data.mentionedUserIds.map((userId) => ({ comment_id: comment.id, mentioned_id: userId })),
      })
      for (const userId of data.mentionedUserIds) {
        if (userId === authorId) continue
        await tx.notification.create({
          data: {
            user_id: userId,
            task_id: taskId,
            type: 'task_updated',
            title: `Você foi mencionado na tarefa #${task.seq}`,
            body: data.body,
          },
        })
      }
    }

    return { comment, task }
  })

  // Fora da transação: ações de automação (ex: change_status) chamam
  // updateTask, que abre sua própria $transaction — evita aninhamento.
  fireProjectWebhook('comment.created', task.project_id, authorId, { task: webhookTask(task), comment: webhookComment(comment) })
  await runAutomationsFor('comment_created', task, { actorId: authorId, depth: 0 })

  return comment
}

function webhookComment(c: { id: string; body: string; author_id: string }) {
  return { id: c.id, body: c.body, authorId: c.author_id }
}

export const editCommentSchema = z.object({ body: z.string().min(1) })

/** Comentário vivo da task (excluído = 404, como se não existisse). */
async function findComment(taskId: string, commentId: string) {
  const comment = await prisma.taskComment.findFirst({ where: { id: commentId, task_id: taskId, deleted_at: null }, include: { task: true } })
  if (!comment) throw new AppError(404, 'Comentário não encontrado', 'NOT_FOUND')
  return comment
}

export async function listComments(taskId: string) {
  return prisma.taskComment.findMany({ where: { task_id: taskId, deleted_at: null }, orderBy: { created_at: 'asc' } })
}

/** Só o autor edita o que escreveu. */
export async function editComment(taskId: string, commentId: string, actorId: string, body: string) {
  const current = await findComment(taskId, commentId)
  if (current.author_id !== actorId) throw new AppError(403, 'Só o autor pode editar o comentário.', 'COMMENT_NOT_AUTHOR')
  const comment = await prisma.taskComment.update({ where: { id: commentId }, data: { body, edited_at: new Date() } })
  fireProjectWebhook('comment.updated', current.task.project_id, actorId, { task: webhookTask(current.task), comment: webhookComment(comment) })
  return comment
}

/** Exclui (soft): o autor, ou quem configura o projeto (dono/gerente) para moderar. */
export async function deleteComment(taskId: string, commentId: string, actorId: string, canModerate: boolean) {
  const current = await findComment(taskId, commentId)
  if (current.author_id !== actorId && !canModerate) throw new AppError(403, 'Só o autor ou o dono/gerente do projeto pode excluir o comentário.', 'COMMENT_NOT_AUTHOR')
  await prisma.taskComment.update({ where: { id: commentId }, data: { deleted_at: new Date() } })
  fireProjectWebhook('comment.deleted', current.task.project_id, actorId, { task: webhookTask(current.task), comment: { id: current.id, authorId: current.author_id } })
}
