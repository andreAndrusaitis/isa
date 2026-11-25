/**
 * Relatórios pessoais de Projetos: "Meu ciclo por projeto" (Minha Área do analista)
 * e a lente "Meus projetos" do BI (projetos que a pessoa é dona ou gerente, em vez
 * dos projetos em que a equipe dela participa). Ciclo = 1ª entrada em andamento →
 * conclusão, em horas úteis (loadProjectTime).
 */
import prisma from '../config/prisma'
import { loadProjectTime } from './taskTime'
import { overdueCutoff } from './projectInsights'
import { summarizeCycleByType, type CycleByType } from './projectsTeam'
import { getBusinessHoursConfig } from './businessHours'
import { getBusinessMinutesBetween, nationalHolidays } from '../utils/businessHours'

const DAY = 86_400_000
const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
function median(xs: number[]) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const hours = (minutes: number | null) => (minutes == null ? null : round1(minutes / 60))

type Row = Awaited<ReturnType<typeof loadProjectTime>>[number]
const isDone = (r: Row) => r.status?.category === 'done'
const isClosed = (r: Row) => r.status?.category === 'done' || r.status?.category === 'cancelled'
const doneSince = (r: Row, since: Date) => isDone(r) && !!r.time.completedAt && r.time.completedAt >= since

/**
 * Meu ciclo por projeto: nos projetos de que sou membro (não arquivados), as tasks
 * em que sou responsável ou co-responsável. Concluídas no período (média/mediana do
 * ciclo), abertas e em andamento agora, últimas 10 entregas e o que está rodando.
 */
export async function getMyCycle(userId: string, days = 90, now = new Date()) {
  const projects = await prisma.project.findMany({
    where: { archived_at: null, members: { some: { user_id: userId } } },
    select: { id: true, name: true, color: true },
  })
  if (projects.length === 0) return { days, projects: [], recent: [], current: [] }
  const byId = new Map(projects.map((p) => [p.id, p]))
  const [rows, cfg] = await Promise.all([loadProjectTime(projects.map((p) => p.id)), getBusinessHoursConfig()])
  const mine = rows.filter((r) => r.task.assignee_id === userId || r.task.multi_assignees.some((a) => a.user_id === userId))
  const since = new Date(now.getTime() - days * DAY)

  const perProject = projects.map((p) => {
    const own = mine.filter((r) => r.task.project_id === p.id)
    const done = own.filter((r) => doneSince(r, since))
    const cycles = done.map((r) => r.cycleMinutes).filter((m): m is number => m != null)
    return {
      projectId: p.id, name: p.name, color: p.color,
      done: done.length,
      avgCycleHours: hours(avg(cycles)),
      medianCycleHours: hours(median(cycles)),
      open: own.filter((r) => !isClosed(r)).length,
      inProgress: own.filter((r) => r.time.running).length,
    }
  }).filter((p) => p.done > 0 || p.open > 0)
    .sort((a, b) => b.done - a.done || b.open - a.open || a.name.localeCompare(b.name, 'pt-BR'))

  const base = (r: Row) => ({
    taskId: r.task.id, projectId: r.task.project_id, key: r.task.key, seq: r.task.seq, title: r.task.title,
    projectName: byId.get(r.task.project_id)?.name ?? '—', startedAt: r.time.startedAt,
  })
  const recent = mine.filter((r) => doneSince(r, since))
    .sort((a, b) => b.time.completedAt!.getTime() - a.time.completedAt!.getTime())
    .slice(0, 10)
    .map((r) => ({ ...base(r), completedAt: r.time.completedAt, cycleHours: hours(r.cycleMinutes) }))

  // Horas úteis desde que entrou em andamento, pausas incluídas (mesma régua do ciclo).
  const running = mine.filter((r) => r.time.running && r.time.startedAt)
  const earliest = running.reduce((d, r) => (r.time.startedAt! < d ? r.time.startedAt! : d), now)
  const holidays: string[] = []
  for (let y = earliest.getUTCFullYear(); y <= now.getUTCFullYear() + 1; y++) holidays.push(...nationalHolidays(y))
  const current = running
    .sort((a, b) => a.time.startedAt!.getTime() - b.time.startedAt!.getTime())
    .map((r) => ({ ...base(r), statusName: r.status?.name ?? null, hoursSoFar: hours(getBusinessMinutesBetween(r.time.startedAt!, now, cfg, holidays)) }))

  return { days, projects: perProject, recent, current }
}

/** Lente "Meus projetos": os que a pessoa é dona ou gerente (papel no projeto), não arquivados. */
export async function managedProjectIds(userId: string) {
  const projects = await prisma.project.findMany({
    where: {
      archived_at: null,
      OR: [{ owner_id: userId }, { members: { some: { user_id: userId, role: { in: ['owner', 'manager'] } } } }],
    },
    select: { id: true },
  })
  return projects.map((p) => p.id)
}

/**
 * Mesmos números de getDashboardGlobal (projectsTeam), para uma lista de projetos.
 * shortcut: duplica ~20 linhas de lá para não mexer na assinatura usada pela lente "equipe".
 */
export async function getDashboardGlobalFor(projectIds: string[], now = new Date()) {
  if (projectIds.length === 0) return { totalTasks: 0, byStatus: {}, overdueCount: 0, upcomingCount: 0 }
  const tasks = await prisma.task.findMany({
    where: { project_id: { in: projectIds }, archived_at: null },
    select: { due_date: true, status: { select: { category: true } } },
  })
  const byStatus: Record<string, number> = {}
  let overdueCount = 0
  let upcomingCount = 0
  const soon = new Date(now.getTime() + 7 * DAY)
  const cutoff = overdueCutoff(now)
  for (const task of tasks) {
    byStatus[task.status.category] = (byStatus[task.status.category] ?? 0) + 1
    const closed = task.status.category === 'done' || task.status.category === 'cancelled'
    if (closed || !task.due_date) continue
    if (task.due_date < cutoff) overdueCount++
    else if (task.due_date <= soon) upcomingCount++
  }
  return { totalTasks: tasks.length, byStatus, overdueCount, upcomingCount }
}

/** Ciclo médio por tipo para uma lista de projetos. */
export async function getCycleTimeByTypeFor(projectIds: string[], days = 90) {
  if (projectIds.length === 0) return { days, byType: [] as CycleByType[] }
  const [rows, types] = await Promise.all([
    loadProjectTime(projectIds),
    prisma.taskType.findMany({ where: { project_id: { in: projectIds } }, select: { id: true, name: true, color: true } }),
  ])
  const since = new Date(Date.now() - days * DAY)
  return { days, byType: summarizeCycleByType(rows, new Map(types.map((t) => [t.id, t])), since) }
}

/** Tabela "Meus projetos": abertas, concluídas, atrasadas (só a partir do dia seguinte ao prazo), ciclo médio no período e membros. */
export async function getMyProjectsReport(userId: string, days = 90, now = new Date()) {
  const ids = await managedProjectIds(userId)
  if (ids.length === 0) return { days, projects: [] }
  const [projects, rows] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, color: true, _count: { select: { members: true } } },
    }),
    loadProjectTime(ids),
  ])
  const since = new Date(now.getTime() - days * DAY)
  const cutoff = overdueCutoff(now)
  return {
    days,
    projects: projects.map((p) => {
      const own = rows.filter((r) => r.task.project_id === p.id)
      const open = own.filter((r) => !isClosed(r))
      const cycles = own.filter((r) => doneSince(r, since)).map((r) => r.cycleMinutes).filter((m): m is number => m != null)
      return {
        id: p.id, name: p.name, color: p.color,
        openTasks: open.length,
        doneTasks: own.filter(isDone).length,
        overdueTasks: open.filter((r) => r.task.due_date && r.task.due_date < cutoff).length,
        avgCycleHours: hours(avg(cycles)),
        membersCount: p._count.members,
      }
    }).sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name, 'pt-BR')),
  }
}
