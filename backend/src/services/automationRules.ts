import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('change_status'), statusId: z.string() }),
  z.object({ type: z.literal('change_assignee'), assigneeId: z.string() }),
  z.object({ type: z.literal('change_priority'), priority: z.enum(['critical', 'high', 'normal', 'low', 'none']) }),
  z.object({ type: z.literal('add_tag'), tagId: z.string() }),
  z.object({ type: z.literal('send_notification'), userId: z.string(), message: z.string() }),
  z.object({ type: z.literal('request_approval'), approverId: z.string() }),
  z.object({ type: z.literal('move_list'), listId: z.string() }),
  z.object({ type: z.literal('add_comment'), body: z.string() }),
])

const conditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals']),
  value: z.string(),
})

export const createAutomationSchema = z.object({
  name: z.string().min(1),
  trigger: z.enum([
    'task_created', 'status_changed', 'assignee_changed', 'due_date_reached',
    'task_overdue', 'task_completed', 'subtasks_completed', 'priority_changed',
    'approval_decided', 'comment_created',
  ]),
  conditions: z.array(conditionSchema).optional(),
  actions: z.array(actionSchema).min(1),
})

// Sem disparo no sistema (precisariam de um job de prazo). Regras antigas com eles continuam listadas.
const UNSUPPORTED_TRIGGERS: Record<string, string> = {
  due_date_reached: 'Prazo atingido',
  task_overdue: 'Task atrasada',
}

/** Referências das ações precisam ser deste projeto: etiqueta do projeto, notificação só para membro. */
async function assertValidRule(projectId: string, data: z.infer<typeof createAutomationSchema>) {
  const label = UNSUPPORTED_TRIGGERS[data.trigger]
  if (label) throw new AppError(400, `O gatilho "${label}" ainda não é disparado pelo sistema. Escolha outro gatilho.`, 'UNSUPPORTED_TRIGGER')

  const tagIds = [...new Set(data.actions.flatMap((a) => (a.type === 'add_tag' ? [a.tagId] : [])))]
  if (tagIds.length) {
    const found = await prisma.tag.count({ where: { id: { in: tagIds }, project_id: projectId } })
    if (found !== tagIds.length) throw new AppError(400, 'A etiqueta da ação "Adicionar etiqueta" não existe neste projeto.', 'INVALID_AUTOMATION_TAG')
  }
  const userIds = [...new Set(data.actions.flatMap((a) => (a.type === 'send_notification' ? [a.userId] : [])))]
  if (userIds.length) {
    const found = await prisma.projectMember.count({ where: { project_id: projectId, user_id: { in: userIds } } })
    if (found !== userIds.length) throw new AppError(400, 'A notificação da automação só pode ir para um membro do projeto.', 'INVALID_AUTOMATION_RECIPIENT')
  }
}

export async function createAutomation(projectId: string, creatorId: string, data: z.infer<typeof createAutomationSchema>) {
  await assertValidRule(projectId, data)
  return prisma.automation.create({
    data: {
      project_id: projectId,
      name: data.name,
      trigger: data.trigger,
      conditions: data.conditions ?? undefined,
      actions: data.actions,
      created_by: creatorId,
    },
  })
}

export async function listAutomations(projectId: string) {
  return prisma.automation.findMany({ where: { project_id: projectId }, orderBy: { created_at: 'desc' } })
}

export const updateAutomationSchema = z.object({
  isActive: z.boolean(),
})

export async function setAutomationActive(automationId: string, isActive: boolean) {
  return prisma.automation.update({ where: { id: automationId }, data: { is_active: isActive } })
}

export async function listAutomationRuns(automationId: string) {
  return prisma.automationRun.findMany({ where: { automation_id: automationId }, orderBy: { executed_at: 'desc' } })
}
