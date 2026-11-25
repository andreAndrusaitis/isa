/**
 * Tempo de task a partir do histórico (task_activities status_changed /
 * assignee_changed). Regra: conta em andamento e em revisão; backlog e a
 * fazer pausam; concluída/cancelada param. Horas úteis pelo mesmo horário
 * comercial + feriados do motor de SLA; horas corridas também saem.
 * As horas vão, inteiras, para cada responsável do trecho (vários
 * responsáveis = cada um recebe o trecho todo).
 */
import prisma from '../config/prisma'
import { visibleProjectsWhere } from './projectAccess'
import { AppError } from '../middlewares/errorHandler'
import { getBusinessHoursConfig } from './businessHours'
import { getBusinessMinutesBetween, nationalHolidays } from '../utils/businessHours'

export type StatusInfo = { id: string; name: string; category: string }
// 'assignees': conjunto completo de responsáveis, ids separados por vírgula em from/to.
export type TimeEvent = { at: Date; type: 'status' | 'assignee' | 'assignees'; from: string | null; to: string | null }

const ids = (csv: string | null) => (csv ? csv.split(',').filter(Boolean) : [])

const COUNTING = new Set(['in_progress', 'in_review'])
const FINISHED = new Set(['done', 'cancelled'])

export function computeTaskTime(input: {
  createdAt: Date
  currentStatusId: string
  currentAssigneeId: string | null
  /** Todos os responsáveis atuais (task_assignees); sem isso, só o principal. */
  currentAssigneeIds?: string[]
  events: TimeEvent[]
  statuses: Map<string, StatusInfo>
  now: Date
  minutesBetween: (a: Date, b: Date) => number
}) {
  const events = [...input.events].sort((a, b) => a.at.getTime() - b.at.getTime())
  const firstStatus = events.find((e) => e.type === 'status')
  const firstAssignee = events.find((e) => e.type !== 'status')
  let statusId = firstStatus ? firstStatus.from ?? input.currentStatusId : input.currentStatusId
  const current = [...new Set([...(input.currentAssigneeId ? [input.currentAssigneeId] : []), ...(input.currentAssigneeIds ?? [])])]
  let people = firstAssignee ? ids(firstAssignee.from) : current
  // shortcut: co-responsáveis de antes do histórico 'assignees' não têm data de entrada — contam o período todo.
  const legacyExtras = events.some((e) => e.type === 'assignees') ? [] : current.filter((id) => id !== input.currentAssigneeId)
  let cursor = input.createdAt

  const segments: Array<{ statusId: string; assigneeId: string | null; assigneeIds: string[]; start: Date; end: Date; minutes: number; counted: boolean }> = []
  const byStatus: Record<string, number> = {}
  const byAssignee: Record<string, number> = {}
  let activeMinutes = 0
  let startedAt: Date | null = COUNTING.has(input.statuses.get(statusId)?.category ?? 'open') ? input.createdAt : null
  let completedAt: Date | null = null

  const close = (end: Date) => {
    if (end <= cursor) return
    const category = input.statuses.get(statusId)?.category ?? 'open'
    if (FINISHED.has(category)) { cursor = end; return } // depois de concluída o relógio para
    const minutes = input.minutesBetween(cursor, end)
    const counted = COUNTING.has(category)
    const who = [...new Set([...people, ...legacyExtras])]
    segments.push({ statusId, assigneeId: who[0] ?? null, assigneeIds: who, start: cursor, end, minutes, counted })
    byStatus[statusId] = (byStatus[statusId] ?? 0) + minutes
    if (counted) {
      activeMinutes += minutes
      for (const id of who.length ? who : ['none']) byAssignee[id] = (byAssignee[id] ?? 0) + minutes
    }
    cursor = end
  }

  for (const e of events) {
    close(e.at)
    if (e.type === 'status') {
      statusId = e.to ?? statusId
      const category = input.statuses.get(statusId)?.category ?? 'open'
      if (COUNTING.has(category) && !startedAt) startedAt = e.at
      completedAt = FINISHED.has(category) ? e.at : null
    } else if (e.type === 'assignees') {
      people = ids(e.to)
    } else {
      // Troca do principal: sai o antigo, entra o novo na frente; "sem responsável" esvazia (como updateTask).
      people = e.to ? [e.to, ...people.filter((id) => id !== e.from && id !== e.to)] : []
    }
  }
  const finalCategory = input.statuses.get(statusId)?.category ?? 'open'
  close(input.now)

  return { activeMinutes, byStatus, byAssignee, segments, running: COUNTING.has(finalCategory), startedAt, completedAt }
}

// ── Consultas ────────────────────────────────────────────────────────────────

export async function loadProjectTime(projectIds: string[], taskId?: string) {
  const tasks = await prisma.task.findMany({
    where: { project_id: { in: projectIds }, archived_at: null, ...(taskId ? { id: taskId } : {}) },
    select: {
      id: true, project_id: true, seq: true, key: true, title: true, status_id: true, assignee_id: true, created_at: true,
      due_date: true, task_type_id: true, is_milestone: true, sprint_id: true, story_points: true, priority: true,
      multi_assignees: { select: { user_id: true } },
    },
  })
  const [statuses, activities, cfg] = await Promise.all([
    prisma.projectStatus.findMany({ where: { project_id: { in: projectIds } }, select: { id: true, name: true, category: true } }),
    prisma.taskActivity.findMany({
      where: { task_id: { in: tasks.map((t) => t.id) }, type: { in: ['status_changed', 'assignee_changed', 'assignees_changed'] } },
      select: { task_id: true, type: true, from_value: true, to_value: true, created_at: true },
      orderBy: { created_at: 'asc' },
    }),
    getBusinessHoursConfig(),
  ])
  const statusMap = new Map(statuses.map((s) => [s.id, s as StatusInfo]))
  const now = new Date()
  // Feriados do ano da task mais antiga até o ano que vem (task de 2023 não pode deixar 2026 sem feriado).
  const earliest = tasks.reduce((d, t) => (t.created_at < d ? t.created_at : d), now)
  const holidays: string[] = []
  for (let y = earliest.getUTCFullYear(); y <= now.getUTCFullYear() + 1; y++) holidays.push(...nationalHolidays(y))
  const business = (a: Date, b: Date) => getBusinessMinutesBetween(a, b, cfg, holidays)
  const wall = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000))

  const eventsByTask = new Map<string, TimeEvent[]>()
  for (const a of activities) {
    const list = eventsByTask.get(a.task_id) ?? []
    list.push({ at: a.created_at, type: a.type === 'status_changed' ? 'status' : a.type === 'assignees_changed' ? 'assignees' : 'assignee', from: a.from_value, to: a.to_value })
    eventsByTask.set(a.task_id, list)
  }

  return tasks.map((task) => {
    const events = eventsByTask.get(task.id) ?? []
    const base = {
      createdAt: task.created_at, currentStatusId: task.status_id, currentAssigneeId: task.assignee_id,
      currentAssigneeIds: task.multi_assignees.map((a) => a.user_id), events, statuses: statusMap, now,
    }
    const time = computeTaskTime({ ...base, minutesBetween: business })
    const wallTime = computeTaskTime({ ...base, minutesBetween: wall })
    const status = statusMap.get(task.status_id)
    // Ciclo: da 1ª entrada em andamento até a conclusão, em horas úteis,
    // pausas incluídas. Só para concluída que passou por andamento.
    const cycleMinutes = status?.category === 'done' && time.startedAt && time.completedAt
      ? business(time.startedAt, time.completedAt)
      : null
    return { task, status, time, wallActiveMinutes: wallTime.activeMinutes, cycleMinutes }
  })
}

async function userNames(ids: string[]) {
  const users = await prisma.user.findMany({ where: { id: { in: ids.filter((i) => i !== 'none') } }, select: { id: true, name: true } })
  return new Map(users.map((u) => [u.id, u.name]))
}

/** Tempo de cada task do projeto + totais (média por task concluída, por pessoa). */
export async function getProjectTime(projectId: string) {
  const rows = await loadProjectTime([projectId])
  const people = new Map<string, number>()
  for (const r of rows) for (const [who, m] of Object.entries(r.time.byAssignee)) people.set(who, (people.get(who) ?? 0) + m)
  const names = await userNames([...people.keys()])
  const done = rows.filter((r) => r.time.completedAt && r.time.activeMinutes > 0)
  return {
    tasks: rows.map((r) => ({
      taskId: r.task.id, seq: r.task.seq, key: r.task.key, title: r.task.title,
      status: r.status ? { name: r.status.name, category: r.status.category } : null,
      activeMinutes: r.time.activeMinutes, wallActiveMinutes: r.wallActiveMinutes,
      running: r.time.running, startedAt: r.time.startedAt, completedAt: r.time.completedAt,
    })).sort((a, b) => b.activeMinutes - a.activeMinutes),
    totals: {
      activeMinutes: rows.reduce((n, r) => n + r.time.activeMinutes, 0),
      runningTasks: rows.filter((r) => r.time.running).length,
      doneTasks: done.length,
      avgMinutesPerDoneTask: done.length ? Math.round(done.reduce((n, r) => n + r.time.activeMinutes, 0) / done.length) : null,
    },
    byPerson: [...people.entries()].map(([userId, minutes]) => ({ userId: userId === 'none' ? null : userId, name: userId === 'none' ? 'Sem responsável' : names.get(userId) ?? '—', activeMinutes: minutes }))
      .sort((a, b) => b.activeMinutes - a.activeMinutes),
  }
}

/** Linha do tempo de uma task: trechos por status/responsável, quais contaram. */
export async function getTaskTime(projectId: string, taskId: string) {
  const [row] = await loadProjectTime([projectId], taskId)
  if (!row) throw new AppError(404, 'Task não encontrada', 'TASK_NOT_FOUND')
  const statuses = await prisma.projectStatus.findMany({ where: { project_id: projectId }, select: { id: true, name: true, category: true } })
  const statusMap = new Map(statuses.map((s) => [s.id, s]))
  const names = await userNames(Object.keys(row.time.byAssignee).concat(row.time.segments.flatMap((s) => s.assigneeIds)))
  return {
    activeMinutes: row.time.activeMinutes, wallActiveMinutes: row.wallActiveMinutes, running: row.time.running,
    startedAt: row.time.startedAt, completedAt: row.time.completedAt, cycleMinutes: row.cycleMinutes,
    byStatus: Object.entries(row.time.byStatus).map(([id, minutes]) => ({ statusId: id, name: statusMap.get(id)?.name ?? '—', category: statusMap.get(id)?.category ?? 'open', minutes })),
    byPerson: Object.entries(row.time.byAssignee).map(([id, minutes]) => ({ userId: id === 'none' ? null : id, name: id === 'none' ? 'Sem responsável' : names.get(id) ?? '—', minutes })),
    segments: row.time.segments.map((s) => ({ ...s, statusName: statusMap.get(s.statusId)?.name ?? '—', assigneeName: s.assigneeIds.length ? s.assigneeIds.map((id) => names.get(id) ?? '—').join(', ') : null })),
  }
}

/** Visão de gestão: horas por projeto e por pessoa nos projetos de que o usuário participa. */
export async function getPortfolioTime(userId: string) {
  const projects = await prisma.project.findMany({
    where: { archived_at: null, ...(await visibleProjectsWhere(userId)) },
    select: { id: true, name: true },
  })
  if (projects.length === 0) return { projects: [], byPerson: [] }
  const rows = await loadProjectTime(projects.map((p) => p.id))
  const people = new Map<string, number>()
  const perProject = new Map<string, { activeMinutes: number; running: number; done: number; doneMinutes: number }>()
  for (const r of rows) {
    const p = perProject.get(r.task.project_id) ?? { activeMinutes: 0, running: 0, done: 0, doneMinutes: 0 }
    p.activeMinutes += r.time.activeMinutes
    if (r.time.running) p.running++
    if (r.time.completedAt && r.time.activeMinutes > 0) { p.done++; p.doneMinutes += r.time.activeMinutes }
    perProject.set(r.task.project_id, p)
    for (const [who, m] of Object.entries(r.time.byAssignee)) people.set(who, (people.get(who) ?? 0) + m)
  }
  const names = await userNames([...people.keys()])
  return {
    projects: projects.map((p) => {
      const s = perProject.get(p.id) ?? { activeMinutes: 0, running: 0, done: 0, doneMinutes: 0 }
      return { projectId: p.id, name: p.name, activeMinutes: s.activeMinutes, runningTasks: s.running, doneTasks: s.done, avgMinutesPerDoneTask: s.done ? Math.round(s.doneMinutes / s.done) : null }
    }).sort((a, b) => b.activeMinutes - a.activeMinutes),
    byPerson: [...people.entries()].map(([id, minutes]) => ({ userId: id === 'none' ? null : id, name: id === 'none' ? 'Sem responsável' : names.get(id) ?? '—', activeMinutes: minutes }))
      .sort((a, b) => b.activeMinutes - a.activeMinutes),
  }
}

/** Chamados ativos em tasks dos projetos do usuário: quem vinculou, quando, prazo. */
export async function getLinkedTicketsForUser(userId: string) {
  const tickets = await prisma.ticket.findMany({
    where: {
      deleted_at: null, status: 'pending', pending_reason: 'pending_project',
      project_task: { project: { ...(await visibleProjectsWhere(userId)), archived_at: null } },
    },
    select: {
      id: true, display_number: true, title: true, sla_deadline: true, org: { select: { name: true } },
      project_task: { select: { id: true, seq: true, key: true, title: true, due_date: true, project: { select: { id: true, name: true } } } },
      events: { where: { to_status: 'pending', pending_reason: 'pending_project' }, orderBy: { created_at: 'desc' }, take: 1, select: { created_at: true, user: { select: { name: true } } } },
    },
    orderBy: { updated_at: 'desc' },
  })
  return tickets.map(({ events, ...t }) => ({ ...t, linkedAt: events[0]?.created_at ?? null, linkedBy: events[0]?.user?.name ?? null }))
}
