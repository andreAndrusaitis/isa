import prisma from '../config/prisma'
import { visibleProjectsWhere } from './projectAccess'
import { loadProjectTime } from './taskTime'
import { overdueCutoff } from './projectInsights'

/**
 * Para o manager autenticado: subordinados diretos (User.manager_id) e,
 * para cada um, contagem bruta de tasks abertas nos projetos que o manager
 * enxerga — os dele e os da equipe (leitura).
 *
 * Deliberadamente sem ranking/ordenação por contagem: é
 * carga de trabalho, não ranking. A resposta é um mapa userId->taskCount,
 * a ordenação (se houver) é decisão do frontend, nunca um campo de
 * posição/nota calculado aqui.
 */
export async function getTeamWorkload(managerId: string) {
  const subordinates = await prisma.user.findMany({
    where: { manager_id: managerId, deleted_at: null },
    select: { id: true, name: true, avatar: true },
  })
  if (subordinates.length === 0) return []

  const managerProjects = await prisma.project.findMany({ where: { ...(await visibleProjectsWhere(managerId)), archived_at: null }, select: { id: true } })
  const projectIds = managerProjects.map((p) => p.id)
  if (projectIds.length === 0) return subordinates.map((s) => ({ userId: s.id, name: s.name, avatar: s.avatar, taskCount: 0 }))

  const subordinateIds = subordinates.map((s) => s.id)
  const tasks = await prisma.task.findMany({
    // Carga = trabalho em aberto. Concluída/cancelada não pesa (antes contava tudo e
    // quem já entregou muito aparecia como "sobrecarregado").
    where: {
      project_id: { in: projectIds }, assignee_id: { in: subordinateIds }, archived_at: null,
      status: { category: { notIn: ['done', 'cancelled'] } },
    },
    select: { assignee_id: true },
  })

  const countByUser = new Map<string, number>()
  for (const task of tasks) {
    if (!task.assignee_id) continue
    countByUser.set(task.assignee_id, (countByUser.get(task.assignee_id) ?? 0) + 1)
  }

  return subordinates.map((s) => ({ userId: s.id, name: s.name, avatar: s.avatar, taskCount: countByUser.get(s.id) ?? 0 }))
}

export async function getDashboardGlobal(managerId: string) {
  const managerProjects = await prisma.project.findMany({
    where: { ...(await visibleProjectsWhere(managerId)), archived_at: null },
    select: { id: true },
  })
  const projectIds = managerProjects.map((p) => p.id)
  if (projectIds.length === 0) {
    return { totalTasks: 0, byStatus: {}, overdueCount: 0, upcomingCount: 0 }
  }

  const tasks = await prisma.task.findMany({
    where: { project_id: { in: projectIds }, archived_at: null },
    include: { status: true },
  })

  const byStatus: Record<string, number> = {}
  let overdueCount = 0
  let upcomingCount = 0
  const now = new Date()
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const cutoff = overdueCutoff(now)

  for (const task of tasks) {
    byStatus[task.status.category] = (byStatus[task.status.category] ?? 0) + 1
    // Atraso e "próximos 7 dias" só para o que ainda está aberto.
    const closed = task.status.category === 'done' || task.status.category === 'cancelled'
    if (closed || !task.due_date) continue
    if (task.due_date < cutoff) overdueCount++
    else if (task.due_date <= soon) upcomingCount++
  }

  return { totalTasks: tasks.length, byStatus, overdueCount, upcomingCount }
}

export type CycleByType = { type: string; color: string | null; tasks: number; avgHours: number; medianHours: number }

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Média e mediana do ciclo (1ª entrada em andamento → conclusão, horas úteis)
 * das tasks concluídas no período, por tipo. Tipos são por projeto: agrupa
 * pelo nome ("Feature" de todos os projetos vira uma linha só).
 */
export function summarizeCycleByType(
  rows: Array<{ task: { task_type_id: string | null }; time: { completedAt: Date | null }; cycleMinutes: number | null }>,
  types: Map<string, { name: string; color: string }>,
  since: Date,
): CycleByType[] {
  const groups = new Map<string, { type: string; color: string | null; minutes: number[] }>()
  for (const r of rows) {
    if (r.cycleMinutes == null || !r.time.completedAt || r.time.completedAt < since) continue
    const t = r.task.task_type_id ? types.get(r.task.task_type_id) : undefined
    const name = t?.name.trim() || 'Sem tipo'
    const key = name.toLocaleLowerCase('pt-BR')
    const g = groups.get(key) ?? { type: name, color: t?.color ?? null, minutes: [] }
    g.minutes.push(r.cycleMinutes)
    groups.set(key, g)
  }
  return [...groups.values()]
    .map(({ type, color, minutes }) => {
      const sorted = [...minutes].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
      return { type, color, tasks: minutes.length, avgHours: round1(minutes.reduce((a, b) => a + b, 0) / minutes.length / 60), medianHours: round1(median / 60) }
    })
    .sort((a, b) => b.tasks - a.tasks || a.type.localeCompare(b.type, 'pt-BR'))
}

/** Ciclo médio por tipo nos projetos que o usuário enxerga (mesma base do dashboard global). */
export async function getCycleTimeByType(userId: string, days = 90) {
  const projects = await prisma.project.findMany({ where: { ...(await visibleProjectsWhere(userId)), archived_at: null }, select: { id: true } })
  const projectIds = projects.map((p) => p.id)
  if (projectIds.length === 0) return { days, byType: [] as CycleByType[] }
  const [rows, types] = await Promise.all([
    loadProjectTime(projectIds),
    prisma.taskType.findMany({ where: { project_id: { in: projectIds } }, select: { id: true, name: true, color: true } }),
  ])
  const since = new Date(Date.now() - days * 86_400_000)
  return { days, byType: summarizeCycleByType(rows, new Map(types.map((t) => [t.id, t])), since) }
}
