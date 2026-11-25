/**
 * Ponte chamado ↔ task de projeto.
 *
 * Vincular tira o chamado do SLA: ele vai para pending/pending_project pelo
 * caminho normal do TicketService.updateTicket (pausa de SLA, histórico,
 * notificações), com o usuário real como autor. Vale o prazo da task.
 *
 * `tickets.project_task_id` fica como histórico; o vínculo ATIVO é
 * project_task_id + status pending + pending_reason pending_project. Assim um
 * chamado tirado da pendência à mão não é resolvido depois pela task, sem
 * precisar de gancho dentro do updateTicket.
 */
import { z } from 'zod'
import { logTaskActivity } from './taskActivity'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { forbidden, adminReadOnly } from '../utils/denials'
import { SYSTEM_USER_ID } from '../utils/constants'
import { TicketService } from './tickets'
import { getTicketAccess } from './ticketAccess'
import { NotificationService } from './notifications'
import { createTask, archiveTask } from './tasks'
import { dayKey } from './projectInsights'
import { readableTickets, RESTRICTED_TICKET_TITLE } from './taskFull'

type Actor = { sub: string; role: string }

const ACTIVE = { status: 'pending' as const, pending_reason: 'pending_project' as const }

function fmtDate(d: Date) {
  // UTC: prazos são datas (gravadas 00:00–12:00 UTC); no fuso de SP 00:00 UTC viraria o dia anterior.
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

function slaRemaining(deadline: Date) {
  const h = Math.round((deadline.getTime() - Date.now()) / 3_600_000)
  return h >= 0 ? `${h}h` : `estourado há ${-h}h`
}

const taskRef = (task: { key: string | null; seq: number }) => task.key ?? `#${task.seq}`

async function loadTask(projectId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, project_id: projectId, archived_at: null },
    include: { status: { select: { category: true } }, project: { select: { name: true } } },
  })
  if (!task) throw new AppError(404, 'Task não encontrada', 'TASK_NOT_FOUND')
  return task
}

type LinkableTask = Awaited<ReturnType<typeof loadTask>>
type LinkableTicket = NonNullable<Awaited<ReturnType<typeof prisma.ticket.findFirst>>>

function assertTaskLinkable(task: LinkableTask) {
  if (!task.due_date) {
    throw new AppError(400, 'Defina o prazo da task antes de vincular chamados: o chamado passa a seguir esse prazo.', 'TASK_NEEDS_DUE_DATE')
  }
  if (task.status.category === 'done' || task.status.category === 'cancelled') {
    throw new AppError(400, 'Task concluída ou cancelada não recebe chamados.', 'TASK_CLOSED')
  }
}

/** Chamado pode entrar nesta task? (em andamento e sem vínculo ativo em outra task) */
function assertTicketLinkable(ticket: LinkableTicket, taskId: string | null) {
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    throw new AppError(400, 'Só chamados em andamento podem ser vinculados a uma task.', 'TICKET_NOT_ACTIVE')
  }
  const activeElsewhere = ticket.project_task_id && ticket.project_task_id !== taskId &&
    ticket.status === ACTIVE.status && ticket.pending_reason === ACTIVE.pending_reason
  if (activeElsewhere) {
    throw new AppError(409, 'Este chamado já está vinculado a outra task. Desvincule antes.', 'TICKET_ALREADY_LINKED')
  }
}

const findTicketByRef = (ref: string) =>
  prisma.ticket.findFirst({ where: { OR: [{ id: ref.trim() }, { display_number: ref.trim() }], deleted_at: null }, include: { org: { select: { name: true } } } })

async function actorLabel(actorId: string) {
  const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
  return `por ${u?.name ?? 'usuário'}`
}

/** Núcleo do vínculo; quem chama já validou acesso. `by` completa a nota do histórico. */
async function attachTicket(task: LinkableTask, ticket: LinkableTicket, actorId: string, by: string, opts: { origin?: 'routing' } = {}) {
  if (ticket.project_task_id === task.id && ticket.status === ACTIVE.status && ticket.pending_reason === ACTIVE.pending_reason) return ticket
  const note = `Vinculado à task ${taskRef(task)} "${task.title}" do projeto ${task.project.name} ${by}. ` +
    `Previsão: ${fmtDate(task.due_date!)}. SLA restante no vínculo: ${slaRemaining(ticket.sla_deadline)}.`
  await TicketService.updateTicket(ticket.id, actorId, 'system', { status: 'pending', pending_reason: 'pending_project', note }, opts)
  // Sai no mesmo e-mail do "pendente": o cliente já recebe a previsão.
  TicketService.notifyRequester(ticket, actorId, { kind: 'forecast', to: task.due_date!.toISOString() })
  const linked = await prisma.ticket.update({ where: { id: ticket.id }, data: { project_task_id: task.id, project_forecast_alerted_at: null } })
  // Regra de automação não é pessoa: o vínculo fica na nota do chamado.
  if (actorId !== 'system') await logTaskActivity(task.id, actorId, 'ticket_changed', { to: linked.display_number })
  return linked
}

/** Vincula um chamado (id ou número, ex. ISA-1234) a uma task com prazo. */
export async function linkTicketToTask(projectId: string, taskId: string, ticketRef: string, actor: Actor) {
  // Vincular pausa o SLA: é agir sobre o chamado, e o admin só tem leitura.
  if (actor.role === 'admin') throw adminReadOnly()
  const task = await loadTask(projectId, taskId)
  assertTaskLinkable(task)

  const ticket = await findTicketByRef(ticketRef)
  if (!ticket) throw new AppError(404, 'Chamado não encontrado', 'TICKET_NOT_FOUND')

  const access = await getTicketAccess(ticket, actor)
  if (!access.allowed) throw forbidden(access.code, access.message)

  assertTicketLinkable(ticket, task.id)
  return attachTicket(task, ticket, actor.sub, await actorLabel(actor.sub))
}

export const MAX_BULK_LINK = 50

/** Vários chamados de uma vez (ID 1.2): não atômico, devolve quem falhou e por quê. */
export async function linkTicketsBulk(projectId: string, taskId: string, refs: string[], actor: Actor) {
  if (actor.role === 'admin') throw adminReadOnly()
  assertTaskLinkable(await loadTask(projectId, taskId)) // problema da task vale para o lote inteiro
  const linked: string[] = []
  const failed: Array<{ ref: string; error: string }> = []
  for (const ref of [...new Set(refs.map((r) => r.trim()).filter(Boolean))]) {
    try {
      linked.push((await linkTicketToTask(projectId, taskId, ref, actor)).display_number)
    } catch (err) {
      failed.push({ ref, error: err instanceof AppError ? err.message : 'Falha inesperada ao vincular.' })
    }
  }
  return { linked, failed }
}

const TICKET_TO_TASK_PRIORITY: Record<string, 'critical' | 'high' | 'normal' | 'low'> = { critical: 'critical', high: 'high', medium: 'normal', low: 'low' }

function descriptionFromTicket(ticket: { display_number: string; description: string | null; org?: { name: string } | null }) {
  const origin = `Origem: chamado ${ticket.display_number}${ticket.org ? ` (${ticket.org.name})` : ''}.`
  return ticket.description?.trim() ? `${ticket.description.trim()}\n\n---\n${origin}` : origin
}

async function firstOpenStatus(projectId: string) {
  const status = await prisma.projectStatus.findFirst({ where: { project_id: projectId, category: 'open', is_active: true }, orderBy: { position: 'asc' } }) ??
    await prisma.projectStatus.findFirst({ where: { project_id: projectId, category: 'backlog', is_active: true }, orderBy: { position: 'asc' } })
  if (!status) throw new AppError(400, 'O projeto não tem status em aberto para receber a task.', 'PROJECT_NO_OPEN_STATUS')
  return status
}

export const createTaskFromTicketSchema = z.object({
  ticket: z.string().trim().min(1, 'Informe o chamado'),
  taskTypeId: z.string().uuid('Selecione o tipo da task'),
  dueDate: z.string().datetime('Informe o prazo da task'),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  statusId: z.string().uuid().optional(),
  listId: z.string().uuid().nullable().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low', 'none']).optional(),
})

/**
 * Cria a task já vinculada ao chamado (ID 1.1). Valida o vínculo ANTES de criar;
 * se ele ainda assim falhar, a task é arquivada para não ficar órfã.
 */
export async function createTaskFromTicket(projectId: string, actor: Actor, input: z.infer<typeof createTaskFromTicketSchema>) {
  if (actor.role === 'admin') throw adminReadOnly()
  const ticket = await findTicketByRef(input.ticket)
  if (!ticket) throw new AppError(404, 'Chamado não encontrado', 'TICKET_NOT_FOUND')
  const access = await getTicketAccess(ticket, actor)
  if (!access.allowed) throw forbidden(access.code, access.message)
  assertTicketLinkable(ticket, null)
  if (new Date(input.dueDate).getTime() < Date.now() - 86_400_000) {
    throw new AppError(400, 'O prazo já passou: o chamado nasceria com a previsão vencida.', 'DUE_DATE_IN_PAST')
  }

  const created = await createTask(projectId, actor.sub, {
    title: input.title ?? ticket.title,
    description: input.description !== undefined ? input.description : descriptionFromTicket(ticket),
    statusId: input.statusId ?? (await firstOpenStatus(projectId)).id,
    taskTypeId: input.taskTypeId,
    listId: input.listId ?? null,
    assigneeId: input.assigneeId ?? null,
    priority: input.priority ?? TICKET_TO_TASK_PRIORITY[ticket.priority] ?? 'normal',
    dueDate: input.dueDate,
  })
  try {
    const task = await loadTask(projectId, created.id)
    assertTaskLinkable(task) // o status escolhido pode ser de conclusão
    const linked = await attachTicket(task, ticket, actor.sub, `${await actorLabel(actor.sub)} (task criada a partir do chamado)`)
    return { task: created, ticket: linked }
  } catch (err) {
    await archiveTask(created.id, actor.sub).catch(() => undefined)
    throw err
  }
}

/**
 * Vínculo feito por regra de roteamento (ID 1.5): não há usuário, então não há
 * checagem de acesso; o autor no histórico é o sistema. origin 'routing' evita
 * reentrar no gatilho "chamado atualizado".
 */
export async function linkTicketBySystem(taskId: string, ticketId: string, ruleName: string) {
  const ref = await prisma.task.findUnique({ where: { id: taskId }, select: { project_id: true } })
  if (!ref) throw new Error('task não encontrada')
  const task = await loadTask(ref.project_id, taskId)
  assertTaskLinkable(task)
  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, deleted_at: null } })
  if (!ticket) throw new Error('chamado não encontrado')
  assertTicketLinkable(ticket, task.id)
  return attachTicket(task, ticket, 'system', `pela regra de automação "${ruleName}"`, { origin: 'routing' })
}

export const routingTaskTemplateSchema = z.object({
  projectId: z.string().uuid(),
  taskTypeId: z.string().uuid(),
  dueInDays: z.number().int().min(1).max(365),
})
export type RoutingTaskTemplate = z.infer<typeof routingTaskTemplateSchema>

/** Ação "criar task no projeto" da regra: título/descrição do chamado, prazo relativo. */
export async function createTaskForRoutedTicket(ticketId: string, tpl: RoutingTaskTemplate, ruleName: string) {
  const project = await prisma.project.findFirst({ where: { id: tpl.projectId, archived_at: null }, select: { id: true } })
  if (!project) throw new Error('projeto não encontrado ou arquivado')
  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, deleted_at: null }, include: { org: { select: { name: true } } } })
  if (!ticket) throw new Error('chamado não encontrado')
  assertTicketLinkable(ticket, null)

  const created = await createTask(project.id, SYSTEM_USER_ID, {
    title: ticket.title,
    description: descriptionFromTicket(ticket),
    statusId: (await firstOpenStatus(project.id)).id,
    taskTypeId: tpl.taskTypeId,
    priority: TICKET_TO_TASK_PRIORITY[ticket.priority] ?? 'normal',
    dueDate: new Date(Date.now() + tpl.dueInDays * 86_400_000).toISOString(),
  })
  try {
    await attachTicket(await loadTask(project.id, created.id), ticket, 'system', `pela regra de automação "${ruleName}" (task criada pela regra)`, { origin: 'routing' })
  } catch (err) {
    await archiveTask(created.id, SYSTEM_USER_ID).catch(() => undefined)
    throw err
  }
  return created
}

/** Desfaz o vínculo: chamado volta ao atendimento e o SLA retoma. */
export async function unlinkTicketFromTask(projectId: string, taskId: string, ticketId: string, actor: Actor) {
  if (actor.role === 'admin') throw adminReadOnly()
  const task = await loadTask(projectId, taskId)
  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, project_task_id: task.id } })
  if (!ticket) throw new AppError(404, 'Chamado não está vinculado a esta task', 'LINK_NOT_FOUND')
  const access = await getTicketAccess(ticket, actor) // desvincular retoma o SLA: age sobre o chamado
  if (!access.allowed) throw forbidden(access.code, access.message)
  await releaseTicket(ticket, actor.sub, `Desvinculado da task ${taskRef(task)} "${task.title}" — volta ao atendimento.`)
  await logTaskActivity(task.id, actor.sub, 'ticket_changed', { from: ticket.display_number })
}

/**
 * Chamados da task. Com `actor`, o que ele não pode ler (membro do projeto sem a
 * empresa na carteira) fica na lista só com número e situação do vínculo, que a
 * task já mostra no histórico: sem título, empresa e SLA.
 */
export async function listTaskTickets(projectId: string, taskId: string, actor?: Actor) {
  await loadTask(projectId, taskId)
  const tickets = await prisma.ticket.findMany({
    where: { project_task_id: taskId, deleted_at: null },
    select: { id: true, display_number: true, title: true, status: true, pending_reason: true, sla_deadline: true, project_forecast_alerted_at: true, org: { select: { name: true } } },
    orderBy: { created_at: 'asc' },
  })
  if (!actor) return tickets
  const readable = new Set((await readableTickets(actor, { id: { in: tickets.map((t) => t.id) } })).map((t) => t.id))
  return tickets.map((t) => (readable.has(t.id) ? t : { ...t, title: RESTRICTED_TICKET_TITLE, sla_deadline: null, org: null }))
}

async function releaseTicket(ticket: { id: string; status: string; pending_reason: string | null }, actorId: string, note: string) {
  if (ticket.status === ACTIVE.status && ticket.pending_reason === ACTIVE.pending_reason) {
    await TicketService.updateTicket(ticket.id, actorId, 'system', { status: 'in_progress', note })
  }
  await prisma.ticket.update({ where: { id: ticket.id }, data: { project_task_id: null, project_forecast_alerted_at: null } })
}

/**
 * Gancho do updateTask: task foi para status de conclusão → resolve os chamados ativos.
 * Status que exige aprovação só conclui na decisão (`approved`, vindo de taskApprovals).
 */
export async function resolveTicketsOfDoneTask(taskId: string, actorId: string, opts: { approved?: boolean } = {}) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { status: { select: { category: true, requires_approval: true } } } })
  if (!task || task.status.category !== 'done') return
  if (task.status.requires_approval && !opts.approved) return
  const tickets = await prisma.ticket.findMany({ where: { project_task_id: taskId, ...ACTIVE, deleted_at: null }, select: { id: true } })
  // resolution_details vai ao cliente (portal e e-mail): título, projeto e prefixo do tipo são internos.
  const text = `Resolvido pela conclusão da task #${task.seq}.`
  for (const t of tickets) {
    await TicketService.updateTicket(t.id, actorId, 'system', { status: 'resolved', resolution_details: text, note: text })
  }
}

/** Gancho de arquivar task: chamados ativos voltam ao atendimento (nunca ficam pausados órfãos). */
export async function releaseTicketsOfTask(taskId: string, actorId: string, reason: string) {
  const tickets = await prisma.ticket.findMany({ where: { project_task_id: taskId, ...ACTIVE, deleted_at: null }, select: { id: true, status: true, pending_reason: true } })
  for (const t of tickets) await releaseTicket(t, actorId, reason)
}

export async function taskHasActiveTickets(taskId: string) {
  return (await prisma.ticket.count({ where: { project_task_id: taskId, ...ACTIVE, deleted_at: null } })) > 0
}

/**
 * Gancho do updateTask (ID 1.3): prazo da task mudou → cada chamado ativo ganha
 * nota no histórico, o solicitante recebe a nova previsão por e-mail e o
 * analista do chamado é avisado. Mudança só de horário (mesmo dia) não avisa.
 */
export async function notifyForecastChanged(taskId: string, from: Date | null, to: Date | null, actorId: string) {
  if (!to || (from && fmtDate(from) === fmtDate(to))) return
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { key: true, seq: true, title: true } })
  if (!task) return
  const tickets = await prisma.ticket.findMany({
    where: { project_task_id: taskId, ...ACTIVE, deleted_at: null },
    select: { id: true, user_id: true, assigned_to_id: true, title: true, queue: true },
  })
  const note = `Previsão alterada pela task ${taskRef(task)}: ${from ? fmtDate(from) : 'sem prazo'} → ${fmtDate(to)}.`
  for (const t of tickets) {
    await prisma.$transaction([
      prisma.ticketEvent.create({ data: { ticket_id: t.id, user_id: actorId, from_status: 'pending', to_status: 'pending', pending_reason: 'pending_project', note } }),
      prisma.ticket.update({ where: { id: t.id }, data: { project_forecast_alerted_at: null } }),
    ])
    TicketService.notifyRequester(t, actorId, { kind: 'forecast', to: to.toISOString() })
    if (t.assigned_to_id && t.assigned_to_id !== actorId) {
      await NotificationService.create({ userId: t.assigned_to_id, ticketId: t.id, type: 'project_forecast', title: t.title, body: note })
    }
    TicketService.broadcastTicketUpdate(t.id, 'ticket:updated', t.queue)
  }
}

/**
 * Job (ID 1.4): chamado em projeto cuja task passou do prazo sem concluir volta
 * a ser risco de SLA. Avisa uma vez por previsão (a marca zera quando o prazo
 * muda): nota no chamado, analista do chamado, responsáveis da task e
 * dono/gerente do projeto.
 *
 * Prazo é data (o dia UTC do due_date, como no fmtDate): vence quando esse dia
 * acaba em São Paulo, não no próprio dia às 12:00Z.
 */
export async function alertOverdueForecasts(now = new Date()) {
  const dueDayCutoff = new Date(`${dayKey(now)}T00:00:00.000Z`)
  const tickets = await prisma.ticket.findMany({
    where: {
      ...ACTIVE, deleted_at: null, project_forecast_alerted_at: null,
      project_task: { due_date: { lt: dueDayCutoff }, archived_at: null, status: { category: { notIn: ['done', 'cancelled'] } } },
    },
    select: {
      id: true, display_number: true, title: true, assigned_to_id: true, queue: true,
      project_task: {
        select: {
          id: true, key: true, seq: true, title: true, due_date: true, assignee_id: true,
          multi_assignees: { select: { user_id: true } },
          project: { select: { name: true, members: { where: { role: { in: ['owner', 'manager'] } }, select: { user_id: true } } } },
        },
      },
    },
  })

  const byTask = new Map<string, { task: NonNullable<(typeof tickets)[number]['project_task']>; numbers: string[] }>()
  for (const t of tickets) {
    const task = t.project_task!
    const note = `Previsão vencida: a task ${taskRef(task)} "${task.title}" (${task.project.name}) tinha prazo ${fmtDate(task.due_date!)} e segue aberta — chamado em risco de SLA.`
    await prisma.$transaction([
      prisma.ticketEvent.create({ data: { ticket_id: t.id, user_id: SYSTEM_USER_ID, from_status: 'pending', to_status: 'pending', pending_reason: 'pending_project', note } }),
      prisma.ticket.update({ where: { id: t.id }, data: { project_forecast_alerted_at: now } }),
    ])
    if (t.assigned_to_id) {
      await NotificationService.create({ userId: t.assigned_to_id, ticketId: t.id, type: 'project_forecast', title: t.title, body: note })
    }
    TicketService.broadcastTicketUpdate(t.id, 'ticket:updated', t.queue)
    const entry = byTask.get(task.id) ?? { task, numbers: [] }
    entry.numbers.push(t.display_number)
    byTask.set(task.id, entry)
  }

  // Um aviso por pessoa e task, listando os chamados que aguardam.
  for (const { task, numbers } of byTask.values()) {
    const people = new Set([task.assignee_id, ...task.multi_assignees.map((a) => a.user_id), ...task.project.members.map((m) => m.user_id)].filter((id): id is string => !!id))
    const body = `Prazo ${fmtDate(task.due_date!)} vencido com ${numbers.length} chamado(s) aguardando: ${numbers.join(', ')}. Conclua a task ou atualize a previsão.`
    for (const userId of people) {
      await prisma.notification.create({ data: { user_id: userId, task_id: task.id, type: 'project_forecast', title: `Previsão vencida: ${taskRef(task)}`, body } })
    }
  }
  return { alerted: tickets.length, tasks: byTask.size }
}
