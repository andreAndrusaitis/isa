import prisma from '../config/prisma'
import { updateTask } from './tasks'
import { createComment } from './taskComments'
import { requestApproval } from './taskApprovals'
import { fireProjectWebhook, webhookTask } from './projectWebhooks'
import { AutomationTrigger, AutomationRunStatus, Task } from '@prisma/client'

const MAX_AUTOMATION_DEPTH = 5

function webhookAutomation(a: { id: string; name: string; trigger: string }) {
  return { id: a.id, name: a.name, trigger: a.trigger }
}

interface AutomationCondition {
  field: string
  operator: 'equals' | 'not_equals'
  value: string
}

type AutomationAction =
  | { type: 'change_status'; statusId: string }
  | { type: 'change_assignee'; assigneeId: string }
  | { type: 'change_priority'; priority: 'critical' | 'high' | 'normal' | 'low' | 'none' }
  | { type: 'add_tag'; tagId: string }
  | { type: 'send_notification'; userId: string; message: string }
  | { type: 'request_approval'; approverId: string }
  | { type: 'move_list'; listId: string }
  | { type: 'add_comment'; body: string }

interface RunContext {
  actorId: string
  depth: number
  /**
   * IDs de automação já executados nesta cadeia causal (um evento do
   * usuário disparando automação A, que muda a task e dispara
   * runAutomationsFor de novo). Sem isso, uma automação que muda o
   * próprio campo que a disparou (ex: "quando status muda, mudar
   * status") roda duas vezes para o mesmo evento: uma vez pela chamada
   * original, outra pelo re-disparo que sua própria mudança causa.
   */
  triggeredAutomationIds?: Set<string>
}

function evaluateCondition(task: Task, condition: AutomationCondition): boolean {
  const taskValue = (task as unknown as Record<string, unknown>)[condition.field]
  if (condition.operator === 'equals') return String(taskValue) === condition.value
  return String(taskValue) !== condition.value
}

function evaluateConditions(task: Task, conditions: unknown): boolean {
  if (!conditions) return true
  const list = conditions as AutomationCondition[]
  return list.every((c) => evaluateCondition(task, c))
}

async function executeAction(action: AutomationAction, task: Task, actorId: string, depth: number, triggeredAutomationIds: Set<string>): Promise<void> {
  switch (action.type) {
    case 'change_status':
      await updateTask(task.id, actorId, { statusId: action.statusId }, depth + 1, triggeredAutomationIds)
      return
    case 'change_assignee':
      await updateTask(task.id, actorId, { assigneeId: action.assigneeId }, depth + 1, triggeredAutomationIds)
      return
    case 'change_priority':
      await updateTask(task.id, actorId, { priority: action.priority }, depth + 1, triggeredAutomationIds)
      return
    case 'move_list':
      await updateTask(task.id, actorId, { listId: action.listId }, depth + 1, triggeredAutomationIds)
      return
    case 'add_tag':
      await prisma.taskTag.create({ data: { task_id: task.id, tag_id: action.tagId } })
      return
    case 'add_comment':
      await createComment(task.id, actorId, { body: action.body, mentionedUserIds: [] })
      return
    case 'request_approval':
      await requestApproval(task.id, { approverId: action.approverId }, actorId)
      return
    case 'send_notification':
      await prisma.notification.create({
        data: {
          user_id: action.userId,
          task_id: task.id,
          type: 'task_updated',
          title: `Automação: tarefa #${task.seq}`,
          body: action.message,
        },
      })
      return
  }
}

/**
 * Ponto único de disparo de automações. Chamado a partir dos services que
 * já centralizam escrita (updateTask, createComment, decideApproval) —
 * nunca espalhado em controllers.
 *
 * Cada ação reusa o service da ação manual equivalente, nunca grava campo
 * direto — automação não deve ter um caminho de escrita diferente do
 * manual (evita burlar a regra de negócio).
 */
export async function runAutomationsFor(trigger: AutomationTrigger, task: Task, context: RunContext): Promise<void> {
  const ctx = { ...context, triggeredAutomationIds: context.triggeredAutomationIds ?? new Set<string>() }
  await runRules(trigger, task, ctx)
  // Etapa com aprovação só conclui quando aprovada: aí a decisão dispara a conclusão.
  if (trigger === 'status_changed' || trigger === 'approval_decided') await runCompletionTriggers(task, ctx)
}

/**
 * Conclusão não tem atividade própria: sai da mudança de status. Task que
 * (ainda) está numa etapa "done" dispara task_completed; se era a última
 * subtask aberta do pai, o pai dispara subtasks_completed (mesma regra de
 * pendência da conclusão: concluída ou cancelada fecha).
 */
async function runCompletionTriggers(changed: Task, ctx: RunContext & { triggeredAutomationIds: Set<string> }) {
  const triggers = new Set((await prisma.automation.findMany({
    where: { project_id: changed.project_id, trigger: { in: ['task_completed', 'subtasks_completed'] }, is_active: true },
    select: { trigger: true },
  })).map((a) => a.trigger))
  if (triggers.size === 0) return
  // Relê: uma automação de status_changed pode já ter tirado a task da conclusão.
  const task = await prisma.task.findUnique({ where: { id: changed.id }, include: { status: { select: { category: true, requires_approval: true } } } })
  if (!task || task.status.category !== 'done') return
  if (task.status.requires_approval && !(await prisma.approval.count({ where: { task_id: task.id, status: 'approved' } }))) return
  if (triggers.has('task_completed')) await runRules('task_completed', task, ctx)
  if (!task.parent_id || !triggers.has('subtasks_completed')) return
  const open = await prisma.task.count({ where: { parent_id: task.parent_id, archived_at: null, status: { category: { notIn: ['done', 'cancelled'] } } } })
  if (open > 0) return
  const parent = await prisma.task.findUnique({ where: { id: task.parent_id } })
  if (parent && !parent.archived_at) await runRules('subtasks_completed', parent, ctx)
}

async function runRules(trigger: AutomationTrigger, task: Task, context: RunContext & { triggeredAutomationIds: Set<string> }): Promise<void> {
  const { triggeredAutomationIds } = context

  const automations = await prisma.automation.findMany({
    where: { project_id: task.project_id, trigger, is_active: true },
  })

  for (const automation of automations) {
    // Já rodou nesta cadeia causal — evita que a automação dispare de
    // novo para o mesmo evento por causa da própria mudança que ela fez
    // (ex: "quando status muda, mudar status" rodaria 2x pro mesmo clique).
    if (triggeredAutomationIds.has(automation.id)) continue

    if (context.depth >= MAX_AUTOMATION_DEPTH) {
      await prisma.automationRun.create({
        data: {
          automation_id: automation.id,
          task_id: task.id,
          status: 'error' as AutomationRunStatus,
          error_message: 'Limite de encadeamento de automações atingido',
        },
      })
      continue
    }

    if (!evaluateConditions(task, automation.conditions)) {
      await prisma.automationRun.create({
        data: { automation_id: automation.id, task_id: task.id, status: 'skipped' as AutomationRunStatus },
      })
      continue
    }

    triggeredAutomationIds.add(automation.id)

    try {
      const actions = automation.actions as unknown as AutomationAction[]
      for (const action of actions) {
        await executeAction(action, task, context.actorId, context.depth, triggeredAutomationIds)
      }
      await prisma.automationRun.create({
        data: { automation_id: automation.id, task_id: task.id, status: 'success' as AutomationRunStatus },
      })
      fireProjectWebhook('automation.executed', task.project_id, context.actorId, { task: webhookTask(task), automation: webhookAutomation(automation) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.automationRun.create({
        data: {
          automation_id: automation.id,
          task_id: task.id,
          status: 'error' as AutomationRunStatus,
          error_message: message,
        },
      })
      fireProjectWebhook('automation.failed', task.project_id, context.actorId, { task: webhookTask(task), automation: webhookAutomation(automation), error: message })
    }
  }
}
