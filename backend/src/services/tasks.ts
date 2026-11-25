import { z } from 'zod'
import prisma from '../config/prisma'
import { visibleProjectsWhere } from './projectAccess'
import { TaskActivityType, AutomationTrigger } from '@prisma/client'
import { getIo } from '../config/socket'
import { runAutomationsFor } from './automations'
import { emitProjectWebhook, fireProjectWebhook, webhookTask } from './projectWebhooks'
import { camelize } from '../utils/serialize'
import { AppError } from '../middlewares/errorHandler'
import { logger } from '../utils/logger'
import { resolveTicketsOfDoneTask, releaseTicketsOfTask, taskHasActiveTickets, notifyForecastChanged } from './ticketTaskLink'
import { assertRefsInProject } from '../middlewares/projectScope'
import { resolveTaskType, allocateTypeNumber } from './taskTypeKeys'
import { assertCanComplete } from './taskCompletion'
import { spawnOnComplete } from './taskCollab'

/**
 * Recorrência. `mode` define quando a próxima ocorrência nasce:
 * ao concluir (updateTask), ou na data prevista (job taskRecurrenceJob).
 */
export const recurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(365).default(1),
  mode: z.enum(['on_complete', 'on_due']).default('on_complete'),
})

export type Recurrence = z.infer<typeof recurrenceSchema>

const storyPointsSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13), z.literal(21),
]).nullable().optional()

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório'),
  description: z.string().nullable().optional(),
  statusId: z.string().uuid(),
  listId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  taskTypeId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  storyPoints: storyPointsSchema,
  priority: z.enum(['critical', 'high', 'normal', 'low', 'none']).default('none'),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  isMilestone: z.boolean().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  statusId: z.string().uuid().optional(),
  listId: z.string().uuid().nullable().optional(),
  taskTypeId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  storyPoints: storyPointsSchema,
  priority: z.enum(['critical', 'high', 'normal', 'low', 'none']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  position: z.number().int().optional(),
  isMilestone: z.boolean().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
})

type CreateTaskInput = z.input<typeof createTaskSchema>
type UpdateTaskInput = z.input<typeof updateTaskSchema>

export async function createTask(projectId: string, creatorId: string, input: CreateTaskInput) {
  await assertRefsInProject(projectId, input)
  const task = await prisma.$transaction(async (tx) => {
    const project = await tx.project.update({
      where: { id: projectId },
      data: { next_task_seq: { increment: 1 } },
      select: { next_task_seq: true },
    })
    const seq = project.next_task_seq - 1
    // Toda task tem tipo (o informado ou "Tarefa") e, com ele, o ID BUG-12/FEAT-3.
    const taskType = await resolveTaskType(tx, projectId, input.taskTypeId)
    const { number: typeNumber, key } = await allocateTypeNumber(tx, taskType.id)

    const task = await tx.task.create({
      data: {
        project_id: projectId,
        list_id: input.listId ?? null,
        status_id: input.statusId,
        parent_id: input.parentId ?? null,
        task_type_id: taskType.id,
        type_number: typeNumber,
        key,
        sprint_id: input.sprintId ?? null,
        story_points: input.storyPoints ?? null,
        seq,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'none',
        assignee_id: input.assigneeId ?? null,
        creator_id: creatorId,
        due_date: input.dueDate ? new Date(input.dueDate) : null,
        start_date: input.startDate ? new Date(input.startDate) : null,
        is_milestone: input.isMilestone ?? false,
        recurrence: (input.recurrence ?? null) as any,
      },
    })

    await tx.taskActivity.create({
      data: { task_id: task.id, actor_id: creatorId, type: 'created' as TaskActivityType },
    })
    if (task.parent_id) {
      await tx.taskActivity.create({ data: { task_id: task.parent_id, actor_id: creatorId, type: 'subtask_added', to_value: task.id } })
    }

    return task
  })

  // Fora da transação: um webhook lento/indisponível não pode segurar o commit.
  // camelize: o socket não passa pelo middleware camelizeResponses do Express
  // (esse só atua em res.json) — sem isto o frontend recebe status_id/due_date
  // em vez de statusId/dueDate e o Board não consegue agrupar a task nova.
  getIo()?.to(`project:${projectId}`).emit('task.created', { task: camelize(task) })
  fireProjectWebhook('task.created', projectId, creatorId, { task: webhookTask(task) })
  await runAutomationsFor('task_created', task, { actorId: creatorId, depth: 0 })

  return task
}

/**
 * Único ponto de escrita de task no sistema. Toda mudança de campo gera
 * uma TaskActivity com from/to — nunca um prisma.task.update direto em
 * controller (motivo estruturado, não texto
 * genérico "task atualizada").
 *
 * `automationDepth`/`triggeredAutomationIds` propagam o estado de
 * encadeamento quando esta chamada vem de dentro de uma automação
 * (executeAction → updateTask) — sem isso, cada updateTask reiniciava a
 * contagem em 0 e MAX_AUTOMATION_DEPTH nunca detectava loops reais, e a
 * mesma automação podia rodar duas vezes para o mesmo evento (uma pela
 * chamada original, outra pelo re-disparo causado por sua própria
 * mudança de campo).
 */
export async function updateTask(taskId: string, actorId: string, changes: UpdateTaskInput, automationDepth = 0, triggeredAutomationIds?: Set<string>) {
  // Chamados vinculados seguem o prazo da task: sem prazo eles ficariam sem prazo nenhum.
  if (changes.dueDate === null && await taskHasActiveTickets(taskId)) {
    throw new AppError(400, 'Esta task tem chamados vinculados, que seguem o prazo dela. Desvincule os chamados antes de remover o prazo.', 'TASK_HAS_LINKED_TICKETS')
  }
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: { status: { select: { category: true, requires_approval: true } } } })
    const refs = await assertRefsInProject(current.project_id, changes) // status/sprint/lista/tipo de outro projeto: 400

    // Entrar num status de conclusão é concluir: mesma trava do /complete, venha
    // do PATCH, do lote ou de automação (subtasks, checklist, dependências...).
    // Sair de um "done" que aguarda aprovação para outro "done" também conclui.
    const target = changes.statusId !== undefined && changes.statusId !== current.status_id ? refs?.status : null
    const wasDone = current.status?.category === 'done' && !current.status.requires_approval
    const entersDone = target?.category === 'done' && !wasDone
    if (entersDone) await assertCanComplete(taskId, tx)

    const activities: Array<{ type: TaskActivityType; from: string | null; to: string | null }> = []

    if (changes.statusId !== undefined && changes.statusId !== current.status_id) {
      activities.push({ type: 'status_changed', from: current.status_id, to: changes.statusId })
    }
    if (changes.priority !== undefined && changes.priority !== current.priority) {
      activities.push({ type: 'priority_changed', from: current.priority, to: changes.priority })
    }
    if (changes.assigneeId !== undefined && changes.assigneeId !== current.assignee_id) {
      activities.push({ type: 'assignee_changed', from: current.assignee_id, to: changes.assigneeId })
    }
    if (changes.title !== undefined && changes.title !== current.title) {
      activities.push({ type: 'title_changed', from: current.title, to: changes.title })
    }
    if (changes.description !== undefined && changes.description !== current.description) {
      activities.push({ type: 'description_changed', from: current.description, to: changes.description })
    }
    if (changes.listId !== undefined && changes.listId !== current.list_id) {
      activities.push({ type: 'moved_list', from: current.list_id, to: changes.listId })
    }
    if (changes.taskTypeId !== undefined && changes.taskTypeId !== current.task_type_id) {
      activities.push({ type: 'task_type_changed', from: current.task_type_id, to: changes.taskTypeId })
    }
    if (changes.storyPoints !== undefined && changes.storyPoints !== current.story_points) {
      activities.push({ type: 'story_points_changed', from: String(current.story_points ?? ''), to: String(changes.storyPoints ?? '') })
    }
    if (changes.sprintId !== undefined && changes.sprintId !== current.sprint_id) {
      activities.push({ type: 'sprint_changed', from: current.sprint_id, to: changes.sprintId })
    }
    const newDueDate = changes.dueDate !== undefined ? (changes.dueDate ? new Date(changes.dueDate) : null) : undefined
    if (newDueDate !== undefined && newDueDate?.getTime() !== current.due_date?.getTime()) {
      activities.push({ type: 'due_date_changed', from: current.due_date?.toISOString() ?? null, to: newDueDate?.toISOString() ?? null })
    }

    const newStartDate = changes.startDate !== undefined ? (changes.startDate ? new Date(changes.startDate) : null) : undefined
    if (newStartDate !== undefined && newStartDate?.getTime() !== current.start_date?.getTime()) {
      activities.push({ type: 'start_date_changed', from: current.start_date?.toISOString() ?? null, to: newStartDate?.toISOString() ?? null })
    }

    if (changes.isMilestone !== undefined && changes.isMilestone !== current.is_milestone) {
      activities.push({ type: 'milestone_changed', from: String(current.is_milestone), to: String(changes.isMilestone) })
    }

    // Trocar o tipo troca o ID: a task ganha o próximo número do tipo novo.
    let typeKey: { task_type_id: string; type_number: number; key: string } | undefined
    if (changes.taskTypeId !== undefined && changes.taskTypeId !== current.task_type_id) {
      if (!changes.taskTypeId) throw new AppError(400, 'O tipo da task é obrigatório.', 'TASK_TYPE_REQUIRED')
      const taskType = await resolveTaskType(tx, current.project_id, changes.taskTypeId)
      const { number, key } = await allocateTypeNumber(tx, taskType.id)
      typeKey = { task_type_id: taskType.id, type_number: number, key }
    }

    const task = await tx.task.update({
      where: { id: taskId },
      data: {
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.statusId !== undefined ? { status_id: changes.statusId } : {}),
        ...(changes.listId !== undefined ? { list_id: changes.listId } : {}),
        ...(typeKey ?? {}),
        ...(changes.sprintId !== undefined ? { sprint_id: changes.sprintId } : {}),
        ...(changes.storyPoints !== undefined ? { story_points: changes.storyPoints } : {}),
        ...(changes.priority !== undefined ? { priority: changes.priority } : {}),
        ...(changes.assigneeId !== undefined ? { assignee_id: changes.assigneeId } : {}),
        ...(newDueDate !== undefined ? { due_date: newDueDate } : {}),
        ...(changes.startDate !== undefined ? { start_date: changes.startDate ? new Date(changes.startDate) : null } : {}),
        ...(changes.position !== undefined ? { position: changes.position } : {}),
        ...(changes.isMilestone !== undefined ? { is_milestone: changes.isMilestone } : {}),
        ...(changes.recurrence !== undefined ? { recurrence: changes.recurrence as any } : {}),
      },
    })

    // task_assignees acompanha o principal: troca o antigo pelo novo; "sem responsável" esvazia.
    if (changes.assigneeId !== undefined && changes.assigneeId !== current.assignee_id) {
      if (changes.assigneeId === null) await tx.taskAssignee.deleteMany({ where: { task_id: taskId } })
      else {
        if (current.assignee_id) await tx.taskAssignee.deleteMany({ where: { task_id: taskId, user_id: current.assignee_id } })
        await tx.taskAssignee.createMany({ data: [{ task_id: taskId, user_id: changes.assigneeId }], skipDuplicates: true })
      }
    }

    for (const activity of activities) {
      await tx.taskActivity.create({
        data: { task_id: taskId, actor_id: actorId, type: activity.type, from_value: activity.from, to_value: activity.to },
      })
    }

    if (activities.length > 0) {
      getIo()?.to(`project:${task.project_id}`).emit('task.updated', { task: camelize(task), activities: camelize(activities) })

      const notifyTargets = new Set<string>()
      for (const activity of activities) {
        if (activity.type === 'assignee_changed' && activity.to) {
          notifyTargets.add(activity.to)
        }
      }
      // Notifica o responsável atual (se diferente de quem fez a mudança) —
      // mantém o motivo estruturado: uma frase por tipo de atividade, nunca
      // texto genérico "task atualizada".
      for (const targetId of notifyTargets) {
        if (targetId === actorId) continue
        const reasonLines = activities.map((a) => describeActivity(a.type))
        await tx.notification.create({
          data: {
            user_id: targetId,
            task_id: task.id,
            type: 'task_updated',
            title: `Tarefa #${task.seq} atualizada`,
            body: reasonLines.join(' '),
          },
        })
      }
    }

    // Status com aprovação só conclui de fato na decisão (taskApprovals).
    return { task, activities, completed: entersDone && !target?.requires_approval }
  })

  // Automações rodam FORA da transação de escrita: ações de automação
  // (ex: change_status) chamam de volta updateTask, que abriria uma
  // segunda $transaction — o Prisma não suporta bem transações client
  // aninhadas. Rodar depois do commit evita esse problema; o preço é que
  // uma automação nunca é atômica com a mudança que a disparou (aceitável
  // aqui — automação é reação assíncrona por natureza, não parte da
  // mesma unidade de trabalho do usuário).
  const activityToTrigger: Partial<Record<TaskActivityType, AutomationTrigger>> = {
    status_changed: 'status_changed',
    priority_changed: 'priority_changed',
    assignee_changed: 'assignee_changed',
  }
  // Ponte chamado ↔ task: task concluída resolve os chamados vinculados. Fora da
  // transação (updateTicket abre a dele); falha aqui não desfaz a task, só registra.
  if (result.activities.some((a) => a.type === 'status_changed')) {
    await resolveTicketsOfDoneTask(taskId, actorId).catch((err) => logger.error(`[Projetos] resolver chamados da task ${taskId} falhou: ${err?.message ?? err}`))
  }
  // Recorrência on_complete: a próxima ocorrência nasce na conclusão, por qualquer caminho.
  let recurrenceSpawnedId: string | null = null
  if (result.completed) {
    recurrenceSpawnedId = await spawnOnComplete(taskId).catch((err) => {
      logger.error(`[Projetos] próxima ocorrência da task ${taskId} falhou: ${err?.message ?? err}`)
      return null
    })
  }
  const dueChange = result.activities.find((a) => a.type === 'due_date_changed')
  if (dueChange) {
    await notifyForecastChanged(taskId, dueChange.from ? new Date(dueChange.from) : null, dueChange.to ? new Date(dueChange.to) : null, actorId)
      .catch((err) => logger.error(`[Projetos] avisar previsão da task ${taskId} falhou: ${err?.message ?? err}`))
  }

  for (const activity of result.activities) {
    const trigger = activityToTrigger[activity.type]
    if (trigger) {
      await runAutomationsFor(trigger, result.task, { actorId, depth: automationDepth, triggeredAutomationIds })
    }
  }

  // Webhooks: um evento específico por tipo de mudança, além do
  // task.updated genérico — quem consome status não quer filtrar payload.
  if (result.activities.length > 0) {
    void emitTaskUpdateWebhooks(result.task, result.activities, actorId)
      .catch((err) => logger.error(`[Projetos] webhooks da task ${taskId} falharam: ${err?.message ?? err}`))
  }

  return { task: result.task, activities: result.activities, recurrenceSpawnedId }
}

/** Fora do caminho da requisição: a busca dos status só serve ao webhook e não pode derrubar a edição. */
async function emitTaskUpdateWebhooks(
  task: { id: string; seq: number; title: string; key: string | null; project_id: string },
  activities: Array<{ type: TaskActivityType; from: string | null; to: string | null }>,
  actorId: string,
) {
  const summary = webhookTask(task)
  const actor = { id: actorId }
  const projectId = task.project_id
  const statusChange = activities.find((a) => a.type === 'status_changed')
  // Nome e categoria dos status: o destino não tem como traduzir o id sozinho.
  const statuses = statusChange
    ? await prisma.projectStatus.findMany({ where: { id: { in: [statusChange.from, statusChange.to].filter(Boolean) as string[] } }, select: { id: true, name: true, category: true, requires_approval: true } })
    : []
  const statusOf = (id: string | null) => statuses.find((st) => st.id === id)

  void emitProjectWebhook('task.updated', {
    projectId,
    actor,
    data: {
      task: summary,
      changes: Object.fromEntries(
        activities.map((a) => [a.type, { from: a.from, to: a.to }]),
      ),
    },
  })

  for (const activity of activities) {
    if (activity.type === 'status_changed') {
      const from = statusOf(activity.from)
      const to = statusOf(activity.to)
      void emitProjectWebhook('task.status_changed', {
        projectId,
        actor,
        data: { task: summary, changes: { status: { from: activity.from, to: activity.to, fromName: from?.name ?? null, toName: to?.name ?? null, toCategory: to?.category ?? null } } },
      })
      // Status de conclusão com aprovação só conclui de fato na decisão (taskApprovals).
      if (to?.category === 'done' && !to.requires_approval && from?.category !== 'done') {
        void emitProjectWebhook('task.completed', { projectId, actor, data: { task: summary, status: { id: to.id, name: to.name } } })
      }
    }
    if (activity.type === 'assignee_changed') {
      void emitProjectWebhook('task.assignee_changed', {
        projectId,
        actor,
        data: { task: summary, changes: { assignee: { from: activity.from, to: activity.to } } },
      })
    }
  }
}

export async function getTaskById(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      checklist: { orderBy: { position: 'asc' } },
      comments: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } },
      // Subtarefa é uma task completa (parent_id); aqui só o resumo para a seção do drawer.
      subtasks: {
        where: { archived_at: null },
        orderBy: { seq: 'asc' },
        select: { id: true, seq: true, key: true, title: true, status_id: true, assignee_id: true, due_date: true },
      },
      parent: { select: { id: true, seq: true, key: true, title: true } },
      tags: { include: { tag: true } },
      documents: { include: { document: { select: { id: true, title: true } } } },
      task_type: true,
      sprint: true,
    },
  })
}

export async function listTasksByProject(projectId: string, filters: { statusId?: string; assigneeId?: string; listId?: string } = {}) {
  const tasks = await prisma.task.findMany({
    where: {
      project_id: projectId,
      archived_at: null,
      parent_id: null,
      ...(filters.statusId ? { status_id: filters.statusId } : {}),
      ...(filters.assigneeId ? { assignee_id: filters.assigneeId } : {}),
      ...(filters.listId ? { list_id: filters.listId } : {}),
    },
    include: {
      tags: { include: { tag: true } },
      multi_assignees: { include: { user: { select: { id: true, name: true, avatar: true } } } },
      // dependências em que esta task é a bloqueada (task_id); bloqueadora arquivada não conta
      dependents: { where: { depends_on: { archived_at: null } } },
      task_type: true,
      sprint: true,
      _count: { select: { subtasks: true, comments: true } },
    },
    orderBy: { position: 'asc' },
  })

  // `_count` não sobrevive à camelização snake_case→camelCase da fronteira da
  // API (o `_` inicial não casa com o regex de toCamel), então achatamos aqui
  // em campos nomeados explicitamente em vez de depender da chave do Prisma.
  return tasks.map(({ _count, dependents, ...task }) => ({
    ...task,
    blocked_by: dependents,
    subtasks_count: _count.subtasks,
    comments_count: _count.comments,
  }))
}

export async function archiveTask(taskId: string, actorId: string) {
  const { archived, subtasks } = await prisma.$transaction(async (tx) => {
    const now = new Date()
    const task = await tx.task.update({ where: { id: taskId }, data: { archived_at: now } })
    await tx.taskActivity.create({ data: { task_id: taskId, actor_id: actorId, type: 'archived' } })
    // Subtasks saem junto (em todos os níveis): ativas, seguiriam contando e prendendo chamados.
    const subtasks: Array<typeof task> = []
    let parents = [taskId]
    while (parents.length > 0) {
      const level = await tx.task.findMany({ where: { parent_id: { in: parents }, archived_at: null } })
      if (level.length === 0) break
      await tx.task.updateMany({ where: { id: { in: level.map((t) => t.id) } }, data: { archived_at: now } })
      await tx.taskActivity.createMany({ data: level.map((t) => ({ task_id: t.id, actor_id: actorId, type: 'archived' as TaskActivityType })) })
      subtasks.push(...level)
      parents = level.map((t) => t.id)
    }
    return { archived: task, subtasks }
  })
  const ref = (t: typeof archived) => `${t.key ?? `#${t.seq}`} "${t.title}"`
  await releaseTicketsOfTask(taskId, actorId, `Task ${ref(archived)} foi arquivada — chamado volta ao atendimento.`)
  for (const sub of subtasks) {
    await releaseTicketsOfTask(sub.id, actorId, `Task ${ref(sub)} foi arquivada junto com a task-pai ${ref(archived)} — chamado volta ao atendimento.`)
  }
  // Arquivar é a exclusão do produto (a task some de todas as telas).
  for (const t of [archived, ...subtasks]) fireProjectWebhook('task.deleted', t.project_id, actorId, { task: webhookTask(t) })
  return archived
}

export async function listTasksForUser(userId: string) {
  return prisma.task.findMany({
    // Responsável ou co-responsável (igual à Minha Área), só em projetos ativos que ainda enxerga.
    where: {
      OR: [{ assignee_id: userId }, { multi_assignees: { some: { user_id: userId } } }],
      archived_at: null,
      project: { archived_at: null, ...(await visibleProjectsWhere(userId)) },
    },
    include: {
      project: { select: { id: true, name: true } },
      status: true,
      tags: { include: { tag: true } },
      task_type: { select: { name: true, color: true } },
      list: { select: { name: true } },
      sprint: { select: { name: true } },
      // Minha semana: de quem cada tarefa depende.
      dependents: {
        where: { depends_on: { archived_at: null } },
        select: { depends_on: { select: { id: true, title: true, key: true, seq: true, project_id: true, assignee: { select: { id: true, name: true } }, status: { select: { category: true } } } } },
      },
    },
    orderBy: { due_date: 'asc' },
  })
}

function describeActivity(type: TaskActivityType): string {
  switch (type) {
    case 'assignee_changed':
      return 'O responsável pela tarefa foi alterado.'
    case 'assignees_changed':
      return 'Os responsáveis pela tarefa foram alterados.'
    case 'status_changed':
      return 'O status da tarefa foi alterado.'
    case 'priority_changed':
      return 'A prioridade da tarefa foi alterada.'
    case 'due_date_changed':
      return 'O prazo da tarefa foi alterado.'
    case 'title_changed':
      return 'O título da tarefa foi alterado.'
    case 'description_changed':
      return 'A descrição da tarefa foi alterada.'
    case 'moved_list':
      return 'A tarefa foi movida de lista.'
    case 'milestone_changed':
      return 'A marcação de milestone da tarefa foi alterada.'
    case 'task_type_changed':
      return 'O tipo da tarefa foi alterado.'
    case 'story_points_changed':
      return 'A estimativa de story points foi alterada.'
    case 'sprint_changed':
      return 'O sprint da tarefa foi alterado.'
    default:
      return 'A tarefa foi atualizada.'
  }
}
