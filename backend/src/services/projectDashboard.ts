/**
 * Minha Área, Dashboard do projeto e Visão Geral.
 *
 * Todos os indicadores saem de uma consulta só por escopo e são agregados em
 * memória: o volume por projeto é pequeno e uma dúzia de `count` separados
 * custaria mais round-trips do que trazer as tasks uma vez.
 */
import prisma from '../config/prisma'
import { visibleProjectsWhere } from './projectAccess'
import { overdueCutoff } from './projectInsights'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfToday(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

/** Domingo→sábado da semana corrente, para o bucket "esta semana". */
function endOfWeek(): Date {
  const d = endOfToday()
  d.setDate(d.getDate() + (6 - d.getDay()))
  return d
}

// ---------------------------------------------------------------------------
// Minha Área
// ---------------------------------------------------------------------------

export async function getMyArea(userId: string) {
  const now = new Date()
  const todayEnd = endOfToday()
  const weekEnd = endOfWeek()

  // Tasks onde o usuário é responsável direto OU co-responsável.
  const tasks = await prisma.task.findMany({
    where: {
      archived_at: null,
      OR: [{ assignee_id: userId }, { multi_assignees: { some: { user_id: userId } } }],
      status: { category: { notIn: ['done', 'cancelled'] } },
      project: { archived_at: null, ...(await visibleProjectsWhere(userId)) }, // só projetos ativos que ainda enxerga
    },
    include: {
      project: { select: { id: true, name: true } },
      status: { select: { id: true, name: true, color: true, category: true } },
    },
    orderBy: { due_date: 'asc' },
  })

  const counts = { today: 0, overdue: 0, thisWeek: 0, upcoming: 0, noDueDate: 0 }
  const cutoff = overdueCutoff(now)
  for (const task of tasks) {
    // Começa hoje conta em "Hoje" (mesma regra do filtro de Minhas Tarefas), salvo se já atrasou.
    const startsToday = !!task.start_date && task.start_date >= startOfToday() && task.start_date <= todayEnd
    if (!task.due_date) { if (startsToday) counts.today++; else counts.noDueDate++; continue }
    if (task.due_date < cutoff) counts.overdue++
    else if (task.due_date <= todayEnd || startsToday) counts.today++
    else if (task.due_date <= weekEnd) counts.thisWeek++
    else counts.upcoming++
  }

  const pendingApprovals = await prisma.approval.count({
    where: { approver_id: userId, status: 'pending' },
  })

  const priorities = tasks.filter((t) => t.priority === 'critical' || t.priority === 'high').slice(0, 10)

  // Distribuição da semana para a Agenda: um bucket por dia.
  const agenda: Array<{ date: string; count: number }> = []
  for (let i = 0; i < 7; i++) {
    const day = new Date(startOfToday().getTime() + i * DAY_MS)
    const dayEnd = new Date(day.getTime() + DAY_MS - 1)
    agenda.push({
      date: day.toISOString().slice(0, 10),
      count: tasks.filter((t) => t.due_date && t.due_date >= day && t.due_date <= dayEnd).length,
    })
  }

  const memberships = await prisma.projectMember.findMany({
    where: { user_id: userId },
    select: { project_id: true },
  })
  const projectIds = memberships.map((m) => m.project_id)

  const recentProjects = await prisma.project.findMany({
    where: { id: { in: projectIds }, archived_at: null },
    orderBy: { updated_at: 'desc' },
    take: 5,
    select: { id: true, name: true, description: true, target_date: true },
  })

  const projectStats = await Promise.all(
    recentProjects.map(async (project) => {
      const [total, done, overdue] = await Promise.all([
        prisma.task.count({ where: { project_id: project.id, archived_at: null } }),
        prisma.task.count({ where: { project_id: project.id, archived_at: null, status: { category: 'done' } } }),
        prisma.task.count({
          where: {
            project_id: project.id,
            archived_at: null,
            due_date: { lt: overdueCutoff(now) },
            status: { category: { notIn: ['done', 'cancelled'] } },
          },
        }),
      ])
      return {
        ...project,
        totalTasks: total,
        doneTasks: done,
        overdueTasks: overdue,
        progress: total > 0 ? Math.round((done / total) * 100) : 0,
      }
    }),
  )

  const recentActivity = projectIds.length
    ? await prisma.taskActivity.findMany({
        where: { task: { project_id: { in: projectIds } } },
        orderBy: { created_at: 'desc' },
        take: 15,
        include: {
          actor: { select: { id: true, name: true, avatar: true } },
          task: { select: { id: true, seq: true, key: true, title: true, project_id: true } },
        },
      })
    : []

  return {
    counts: { ...counts, approvals: pendingApprovals },
    priorities,
    agenda,
    recentProjects: projectStats,
    recentActivity,
  }
}

// ---------------------------------------------------------------------------
// Dashboard / Visão Geral do projeto
// ---------------------------------------------------------------------------

export async function getProjectDashboard(projectId: string) {
  const now = new Date()

  const [project, tasks, statuses] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true, name: true, description: true, start_date: true, target_date: true,
        owner: { select: { id: true, name: true, avatar: true } },
        _count: { select: { members: true } },
      },
    }),
    prisma.task.findMany({
      where: { project_id: projectId, archived_at: null },
      include: {
        status: { select: { id: true, name: true, color: true, category: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        list: { select: { id: true, name: true } },
      },
    }),
    prisma.projectStatus.findMany({ where: { project_id: projectId }, orderBy: { position: 'asc' } }),
  ])

  const byStatus: Record<string, { name: string; color: string; count: number }> = {}
  for (const status of statuses) {
    byStatus[status.id] = { name: status.name, color: status.color, count: 0 }
  }

  const byPriority: Record<string, number> = { critical: 0, high: 0, normal: 0, low: 0, none: 0 }
  const byAssignee = new Map<string, { id: string; name: string; avatar: string | null; count: number }>()
  const byList = new Map<string, { id: string; name: string; count: number }>()

  let done = 0
  let overdue = 0
  let dueSoon = 0
  const soon = new Date(now.getTime() + 3 * DAY_MS)
  const cutoff = overdueCutoff(now)

  for (const task of tasks) {
    if (byStatus[task.status_id]) byStatus[task.status_id].count++
    byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1

    const isClosed = task.status.category === 'done' || task.status.category === 'cancelled'
    if (task.status.category === 'done') done++

    if (task.due_date && !isClosed) {
      if (task.due_date < cutoff) overdue++
      else if (task.due_date <= soon) dueSoon++
    }

    if (task.assignee) {
      const entry = byAssignee.get(task.assignee.id) ?? { id: task.assignee.id, name: task.assignee.name, avatar: task.assignee.avatar, count: 0 }
      entry.count++
      byAssignee.set(task.assignee.id, entry)
    }
    if (task.list) {
      const entry = byList.get(task.list.id) ?? { id: task.list.id, name: task.list.name, count: 0 }
      entry.count++
      byList.set(task.list.id, entry)
    }
  }

  const [pendingApprovals, milestones, recentActivity] = await Promise.all([
    prisma.approval.count({ where: { status: 'pending', task: { project_id: projectId } } }),
    prisma.task.findMany({
      where: { project_id: projectId, archived_at: null, is_milestone: true },
      select: { id: true, seq: true, key: true, title: true, due_date: true, status: { select: { name: true, color: true, category: true } } },
      orderBy: { due_date: 'asc' },
    }),
    prisma.taskActivity.findMany({
      where: { task: { project_id: projectId } },
      orderBy: { created_at: 'desc' },
      take: 20,
      include: {
        actor: { select: { id: true, name: true, avatar: true } },
        task: { select: { id: true, seq: true, key: true, title: true } },
      },
    }),
  ])

  const upcoming = tasks
    .filter((t) => t.due_date && t.status.category !== 'done' && t.status.category !== 'cancelled' && t.due_date >= cutoff)
    .sort((a, b) => a.due_date!.getTime() - b.due_date!.getTime())
    .slice(0, 5)
    .map((t) => ({ id: t.id, seq: t.seq, key: t.key, title: t.title, dueDate: t.due_date }))

  return {
    project,
    totals: {
      total: tasks.length,
      done,
      open: tasks.filter((t) => t.status.category !== 'done' && t.status.category !== 'cancelled').length,
      overdue,
      dueSoon,
      progress: tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0,
      pendingApprovals,
    },
    byStatus: Object.entries(byStatus).map(([id, v]) => ({ statusId: id, ...v })),
    byPriority,
    byAssignee: [...byAssignee.values()],
    byList: [...byList.values()],
    milestones,
    upcoming,
    recentActivity,
  }
}

/**
 * Workload da equipe: tasks por pessoa por dia da semana corrente.
 * Base é a data de prazo — timesheet está fora desta versão.
 */
export async function getProjectWorkload(projectId: string) {
  const weekStart = startOfToday()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS)

  const tasks = await prisma.task.findMany({
    where: {
      project_id: projectId,
      archived_at: null,
      due_date: { gte: weekStart, lt: weekEnd },
      status: { category: { notIn: ['done', 'cancelled'] } },
    },
    select: { due_date: true, assignee: { select: { id: true, name: true } } },
  })

  const byUser = new Map<string, { userId: string; name: string; days: number[] }>()
  for (const task of tasks) {
    if (!task.assignee || !task.due_date) continue
    const entry = byUser.get(task.assignee.id) ?? { userId: task.assignee.id, name: task.assignee.name, days: Array(7).fill(0) }
    entry.days[task.due_date.getDay()]++
    byUser.set(task.assignee.id, entry)
  }

  return { weekStart: weekStart.toISOString().slice(0, 10), entries: [...byUser.values()] }
}

/**
 * Gantt/Timeline: tasks datadas com suas dependências, para o
 * frontend desenhar as barras e as setas sem uma segunda chamada.
 */
export async function getProjectTimeline(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: {
      project_id: projectId,
      archived_at: null,
      OR: [{ start_date: { not: null } }, { due_date: { not: null } }],
    },
    select: {
      id: true, seq: true, key: true, title: true, start_date: true, due_date: true,
      is_milestone: true, parent_id: true, priority: true,
      status: { select: { id: true, name: true, color: true, category: true } },
      assignee: { select: { id: true, name: true, avatar: true } },
      subtasks: { where: { archived_at: null }, select: { id: true, status: { select: { category: true } } } },
    },
    orderBy: [{ start_date: 'asc' }, { due_date: 'asc' }],
  })

  const dependencies = await prisma.taskDependency.findMany({
    where: { task: { project_id: projectId } },
    select: { id: true, task_id: true, depends_on_id: true },
  })

  return {
    tasks: tasks.map((t) => {
      const total = t.subtasks.length
      const done = t.subtasks.filter((s) => s.status.category === 'done').length
      return {
        ...t,
        subtasks: undefined,
        progress: total > 0 ? Math.round((done / total) * 100) : t.status.category === 'done' ? 100 : 0,
      }
    }),
    dependencies,
  }
}
