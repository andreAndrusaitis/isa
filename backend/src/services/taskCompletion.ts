/**
 * Fluxo de conclusão e ações em massa.
 *
 * Concluir não é "mudar o status_id para um status DONE": o sistema
 * verifica subtasks, checklist, dependências bloqueantes, campos
 * obrigatórios e aprovação — e, havendo bloqueio, explica exatamente o motivo
 * em vez de recusar genericamente.
 */
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { updateTask, archiveTask } from './tasks'
import { requestApproval, assertValidApprover } from './taskApprovals'

export interface CompletionBlocker {
  code: string
  message: string
}

/**
 * Levanta TODOS os impedimentos de uma vez — não para no primeiro. Corrigir um
 * bloqueio de cada vez, com um round-trip por vez, seria cansativo.
 */
export async function checkCompletionBlockers(taskId: string, db: Prisma.TransactionClient = prisma): Promise<CompletionBlocker[]> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      subtasks: { where: { archived_at: null }, include: { status: true } },
      checklist: true,
      custom_field_values: true,
      approvals: { orderBy: { created_at: 'desc' } },
      project: { select: { id: true } },
    },
  })
  if (!task) throw new AppError(404, 'Task não encontrada', 'NOT_FOUND')

  const blockers: CompletionBlocker[] = []

  const pendingSubtasks = task.subtasks.filter((s) => s.status.category !== 'done' && s.status.category !== 'cancelled')
  if (pendingSubtasks.length > 0) {
    blockers.push({
      code: 'SUBTASKS_PENDING',
      message: `${pendingSubtasks.length} subtask(s) ainda não concluída(s): ${pendingSubtasks.map((s) => `#${s.seq}`).join(', ')}.`,
    })
  }

  const pendingChecklist = task.checklist.filter((item) => !item.done)
  if (pendingChecklist.length > 0) {
    blockers.push({
      code: 'CHECKLIST_PENDING',
      message: `${pendingChecklist.length} item(ns) de checklist em aberto.`,
    })
  }

  // Dependências bloqueantes: a task não pode concluir antes de quem ela depende.
  // Task arquivada saiu do produto: não bloqueia mais ninguém.
  const dependencies = await db.taskDependency.findMany({
    where: { task_id: taskId, depends_on: { archived_at: null } },
    include: { depends_on: { include: { status: true } } },
  })
  const blockingDeps = dependencies.filter(
    (d) => d.depends_on.status.category !== 'done' && d.depends_on.status.category !== 'cancelled',
  )
  if (blockingDeps.length > 0) {
    blockers.push({
      code: 'DEPENDENCIES_BLOCKING',
      message: `Bloqueada por: ${blockingDeps.map((d) => `#${d.depends_on.seq}`).join(', ')}.`,
    })
  }

  const requiredFields = await db.customField.findMany({
    where: { project_id: task.project_id, required: true },
    select: { id: true, name: true },
  })
  const filled = new Set(
    task.custom_field_values
      .filter((v) => v.value !== null && v.value !== '' && v.value !== undefined)
      .map((v) => v.custom_field_id),
  )
  const missing = requiredFields.filter((f) => !filled.has(f.id))
  if (missing.length > 0) {
    blockers.push({
      code: 'REQUIRED_FIELDS_MISSING',
      message: `Campos obrigatórios não preenchidos: ${missing.map((f) => f.name).join(', ')}.`,
    })
  }

  if (task.approvals.some((a) => a.status === 'pending')) {
    blockers.push({ code: 'APPROVAL_PENDING', message: 'Aprovação pendente.' })
  }

  return blockers
}

/**
 * Trava única de conclusão: vale para o /complete, o PATCH, o lote e as
 * automações (todos passam pelo updateTask ao entrar num status "done").
 */
export async function assertCanComplete(taskId: string, db: Prisma.TransactionClient = prisma) {
  const blockers = await checkCompletionBlockers(taskId, db)
  if (blockers.length > 0) {
    throw new AppError(409, blockers.map((b) => b.message).join(' '), 'TASK_COMPLETION_BLOCKED', { blockers })
  }
}

export const completeTaskSchema = z.object({
  statusId: z.string().uuid().optional(),
  // Quem aprova quando o status exige aprovação; sem ele, o dono do projeto.
  approverId: z.string().uuid().optional(),
})

export interface CompleteResult {
  outcome: 'completed' | 'awaiting_approval'
  taskId: string
  recurrenceSpawnedId?: string | null
  approvalId?: string
}

/**
 * Conclui a task. Se o status de destino exigir aprovação, move para ele e
 * abre a solicitação em vez de concluir — a conclusão real vem da decisão.
 */
export async function completeTask(taskId: string, actorId: string, input: z.infer<typeof completeTaskSchema> = {}): Promise<CompleteResult> {
  // Aprovação pendente barra a conclusão; a decisão é que retoma o fluxo.
  const pendingApproval = await prisma.approval.findFirst({
    where: { task_id: taskId, status: 'pending' },
  })
  if (pendingApproval) {
    throw new AppError(409, 'Esta task aguarda aprovação antes de ser concluída.', 'APPROVAL_PENDING', {
      blockers: [{ code: 'APPROVAL_PENDING', message: 'Aprovação pendente.' }],
    })
  }

  await assertCanComplete(taskId)

  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { project_id: true, project: { select: { owner_id: true } } },
  })

  let targetStatus
  if (input.statusId) {
    targetStatus = await prisma.projectStatus.findFirst({
      where: { id: input.statusId, project_id: task.project_id, is_active: true },
    })
    if (!targetStatus) throw new AppError(400, 'Status inválido para este projeto', 'STATUS_INVALID')
  } else {
    targetStatus = await prisma.projectStatus.findFirst({
      where: { project_id: task.project_id, category: 'done', is_active: true },
      orderBy: { position: 'asc' },
    })
    if (!targetStatus) {
      throw new AppError(400, 'O projeto não possui um status de conclusão configurado', 'NO_DONE_STATUS')
    }
  }

  if (targetStatus.requires_approval) {
    const approverId = input.approverId ?? task.project.owner_id
    await assertValidApprover(taskId, approverId, actorId) // antes de mover: aprovador inválido não deixa a task no status
    await updateTask(taskId, actorId, { statusId: targetStatus.id })
    const approval = await requestApproval(taskId, { approverId }, actorId)
    return { outcome: 'awaiting_approval', taskId, approvalId: approval.id }
  }

  // A recorrência on_complete nasce dentro do updateTask (mesmo caminho do PATCH e do lote).
  const { recurrenceSpawnedId } = await updateTask(taskId, actorId, { statusId: targetStatus.id })
  return { outcome: 'completed', taskId, recurrenceSpawnedId }
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

export const bulkActionSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['status', 'assignee', 'priority', 'add_tag', 'move_list', 'archive', 'due_date', 'start_date', 'task_type', 'sprint']),
  statusId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low', 'none']).optional(),
  tagId: z.string().uuid().optional(),
  listId: z.string().uuid().nullable().optional(),
  taskTypeId: z.string().uuid().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  // Datas: `date` define a mesma data em todas (null limpa); `shiftDays` adia/antecipa
  // a data atual de cada uma (tasks sem a data ficam como estão).
  date: z.string().datetime().nullable().optional(),
  shiftDays: z.number().int().min(-365).max(365).optional(),
})

export interface BulkResult {
  succeeded: string[]
  failed: Array<{ taskId: string; reason: string }>
}

const ARCHIVE_ROLES = new Set(['owner', 'manager'])

function shiftedDate(current: Date | null, shiftDays: number): string | null | undefined {
  if (!current) return undefined // sem data: nada a deslocar
  return new Date(current.getTime() + shiftDays * 86_400_000).toISOString()
}

/**
 * Aplica a ação a cada task individualmente, via updateTask — assim cada uma
 * gera seu histórico, suas automações e seu evento de socket. Um lote não é
 * atômico de propósito: falhar tudo porque uma task tem um bloqueio seria pior
 * do que aplicar as demais e reportar quais não passaram.
 */
export async function applyBulkAction(
  projectId: string,
  actorId: string,
  input: z.infer<typeof bulkActionSchema>,
  actorRole?: string,
): Promise<BulkResult> {
  // Arquivar uma task sozinha exige dono/gerente do projeto; em lote, também.
  if (input.action === 'archive' && !ARCHIVE_ROLES.has(actorRole ?? '')) {
    throw new AppError(403, 'Só o dono ou um gerente do projeto pode arquivar tasks.', 'FORBIDDEN')
  }
  if (input.action === 'add_tag') {
    if (!input.tagId) throw new AppError(400, 'tagId é obrigatória', 'VALIDATION')
    const tag = await prisma.tag.findFirst({ where: { id: input.tagId, project_id: projectId }, select: { id: true } })
    if (!tag) throw new AppError(400, 'Tag de outro projeto.', 'CROSS_PROJECT_REFERENCE')
  }
  if ((input.action === 'due_date' || input.action === 'start_date') && input.date === undefined && input.shiftDays === undefined) {
    throw new AppError(400, 'Informe a data ou quantos dias deslocar.', 'VALIDATION')
  }

  // Escopo: só tasks do projeto autorizado. Sem este filtro, um id de outro
  // projeto passaria pelo requireProjectRole do projeto atual.
  const tasks = await prisma.task.findMany({
    where: { id: { in: input.taskIds }, project_id: projectId },
    select: { id: true, due_date: true, start_date: true },
  })
  const byId = new Map(tasks.map((t) => [t.id, t]))

  const result: BulkResult = { succeeded: [], failed: [] }

  for (const taskId of input.taskIds) {
    const task = byId.get(taskId)
    if (!task) {
      result.failed.push({ taskId, reason: 'Task não pertence a este projeto' })
      continue
    }

    try {
      switch (input.action) {
        case 'status':
          if (!input.statusId) throw new AppError(400, 'statusId é obrigatório', 'VALIDATION')
          await updateTask(taskId, actorId, { statusId: input.statusId })
          break
        case 'assignee':
          await updateTask(taskId, actorId, { assigneeId: input.assigneeId ?? null })
          break
        case 'priority':
          if (!input.priority) throw new AppError(400, 'priority é obrigatória', 'VALIDATION')
          await updateTask(taskId, actorId, { priority: input.priority })
          break
        case 'move_list':
          await updateTask(taskId, actorId, { listId: input.listId ?? null })
          break
        case 'task_type':
          if (!input.taskTypeId) throw new AppError(400, 'taskTypeId é obrigatório', 'VALIDATION')
          await updateTask(taskId, actorId, { taskTypeId: input.taskTypeId })
          break
        case 'sprint':
          await updateTask(taskId, actorId, { sprintId: input.sprintId ?? null })
          break
        case 'due_date': {
          const dueDate = input.shiftDays !== undefined ? shiftedDate(task.due_date, input.shiftDays) : input.date
          if (dueDate !== undefined) await updateTask(taskId, actorId, { dueDate })
          break
        }
        case 'start_date': {
          const startDate = input.shiftDays !== undefined ? shiftedDate(task.start_date, input.shiftDays) : input.date
          if (startDate !== undefined) await updateTask(taskId, actorId, { startDate })
          break
        }
        case 'add_tag':
          await prisma.taskTag.upsert({
            where: { task_id_tag_id: { task_id: taskId, tag_id: input.tagId! } },
            create: { task_id: taskId, tag_id: input.tagId! },
            update: {},
          })
          break
        case 'archive':
          await archiveTask(taskId, actorId)
          break
      }
      result.succeeded.push(taskId)
    } catch (error: any) {
      result.failed.push({ taskId, reason: error?.message ?? 'Erro desconhecido' })
    }
  }

  return result
}
