/**
 * Modais de detalhe dos painéis de Projetos: projeto, pessoa, task e listas de tasks
 * por trás de um número. Mesmas réguas do BI (atraso a partir do dia seguinte ao
 * prazo, "próximos" em 7 dias, ciclo em horas úteis), para o modal nunca desmentir a tabela.
 */
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { loadProjectTime, getTaskTime } from './taskTime'
import { overdueCutoff } from './projectInsights'
import { getProjectDashboard } from './projectDashboard'
import { loadFullTask } from './taskFull'
import { getTaskTimeline } from './taskActivity'
import { teamUserIds, visibleProjectsWhere } from './projectAccess'

const DAY = 86_400_000
const WEEKS = 8
const LIST_LIMIT = 100
const PREVIEW = 10
const SOON_DAYS = 7

type Row = Awaited<ReturnType<typeof loadProjectTime>>[number]

const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
function median(xs: number[]) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const hours = (minutes: number | null) => (minutes == null ? null : round1(minutes / 60))

const isDone = (r: Row) => r.status?.category === 'done'
const isClosed = (r: Row) => r.status?.category === 'done' || r.status?.category === 'cancelled'
const involves = (r: Row, userId: string) => r.task.assignee_id === userId || r.task.multi_assignees.some((a) => a.user_id === userId)

export type DrillKind = 'all' | 'open' | 'done' | 'overdue' | 'upcoming' | 'running'
export type DrillFilter = {
  kind?: DrillKind
  categories?: string[]
  statusId?: string
  priority?: string
  /** Nome do tipo ("Feature"), como agrupa o tempo médio por tipo. Só concluídas no período, com ciclo. */
  typeName?: string
  assigneeId?: string
  days?: number
}
type Ctx = { cutoff: Date; soon: Date; since: Date; typeNames: Map<string, string> }

function context(now: Date, days = 90, typeNames = new Map<string, string>()): Ctx {
  return { cutoff: overdueCutoff(now), soon: new Date(now.getTime() + SOON_DAYS * DAY), since: new Date(now.getTime() - days * DAY), typeNames }
}

const overdue = (r: Row, c: Ctx) => !isClosed(r) && !!r.task.due_date && r.task.due_date < c.cutoff
const upcoming = (r: Row, c: Ctx) => !isClosed(r) && !!r.task.due_date && r.task.due_date >= c.cutoff && r.task.due_date <= c.soon

export function matchesDrill(r: Row, f: DrillFilter, c: Ctx): boolean {
  if (f.statusId && r.task.status_id !== f.statusId) return false
  if (f.priority && r.task.priority !== f.priority) return false
  if (f.categories?.length && !f.categories.includes(r.status?.category ?? '')) return false
  if (f.assigneeId && !involves(r, f.assigneeId)) return false
  if (f.typeName) {
    const name = (r.task.task_type_id ? c.typeNames.get(r.task.task_type_id) : undefined)?.trim() || 'Sem tipo'
    if (name.toLocaleLowerCase('pt-BR') !== f.typeName.trim().toLocaleLowerCase('pt-BR')) return false
    if (r.cycleMinutes == null || !r.time.completedAt || r.time.completedAt < c.since) return false
  }
  switch (f.kind) {
    case 'open': return !isClosed(r)
    case 'done': return isDone(r)
    case 'overdue': return overdue(r, c)
    case 'upcoming': return upcoming(r, c)
    case 'running': return r.time.running
    default: return true
  }
}

/** Concluídas: mais recentes primeiro. Demais: prazo mais próximo primeiro, sem prazo por último. */
function byRelevance(kind: DrillKind | undefined) {
  if (kind === 'done') return (a: Row, b: Row) => (b.time.completedAt?.getTime() ?? 0) - (a.time.completedAt?.getTime() ?? 0)
  return (a: Row, b: Row) => (a.task.due_date?.getTime() ?? Infinity) - (b.task.due_date?.getTime() ?? Infinity) || a.task.seq - b.task.seq
}

/** Linhas de tabela: acrescenta ao tempo da task a cor do status, o projeto e o responsável. */
async function toTaskRows(rows: Row[], cutoff: Date) {
  if (rows.length === 0) return []
  const extra = await prisma.task.findMany({
    where: { id: { in: rows.map((r) => r.task.id) } },
    select: {
      id: true,
      status: { select: { color: true } },
      project: { select: { name: true, color: true } },
      assignee: { select: { id: true, name: true, avatar: true } },
    },
  })
  const byId = new Map(extra.map((t) => [t.id, t]))
  return rows.map((r) => {
    const x = byId.get(r.task.id)
    return {
      taskId: r.task.id, projectId: r.task.project_id, projectName: x?.project.name ?? '—', projectColor: x?.project.color ?? null,
      key: r.task.key, seq: r.task.seq, title: r.task.title,
      status: { name: r.status?.name ?? '—', color: x?.status.color ?? null, category: r.status?.category ?? 'open' },
      priority: r.task.priority, dueDate: r.task.due_date, assignee: x?.assignee ?? null,
      overdue: !isClosed(r) && !!r.task.due_date && r.task.due_date < cutoff,
      activeMinutes: r.time.activeMinutes, running: r.time.running, startedAt: r.time.startedAt, completedAt: r.time.completedAt,
      cycleHours: hours(r.cycleMinutes),
    }
  })
}

/** Semanas (segunda a domingo, UTC) com entregas e tasks criadas, da mais antiga à atual. */
export function weeklyFlow(rows: Row[], now: Date, weeks = WEEKS) {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const start = monday.getTime() - (weeks - 1) * 7 * DAY
  const buckets = Array.from({ length: weeks }, (_, i) => ({ weekStart: new Date(start + i * 7 * DAY).toISOString().slice(0, 10), completed: 0, created: 0 }))
  const index = (d: Date) => Math.floor((d.getTime() - start) / (7 * DAY))
  for (const r of rows) {
    const created = buckets[index(r.task.created_at)]
    if (created) created.created++
    if (isDone(r) && r.time.completedAt) {
      const done = buckets[index(r.time.completedAt)]
      if (done) done.completed++
    }
  }
  return buckets
}

function cycleStats(rows: Row[]) {
  const cycles = rows.map((r) => r.cycleMinutes).filter((m): m is number => m != null)
  return { avgCycleHours: hours(avg(cycles)), medianCycleHours: hours(median(cycles)) }
}

// ── Projeto ──────────────────────────────────────────────────────────────────

export async function getProjectDrill(projectId: string, now = new Date()) {
  const [dashboard, rows, meta, sprint, linkedTickets] = await Promise.all([
    getProjectDashboard(projectId),
    loadProjectTime([projectId]),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { color: true, privacy: true } }),
    prisma.sprint.findFirst({ where: { project_id: projectId, status: 'active' }, orderBy: { start_date: 'desc' }, select: { id: true, name: true, start_date: true, end_date: true } }),
    prisma.ticket.count({ where: { project_task: { project_id: projectId }, deleted_at: null } }),
  ])
  const c = context(now)
  const open = rows.filter((r) => !isClosed(r))
  const overdueRows = open.filter((r) => overdue(r, c)).sort(byRelevance('overdue'))
  const upcomingRows = open.filter((r) => upcoming(r, c)).sort(byRelevance('upcoming'))
  const runningRows = rows.filter((r) => r.time.running).sort(byRelevance('running'))

  const counts = new Map<string, { open: number; overdue: number; running: number; done: number }>()
  for (const r of rows) {
    for (const id of new Set([...(r.task.assignee_id ? [r.task.assignee_id] : []), ...r.task.multi_assignees.map((a) => a.user_id)])) {
      const n = counts.get(id) ?? { open: 0, overdue: 0, running: 0, done: 0 }
      if (!isClosed(r)) n.open++
      if (overdue(r, c)) n.overdue++
      if (r.time.running) n.running++
      if (isDone(r)) n.done++
      counts.set(id, n)
    }
  }
  const users = counts.size ? await prisma.user.findMany({ where: { id: { in: [...counts.keys()] } }, select: { id: true, name: true, avatar: true } }) : []
  const people = users.map((u) => ({ userId: u.id, name: u.name, avatar: u.avatar, ...counts.get(u.id)! }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, 'pt-BR'))

  const sprintRows = sprint ? rows.filter((r) => r.task.sprint_id === sprint.id) : []
  const [overdueList, upcomingList, runningList] = await Promise.all([
    toTaskRows(overdueRows.slice(0, PREVIEW), c.cutoff),
    toTaskRows(upcomingRows.slice(0, PREVIEW), c.cutoff),
    toTaskRows(runningRows.slice(0, PREVIEW), c.cutoff),
  ])

  return {
    project: { ...dashboard.project, color: meta.color, privacy: meta.privacy },
    totals: {
      total: rows.length,
      open: open.length,
      done: rows.filter(isDone).length,
      cancelled: rows.filter((r) => r.status?.category === 'cancelled').length,
      overdue: overdueRows.length,
      upcoming: upcomingRows.length,
      running: runningRows.length,
      pendingApprovals: dashboard.totals.pendingApprovals,
      progress: dashboard.totals.progress,
      activeMinutes: rows.reduce((n, r) => n + r.time.activeMinutes, 0),
      linkedTickets,
      ...cycleStats(rows.filter((r) => isDone(r) && !!r.time.completedAt && r.time.completedAt >= c.since)),
    },
    sprint: sprint && { ...sprint, total: sprintRows.length, done: sprintRows.filter(isDone).length },
    byStatus: dashboard.byStatus,
    byPriority: dashboard.byPriority,
    weekly: weeklyFlow(rows, now),
    people,
    overdue: overdueList,
    upcoming: upcomingList,
    running: runningList,
    milestones: dashboard.milestones,
    recentActivity: dashboard.recentActivity,
  }
}

// ── Lista de tasks por trás de um número ─────────────────────────────────────

export async function getTaskListDrill(projectIds: string[], filter: DrillFilter, canOpenPerson: (id: string) => boolean, now = new Date()) {
  if (projectIds.length === 0) return { total: 0, limit: LIST_LIMIT, tasks: [], byProject: [], byAssignee: [] }
  const [rows, types] = await Promise.all([
    loadProjectTime(projectIds),
    filter.typeName ? prisma.taskType.findMany({ where: { project_id: { in: projectIds } }, select: { id: true, name: true } }) : [],
  ])
  const c = context(now, filter.days, new Map(types.map((t) => [t.id, t.name])))
  const matched = rows.filter((r) => matchesDrill(r, filter, c)).sort(byRelevance(filter.kind))

  const perProject = new Map<string, number>()
  const perPerson = new Map<string, number>()
  for (const r of matched) {
    perProject.set(r.task.project_id, (perProject.get(r.task.project_id) ?? 0) + 1)
    const who = r.task.assignee_id ?? 'none'
    perPerson.set(who, (perPerson.get(who) ?? 0) + 1)
  }
  const [projects, users, tasks] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: [...perProject.keys()] } }, select: { id: true, name: true, color: true } }),
    prisma.user.findMany({ where: { id: { in: [...perPerson.keys()].filter((id) => id !== 'none') } }, select: { id: true, name: true, avatar: true } }),
    toTaskRows(matched.slice(0, LIST_LIMIT), c.cutoff),
  ])
  return {
    total: matched.length,
    limit: LIST_LIMIT,
    tasks,
    byProject: projects.map((p) => ({ projectId: p.id, name: p.name, color: p.color, count: perProject.get(p.id)! })).sort((a, b) => b.count - a.count),
    byAssignee: [
      ...users.map((u) => ({ userId: u.id as string | null, name: u.name, avatar: u.avatar, count: perPerson.get(u.id)!, canOpen: canOpenPerson(u.id) })),
      ...(perPerson.has('none') ? [{ userId: null, name: 'Sem responsável', avatar: null, count: perPerson.get('none')!, canOpen: false }] : []),
    ].sort((a, b) => b.count - a.count),
  }
}

// ── Pessoa ───────────────────────────────────────────────────────────────────

/** Quem o usuário pode abrir fora de um projeto: ele mesmo e quem está abaixo no organograma; admin, todos. */
export async function personAccess(viewerId: string, role: string) {
  if (role === 'admin') return () => true
  const allowed = new Set([viewerId, ...(await teamUserIds(viewerId))])
  return (id: string) => allowed.has(id)
}

/**
 * Detalhe da pessoa, sempre dentro do que o usuário enxerga: só os projetos visíveis
 * para ele, ou só `projectId` quando abriu a partir de um projeto.
 */
export async function getPersonDrill(viewerId: string, personId: string, opts: { projectId?: string; days?: number } = {}, now = new Date()) {
  const days = opts.days ?? 90
  const person = await prisma.user.findFirst({
    where: { id: personId, deleted_at: null },
    select: { id: true, name: true, avatar: true, department: true, manager: { select: { name: true } } },
  })
  if (!person) throw new AppError(404, 'Pessoa não encontrada', 'NOT_FOUND')

  const projects = await prisma.project.findMany({
    where: opts.projectId
      ? { id: opts.projectId }
      : {
          ...(await visibleProjectsWhere(viewerId)),
          archived_at: null,
          tasks: { some: { archived_at: null, OR: [{ assignee_id: personId }, { multi_assignees: { some: { user_id: personId } } }] } },
        },
    select: { id: true, name: true, color: true },
  })
  const empty = { days, person, scopedTo: null as string | null, totals: { open: 0, overdue: 0, upcoming: 0, running: 0, done: 0, activeMinutes: 0, avgCycleHours: null, medianCycleHours: null }, byProject: [], weekly: [], running: [], overdue: [], upcoming: [], recent: [] }
  if (projects.length === 0) return empty

  const rows = await loadProjectTime(projects.map((p) => p.id))
  const mine = rows.filter((r) => involves(r, personId))
  const c = context(now, days)
  const doneInPeriod = mine.filter((r) => isDone(r) && !!r.time.completedAt && r.time.completedAt >= c.since)
  const overdueRows = mine.filter((r) => overdue(r, c)).sort(byRelevance('overdue'))
  const upcomingRows = mine.filter((r) => upcoming(r, c)).sort(byRelevance('upcoming'))
  const runningRows = mine.filter((r) => r.time.running).sort(byRelevance('running'))

  const [running, overdueList, upcomingList, recent] = await Promise.all([
    toTaskRows(runningRows.slice(0, PREVIEW), c.cutoff),
    toTaskRows(overdueRows.slice(0, PREVIEW), c.cutoff),
    toTaskRows(upcomingRows.slice(0, PREVIEW), c.cutoff),
    toTaskRows([...doneInPeriod].sort(byRelevance('done')).slice(0, PREVIEW), c.cutoff),
  ])

  return {
    days,
    person,
    scopedTo: opts.projectId ? projects[0].name : null,
    totals: {
      open: mine.filter((r) => !isClosed(r)).length,
      overdue: overdueRows.length,
      upcoming: upcomingRows.length,
      running: runningRows.length,
      done: doneInPeriod.length,
      // Horas em que ela era responsável, mesmo que a task já esteja com outra pessoa.
      activeMinutes: rows.reduce((n, r) => n + (r.time.byAssignee[personId] ?? 0), 0),
      ...cycleStats(doneInPeriod),
    },
    byProject: projects.map((p) => {
      const own = mine.filter((r) => r.task.project_id === p.id)
      const done = doneInPeriod.filter((r) => r.task.project_id === p.id)
      return {
        projectId: p.id, name: p.name, color: p.color,
        open: own.filter((r) => !isClosed(r)).length,
        overdue: own.filter((r) => overdue(r, c)).length,
        running: own.filter((r) => r.time.running).length,
        done: done.length,
        avgCycleHours: cycleStats(done).avgCycleHours,
      }
    }).filter((p) => p.open > 0 || p.done > 0).sort((a, b) => b.open - a.open || b.done - a.done),
    weekly: weeklyFlow(mine, now),
    running,
    overdue: overdueList,
    upcoming: upcomingList,
    recent,
  }
}

// ── Task ─────────────────────────────────────────────────────────────────────

const excerpt = (body: string) => (body.length > 280 ? `${body.slice(0, 280).trimEnd()}…` : body)
const nameOnly = (u: { id: string; name: string }) => ({ id: u.id, name: u.name })

export async function getTaskDrill(projectId: string, taskId: string, viewer?: Parameters<typeof loadFullTask>[1]) {
  const task = await loadFullTask(taskId, viewer)
  if (!task || task.project_id !== projectId) throw new AppError(404, 'Task não encontrada', 'TASK_NOT_FOUND')
  const [time, timeline] = await Promise.all([
    getTaskTime(projectId, taskId).catch(() => null), // arquivada não tem relógio
    getTaskTimeline(projectId, taskId, 40),
  ])
  return {
    id: task.id, projectId: task.project_id, project: task.project, key: task.key, seq: task.seq, title: task.title,
    description: task.description, priority: task.priority, status: task.status, taskType: task.task_type, list: task.list, sprint: task.sprint,
    parent: task.parent, assignees: task.assignees.map(nameOnly), creator: nameOnly(task.creator),
    createdAt: task.created_at, startDate: task.start_date, dueDate: task.due_date, isMilestone: task.is_milestone, storyPoints: task.story_points,
    archivedAt: task.archived_at, tags: task.tags, checklist: task.checklist, subtasks: task.subtasks,
    blockedBy: task.blocked_by.map((d) => d.task), blocks: task.blocks.map((d) => d.task),
    tickets: task.tickets, documents: task.documents, commentsCount: task.comments_count,
    comments: task.comments.slice(-3).map((c) => ({ id: c.id, body: excerpt(c.body), createdAt: c.created_at, author: nameOnly(c.author) })),
    time, timeline,
  }
}
