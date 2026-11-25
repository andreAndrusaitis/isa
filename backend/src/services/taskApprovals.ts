import { z } from 'zod'
import { logTaskActivity } from './taskActivity'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { logger } from '../utils/logger'
import { updateTask } from './tasks'
import { runAutomationsFor } from './automations'
import { fireProjectWebhook, fireTaskWebhook, webhookTask } from './projectWebhooks'
import { resolveTicketsOfDoneTask } from './ticketTaskLink'
import { spawnOnComplete } from './taskCollab'

export const requestApprovalSchema = z.object({
  approverId: z.string().uuid(),
})

/**
 * Aprovador precisa poder decidir: dono do projeto ou membro que edita (a rota de
 * decisão barra leitor e quem está fora, e a aprovação ficaria pendente para sempre,
 * travando a conclusão). Membro comum não aprova o que ele mesmo pediu; dono e
 * gerente podem, porque configuram a etapa.
 */
export async function assertValidApprover(taskId: string, approverId: string, actorId?: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { project_id: true, project: { select: { owner_id: true } } } })
  if (approverId === task.project.owner_id) return
  const member = await prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: task.project_id, user_id: approverId } }, select: { role: true } })
  if (!member || member.role === 'viewer') throw new AppError(400, 'O aprovador precisa ser membro do projeto.', 'APPROVER_NOT_MEMBER')
  if (approverId === actorId && member.role === 'member') {
    throw new AppError(400, 'Quem pede a aprovação não pode ser o aprovador. Indique outro membro do projeto.', 'APPROVER_IS_REQUESTER')
  }
}

export async function requestApproval(taskId: string, data: z.infer<typeof requestApprovalSchema>, actorId?: string) {
  await assertValidApprover(taskId, data.approverId, actorId)
  const approval = await prisma.approval.create({ data: { task_id: taskId, approver_id: data.approverId } })
  if (actorId) await logTaskActivity(taskId, actorId, 'approval_requested', { to: data.approverId })
  fireTaskWebhook('approval.requested', taskId, actorId, { approval: webhookApproval(approval) })
  return approval
}

function webhookApproval(a: { id: string; approver_id: string; status: string; comment: string | null }) {
  return { id: a.id, approverId: a.approver_id, status: a.status, comment: a.comment }
}

export const decideApprovalSchema = z.object({
  status: z.enum(['approved', 'changes_requested']),
  comment: z.string().optional(),
  targetStatusId: z.string().uuid().optional(),
}).refine((data) => data.status !== 'changes_requested' || !!data.comment, {
  message: 'Comentário é obrigatório ao solicitar alterações',
  path: ['comment'],
})

/**
 * Decide uma aprovação. Se aprovada e um targetStatusId for informado,
 * a movimentação de status passa pelo updateTask centralizado — nunca
 * grava status_id diretamente aqui (mesma regra de "único ponto de
 * escrita").
 *
 * Só o aprovador indicado decide, e uma vez só. Sem exceção para admin:
 * no módulo ele só tem leitura.
 */
export async function decideApproval(approvalId: string, actorId: string, data: z.infer<typeof decideApprovalSchema>) {
  const approval = await prisma.approval.findUnique({ where: { id: approvalId } })
  if (!approval) throw new AppError(404, 'Aprovação não encontrada', 'NOT_FOUND')
  if (approval.approver_id !== actorId) {
    throw new AppError(403, 'Só o aprovador indicado pode decidir esta aprovação.', 'APPROVAL_NOT_APPROVER')
  }

  // Condicional ao status pendente: duas decisões simultâneas não passam as duas.
  const updated = await prisma.approval.update({
    where: { id: approvalId, approver_id: actorId, status: 'pending' },
    data: { status: data.status, comment: data.comment ?? null, decided_at: new Date() },
  }).catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(409, 'Esta aprovação já foi decidida.', 'APPROVAL_ALREADY_DECIDED')
    }
    throw err
  })

  await logTaskActivity(approval.task_id, actorId, 'approval_decided', { to: data.status })

  if (data.status === 'approved' && data.targetStatusId) {
    await updateTask(approval.task_id, actorId, { statusId: data.targetStatusId })
  }

  const task = await prisma.task.findUniqueOrThrow({ where: { id: approval.task_id }, include: { status: true } })
  fireProjectWebhook(data.status === 'approved' ? 'approval.approved' : 'approval.rejected', task.project_id, actorId, { task: webhookTask(task), approval: webhookApproval(updated) })
  // Status de conclusão que exige aprovação: a task só conclui de fato aqui (updateTask não dispara para ele):
  // aviso de conclusão, chamados vinculados resolvidos e próxima ocorrência da recorrência.
  if (data.status === 'approved' && task.status?.category === 'done' && task.status.requires_approval) {
    fireProjectWebhook('task.completed', task.project_id, actorId, { task: webhookTask(task), status: { id: task.status.id, name: task.status.name } })
    await resolveTicketsOfDoneTask(task.id, actorId, { approved: true })
      .catch((err) => logger.error(`[Projetos] resolver chamados da task ${task.id} falhou: ${err?.message ?? err}`))
    await spawnOnComplete(task.id)
      .catch((err) => logger.error(`[Projetos] próxima ocorrência da task ${task.id} falhou: ${err?.message ?? err}`))
  }
  await runAutomationsFor('approval_decided', task, { actorId, depth: 0 })

  return updated
}
