/**
 * Colaboração e organização de tasks — watchers, relações,
 * recorrência, favoritos, filtros salvos e views.
 *
 * Tudo aqui é acessório à Task: nada substitui `updateTask` como único ponto
 * de escrita dos campos da própria task.
 */
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { resolveTaskType, allocateTypeNumber } from './taskTypeKeys'
import { getIo } from '../config/socket'
import { AppError } from '../middlewares/errorHandler'
import { camelize } from '../utils/serialize'
import { logger } from '../utils/logger'
import type { Recurrence } from './tasks'

// ---------------------------------------------------------------------------
// Watchers — seguir uma task sem ser responsável por ela
// ---------------------------------------------------------------------------

export async function addWatcher(taskId: string, userId: string, actorId: string) {
  const watcher = await prisma.taskWatcher.upsert({
    where: { task_id_user_id: { task_id: taskId, user_id: userId } },
    create: { task_id: taskId, user_id: userId },
    update: {},
    include: { user: { select: { id: true, name: true, avatar: true } } },
  })

  await prisma.taskActivity.create({
    data: { task_id: taskId, actor_id: actorId, type: 'watcher_added', to_value: userId },
  })

  return watcher
}

export async function removeWatcher(taskId: string, userId: string, actorId: string) {
  await prisma.taskWatcher.deleteMany({ where: { task_id: taskId, user_id: userId } })
  await prisma.taskActivity.create({
    data: { task_id: taskId, actor_id: actorId, type: 'watcher_removed', from_value: userId },
  })
}

export async function listWatchers(taskId: string) {
  return prisma.taskWatcher.findMany({
    where: { task_id: taskId },
    include: { user: { select: { id: true, name: true, avatar: true } } },
    orderBy: { created_at: 'asc' },
  })
}

/**
 * Destinatários de notificação de uma task: responsável, co-responsáveis e
 * seguidores, menos quem executou a ação. Ponto único para não haver
 * divergência entre "quem é avisado" em cada lugar que notifica.
 */
export async function getNotificationTargets(taskId: string, actorId: string): Promise<string[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      assignee_id: true,
      creator_id: true,
      multi_assignees: { select: { user_id: true } },
      watchers: { select: { user_id: true } },
    },
  })
  if (!task) return []

  const targets = new Set<string>()
  if (task.assignee_id) targets.add(task.assignee_id)
  targets.add(task.creator_id)
  for (const a of task.multi_assignees) targets.add(a.user_id)
  for (const w of task.watchers) targets.add(w.user_id)
  targets.delete(actorId)

  return [...targets]
}

// ---------------------------------------------------------------------------
// Relações entre tasks — vínculo sem bloqueio, diferente de dependência
// ---------------------------------------------------------------------------

export const createRelationSchema = z.object({
  toTaskId: z.string().uuid(),
  type: z.enum(['relates_to', 'duplicates', 'causes']).default('relates_to'),
})

export async function createRelation(
  fromTaskId: string,
  actorId: string,
  input: z.infer<typeof createRelationSchema>,
) {
  if (fromTaskId === input.toTaskId) {
    throw new AppError(400, 'Uma task não pode se relacionar com ela mesma', 'RELATION_SELF')
  }

  const [from, to] = await Promise.all([
    prisma.task.findUnique({ where: { id: fromTaskId }, select: { project_id: true } }),
    prisma.task.findUnique({ where: { id: input.toTaskId }, select: { project_id: true, seq: true } }),
  ])
  if (!from || !to) throw new AppError(404, 'Task não encontrada', 'NOT_FOUND')

  // Relação só dentro do mesmo projeto: fora dele o usuário poderia inferir a
  // existência de tasks de projetos onde não é membro.
  if (from.project_id !== to.project_id) {
    throw new AppError(400, 'Só é possível relacionar tasks do mesmo projeto', 'RELATION_CROSS_PROJECT')
  }

  const existing = await prisma.taskRelation.findFirst({
    where: {
      OR: [
        { from_task_id: fromTaskId, to_task_id: input.toTaskId },
        { from_task_id: input.toTaskId, to_task_id: fromTaskId },
      ],
    },
  })
  if (existing) throw new AppError(409, 'Essas tasks já estão relacionadas', 'RELATION_EXISTS')

  const relation = await prisma.taskRelation.create({
    data: { from_task_id: fromTaskId, to_task_id: input.toTaskId, type: input.type },
  })

  await prisma.taskActivity.create({
    data: { task_id: fromTaskId, actor_id: actorId, type: 'relation_added', to_value: input.toTaskId },
  })

  return relation
}

export async function removeRelation(relationId: string, actorId: string) {
  const relation = await prisma.taskRelation.findUnique({ where: { id: relationId } })
  if (!relation) throw new AppError(404, 'Relação não encontrada', 'NOT_FOUND')

  await prisma.taskRelation.delete({ where: { id: relationId } })
  await prisma.taskActivity.create({
    data: { task_id: relation.from_task_id, actor_id: actorId, type: 'relation_removed', from_value: relation.to_task_id },
  })
}

/** Relações nos dois sentidos — a UI mostra "relacionada com" sem direção. */
export async function listRelations(taskId: string) {
  const select = { id: true, seq: true, key: true, title: true, status_id: true }
  const [outgoing, incoming] = await Promise.all([
    prisma.taskRelation.findMany({
      where: { from_task_id: taskId },
      include: { to_task: { select } },
    }),
    prisma.taskRelation.findMany({
      where: { to_task_id: taskId },
      include: { from_task: { select } },
    }),
  ])

  return [
    ...outgoing.map((r) => ({ id: r.id, type: r.type, task: r.to_task })),
    ...incoming.map((r) => ({ id: r.id, type: r.type, task: r.from_task })),
  ]
}

// ---------------------------------------------------------------------------
// Recorrência
// ---------------------------------------------------------------------------

export function nextOccurrence(from: Date, recurrence: Recurrence): Date {
  const next = new Date(from)
  const n = recurrence.interval ?? 1
  switch (recurrence.freq) {
    case 'daily':
      next.setDate(next.getDate() + n)
      break
    case 'weekly':
      next.setDate(next.getDate() + 7 * n)
      break
    case 'monthly':
      next.setMonth(next.getMonth() + n)
      break
    case 'yearly':
      next.setFullYear(next.getFullYear() + n)
      break
  }
  return next
}

/**
 * Cria a próxima ocorrência de uma task recorrente. Copia o "molde" (título,
 * descrição, responsável, tags, checklist) e desloca as datas pelo intervalo.
 * Não copia comentários, anexos nem histórico — cada ocorrência é um trabalho
 * novo, não uma cópia do que já foi discutido.
 *
 * `after`: pula ocorrências que já ficaram para trás (job on_due com a task
 * parada há vários intervalos gera uma só, a próxima depois desta data).
 */
export async function spawnNextOccurrence(taskId: string, opts: { after?: Date } = {}): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      checklist: { orderBy: { position: 'asc' } },
      tags: true,
      multi_assignees: true,
    },
  })
  if (!task?.recurrence) return null

  const recurrence = task.recurrence as unknown as Recurrence
  const anchor = task.due_date ?? task.start_date ?? new Date()
  let nextDue = nextOccurrence(anchor, recurrence)
  while (opts.after && nextDue <= opts.after) {
    const following = nextOccurrence(nextDue, recurrence)
    if (following <= nextDue) break // frequência desconhecida não avança: evita laço infinito
    nextDue = following
  }
  const shiftMs = nextDue.getTime() - anchor.getTime()

  // Primeiro status do fluxo — a ocorrência nova começa do início, não no
  // status em que a anterior terminou.
  const firstStatus = await prisma.projectStatus.findFirst({
    where: { project_id: task.project_id, is_active: true },
    orderBy: { position: 'asc' },
    select: { id: true },
  })
  if (!firstStatus) return null

  return prisma.$transaction(async (tx) => {
    // A ocorrência anterior deixa de ser recorrente ANTES de gerar a próxima: só o
    // "molde" ativo mais recente gera, e duas conclusões simultâneas (ou o job e
    // uma conclusão) disputam esta linha — quem não a pegar não cria nada.
    // `Prisma.DbNull` e não `undefined`: undefined em `data` significa "não alterar".
    const claimed = await tx.task.updateMany({
      where: { id: taskId, recurrence: { not: Prisma.DbNull } },
      data: { recurrence: Prisma.DbNull },
    })
    if (claimed.count !== 1) return null

    const project = await tx.project.update({
      where: { id: task.project_id },
      data: { next_task_seq: { increment: 1 } },
      select: { next_task_seq: true },
    })

    // Mesmo tipo da ocorrência anterior, com número novo (BUG-12 → BUG-13).
    const taskType = await resolveTaskType(tx, task.project_id, task.task_type_id)
    const { number: typeNumber, key } = await allocateTypeNumber(tx, taskType.id)

    const created = await tx.task.create({
      data: {
        project_id: task.project_id,
        task_type_id: taskType.id,
        type_number: typeNumber,
        key,
        list_id: task.list_id,
        status_id: firstStatus.id,
        parent_id: task.parent_id,
        seq: project.next_task_seq - 1,
        title: task.title,
        description: task.description,
        priority: task.priority,
        assignee_id: task.assignee_id,
        creator_id: task.creator_id,
        start_date: task.start_date ? new Date(task.start_date.getTime() + shiftMs) : null,
        due_date: nextDue,
        is_milestone: task.is_milestone,
        recurrence: task.recurrence as any,
        position: task.position,
      },
    })

    if (task.checklist.length > 0) {
      await tx.checklistItem.createMany({
        data: task.checklist.map((item) => ({
          task_id: created.id,
          text: item.text,
          done: false,
          position: item.position,
        })),
      })
    }

    if (task.tags.length > 0) {
      await tx.taskTag.createMany({ data: task.tags.map((t) => ({ task_id: created.id, tag_id: t.tag_id })) })
    }

    if (task.multi_assignees.length > 0) {
      await tx.taskAssignee.createMany({
        data: task.multi_assignees.map((a) => ({ task_id: created.id, user_id: a.user_id })),
      })
    }

    await tx.taskActivity.create({
      data: { task_id: created.id, actor_id: task.creator_id, type: 'created' },
    })

    getIo()?.to(`project:${task.project_id}`).emit('task.created', { task: camelize(created) })

    return created.id
  })
}

/** Conclusão de task recorrente no modo on_complete (o padrão): nasce a próxima. */
export async function spawnOnComplete(taskId: string): Promise<string | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { recurrence: true } })
  const recurrence = task?.recurrence as unknown as Recurrence | null
  if (!recurrence || (recurrence.mode ?? 'on_complete') !== 'on_complete') return null
  return spawnNextOccurrence(taskId)
}

/**
 * Job do modo on_due: chegou a data prevista, nasce a próxima ocorrência —
 * concluída ou não a atual. Idempotente: a geração tira a recorrência da
 * task de origem, então a mesma task não gera duas vezes.
 */
export async function spawnDueOccurrences(now = new Date()) {
  const due = await prisma.task.findMany({
    where: {
      archived_at: null,
      due_date: { lte: now },
      recurrence: { path: ['mode'], equals: 'on_due' },
      status: { category: { not: 'cancelled' } },
      project: { archived_at: null },
    },
    select: { id: true },
    orderBy: { due_date: 'asc' },
    take: 200,
  })
  let spawned = 0
  for (const t of due) {
    try {
      if (await spawnNextOccurrence(t.id, { after: now })) spawned++
    } catch (err: any) {
      logger.error(`[Projetos] próxima ocorrência (on_due) da task ${t.id} falhou: ${err?.message ?? err}`)
    }
  }
  return { spawned }
}

// ---------------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------------

export async function toggleFavorite(
  userId: string,
  entityType: 'project' | 'document',
  entityId: string,
  projectId: string | null,
): Promise<{ favorited: boolean }> {
  const existing = await prisma.favorite.findUnique({
    where: { user_id_entity_type_entity_id: { user_id: userId, entity_type: entityType, entity_id: entityId } },
  })

  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } })
    return { favorited: false }
  }

  await prisma.favorite.create({
    data: { user_id: userId, entity_type: entityType, entity_id: entityId, project_id: projectId },
  })
  return { favorited: true }
}

export async function listFavorites(userId: string, entityType?: 'project' | 'document') {
  return prisma.favorite.findMany({
    where: { user_id: userId, ...(entityType ? { entity_type: entityType } : {}) },
    orderBy: { created_at: 'desc' },
  })
}

// ---------------------------------------------------------------------------
// Filtros salvos e views personalizadas
// ---------------------------------------------------------------------------

export const savedFilterSchema = z.object({
  name: z.string().min(1).max(120),
  projectId: z.string().uuid().nullable().optional(),
  filters: z.record(z.unknown()),
})

export async function createSavedFilter(userId: string, input: z.infer<typeof savedFilterSchema>) {
  return prisma.savedFilter.create({
    data: {
      user_id: userId,
      project_id: input.projectId ?? null,
      name: input.name,
      filters: input.filters as any,
    },
  })
}

export async function listSavedFilters(userId: string, projectId?: string) {
  return prisma.savedFilter.findMany({
    where: { user_id: userId, ...(projectId ? { OR: [{ project_id: projectId }, { project_id: null }] } : {}) },
    orderBy: { created_at: 'desc' },
  })
}

export async function deleteSavedFilter(id: string, userId: string) {
  // Escopo no delete: sem o user_id qualquer um apagaria o filtro de outro.
  const deleted = await prisma.savedFilter.deleteMany({ where: { id, user_id: userId } })
  if (deleted.count === 0) throw new AppError(404, 'Filtro não encontrado', 'NOT_FOUND')
}

export const customViewSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['board', 'list', 'calendar', 'gantt', 'timeline']),
  filters: z.record(z.unknown()).nullable().optional(),
  groupBy: z.string().max(60).nullable().optional(),
  sortBy: z.string().max(60).nullable().optional(),
})

export async function createCustomView(
  projectId: string,
  userId: string,
  input: z.infer<typeof customViewSchema>,
) {
  const last = await prisma.customView.findFirst({
    where: { project_id: projectId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })

  return prisma.customView.create({
    data: {
      project_id: projectId,
      name: input.name,
      type: input.type,
      filters: (input.filters ?? null) as any,
      group_by: input.groupBy ?? null,
      sort_by: input.sortBy ?? null,
      position: (last?.position ?? -1) + 1,
      created_by: userId,
    },
  })
}

export async function listCustomViews(projectId: string) {
  return prisma.customView.findMany({
    where: { project_id: projectId },
    orderBy: { position: 'asc' },
  })
}

export async function deleteCustomView(id: string, projectId: string) {
  const deleted = await prisma.customView.deleteMany({ where: { id, project_id: projectId } })
  if (deleted.count === 0) throw new AppError(404, 'Visualização não encontrada', 'NOT_FOUND')
}
