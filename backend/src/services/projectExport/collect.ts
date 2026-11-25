import type { StatusCategory } from '@prisma/client'
import prisma from '../../config/prisma'
import { loadProjectTime } from '../taskTime'
import { sprintBurndown, lastDays, weekKey, dayKey, type Burndown } from '../projectInsights'

/**
 * Dados do dossiê de projetos: um único objeto alimenta o HTML e o Excel.
 * Tasks arquivadas ficam de fora (mesma regra dos painéis).
 * Entregas por semana e burndown saem das mesmas linhas de tempo (loadProjectTime) — chamar
 * getInsights por projeto recalculava tudo a cada projeto.
 */

export interface DossierOptions { userId: string; from: Date | null; to: Date | null }

export interface DossierTask {
  id: string; projectId: string; key: string; parentKey: string | null
  title: string; description: string | null
  status: string; statusCategory: StatusCategory; type: string | null; list: string | null; sprint: string | null
  priority: string; assignees: string[]; creator: string
  createdAt: Date; startDate: Date | null; dueDate: Date | null; completedAt: Date | null
  activeHours: number; storyPoints: number | null; isMilestone: boolean; overdue: boolean
  tags: string[]; checklist: Array<{ text: string; done: boolean }>; customFields: Array<{ name: string; value: string }>
  blockedBy: string[]; openBlockers: number; documents: string[]; attachments: string[]; tickets: string[]
}
export interface DossierActivity { projectId: string; taskKey: string; at: Date; actor: string; type: string; from: string | null; to: string | null }
export interface DossierComment { projectId: string; taskKey: string; at: Date; author: string; body: string }
export interface DossierApproval { projectId: string; taskKey: string; approver: string; status: string; comment: string | null; createdAt: Date; decidedAt: Date | null }
export interface DossierTicket { projectId: string; taskKey: string; number: string; title: string; status: string; org: string | null }
export interface DossierSprint { projectId: string; name: string; status: string; startDate: Date | null; endDate: Date | null; total: number; done: number }
export interface DossierMember { projectId: string; name: string; email: string; role: string }
export interface DossierProject {
  id: string; name: string; description: string | null; owner: string; color: string | null
  startDate: Date | null; targetDate: Date | null; archived: boolean
  totals: { total: number; done: number; open: number; overdue: number; deliveredInPeriod: number; pctDone: number }
  weekly: Array<{ week: string; completed: number }>
  burndown: Burndown | null
  workload: Array<{ name: string; open: number; activeHours: number }>
}
export interface Dossier {
  generatedAt: Date; generatedBy: string; period: { from: Date | null; to: Date | null }
  projects: DossierProject[]; tasks: DossierTask[]; activities: DossierActivity[]; comments: DossierComment[]
  approvals: DossierApproval[]; tickets: DossierTicket[]; sprints: DossierSprint[]; members: DossierMember[]
}

const FINISHED: StatusCategory[] = ['done', 'cancelled']
const WEEKS = 26
export const PRIORITY_LABEL: Record<string, string> = { critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade' }

/** Valor de campo personalizado (Json) em texto legível. */
function fieldText(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(fieldText).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export async function collectDossier(projectIds: string[], opts: DossierOptions): Promise<Dossier> {
  const now = new Date()
  const [me, projects, tasks, timeRows, attachments] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: opts.userId }, select: { name: true } }),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      orderBy: { name: 'asc' },
      include: {
        owner: { select: { name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        statuses: true, task_types: true, lists: true, sprints: { orderBy: { position: 'asc' } }, custom_fields: true,
      },
    }),
    prisma.task.findMany({
      where: { project_id: { in: projectIds }, archived_at: null },
      orderBy: [{ project_id: 'asc' }, { seq: 'asc' }],
      include: {
        multi_assignees: { select: { user_id: true } },
        checklist: { orderBy: { position: 'asc' }, select: { text: true, done: true } },
        comments: { where: { deleted_at: null }, orderBy: { created_at: 'asc' }, select: { author_id: true, body: true, created_at: true } },
        activities: { orderBy: { created_at: 'asc' }, select: { actor_id: true, type: true, from_value: true, to_value: true, created_at: true } },
        approvals: { orderBy: { created_at: 'asc' } },
        custom_field_values: { select: { custom_field_id: true, value: true } },
        tags: { select: { tag: { select: { name: true } } } },
        documents: { select: { document: { select: { title: true } } } },
        dependents: { select: { depends_on_id: true } },
        linked_tickets: { where: { deleted_at: null }, select: { display_number: true, title: true, status: true, org: { select: { name: true } } } },
      },
    }),
    loadProjectTime(projectIds),
    prisma.attachment.findMany({ where: { project_id: { in: projectIds }, entity_type: 'task' }, select: { entity_id: true, file_name: true } }),
  ])

  // Nomes de tudo que aparece como id no histórico: status, usuários, sprints, listas, tipos.
  const userIds = new Set<string>()
  for (const t of tasks) {
    userIds.add(t.creator_id)
    if (t.assignee_id) userIds.add(t.assignee_id)
    t.multi_assignees.forEach((a) => userIds.add(a.user_id))
    t.comments.forEach((c) => userIds.add(c.author_id))
    t.approvals.forEach((a) => userIds.add(a.approver_id))
    for (const a of t.activities) {
      userIds.add(a.actor_id)
      if (a.type === 'assignee_changed' || a.type === 'assignees_changed') {
        for (const v of [a.from_value, a.to_value]) (v ?? '').split(',').filter(Boolean).forEach((id) => userIds.add(id))
      }
    }
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
  const names = new Map<string, string>(users.map((u) => [u.id, u.name]))
  for (const p of projects) {
    p.statuses.forEach((s) => names.set(s.id, s.name))
    p.sprints.forEach((s) => names.set(s.id, s.name))
    p.lists.forEach((l) => names.set(l.id, l.name))
    p.task_types.forEach((t) => names.set(t.id, t.name))
  }
  const nameOf = (id: string | null | undefined) => (id ? names.get(id) ?? id : null)
  const label = (v: string | null) => (v == null ? null : v.split(',').map((id) => nameOf(id) ?? id).join(', '))

  const statusById = new Map(projects.flatMap((p) => p.statuses.map((s) => [s.id, s] as const)))
  const fieldById = new Map(projects.flatMap((p) => p.custom_fields.map((f) => [f.id, f.name] as const)))
  const timeById = new Map(timeRows.map((r) => [r.task.id, r]))
  const keyById = new Map(tasks.map((t) => [t.id, t.key ?? `#${t.seq}`]))
  const filesByTask = new Map<string, string[]>()
  for (const a of attachments) filesByTask.set(a.entity_id, [...(filesByTask.get(a.entity_id) ?? []), a.file_name])

  const inPeriod = (d: Date | null) => !!d && (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to)

  const dossierTasks: DossierTask[] = tasks.map((t) => {
    const status = statusById.get(t.status_id)!
    const time = timeById.get(t.id)
    const completedAt = status.category === 'done' ? time?.time.completedAt ?? null : null
    const assigneeIds = t.multi_assignees.length ? t.multi_assignees.map((a) => a.user_id) : t.assignee_id ? [t.assignee_id] : []
    const blockers = t.dependents.map((d) => d.depends_on_id)
    return {
      id: t.id, projectId: t.project_id, key: keyById.get(t.id)!, parentKey: t.parent_id ? keyById.get(t.parent_id) ?? null : null,
      title: t.title, description: t.description,
      status: status.name, statusCategory: status.category,
      type: nameOf(t.task_type_id), list: nameOf(t.list_id), sprint: nameOf(t.sprint_id),
      priority: PRIORITY_LABEL[t.priority] ?? t.priority, assignees: assigneeIds.map((id) => nameOf(id)!), creator: nameOf(t.creator_id)!,
      createdAt: t.created_at, startDate: t.start_date, dueDate: t.due_date, completedAt,
      activeHours: Math.round(((time?.time.activeMinutes ?? 0) / 60) * 10) / 10,
      storyPoints: t.story_points, isMilestone: t.is_milestone,
      overdue: !FINISHED.includes(status.category) && !!t.due_date && t.due_date < now,
      tags: t.tags.map((x) => x.tag.name),
      checklist: t.checklist,
      customFields: t.custom_field_values.map((v) => ({ name: fieldById.get(v.custom_field_id) ?? 'Campo', value: fieldText(v.value) })),
      blockedBy: blockers.map((id) => keyById.get(id) ?? id),
      openBlockers: blockers.filter((id) => {
        const b = tasks.find((x) => x.id === id)
        return b && !FINISHED.includes(statusById.get(b.status_id)!.category)
      }).length,
      documents: t.documents.map((d) => d.document.title),
      attachments: filesByTask.get(t.id) ?? [],
      tickets: t.linked_tickets.map((k) => k.display_number),
    }
  })

  const activities: DossierActivity[] = tasks.flatMap((t) => t.activities.map((a) => ({
    projectId: t.project_id, taskKey: keyById.get(t.id)!, at: a.created_at, actor: nameOf(a.actor_id)!, type: a.type,
    from: label(a.from_value), to: label(a.to_value),
  })))
  const comments: DossierComment[] = tasks.flatMap((t) => t.comments.map((c) => ({
    projectId: t.project_id, taskKey: keyById.get(t.id)!, at: c.created_at, author: nameOf(c.author_id)!, body: c.body,
  })))
  const approvals: DossierApproval[] = tasks.flatMap((t) => t.approvals.map((a) => ({
    projectId: t.project_id, taskKey: keyById.get(t.id)!, approver: nameOf(a.approver_id)!, status: a.status,
    comment: a.comment, createdAt: a.created_at, decidedAt: a.decided_at,
  })))
  const tickets: DossierTicket[] = tasks.flatMap((t) => t.linked_tickets.map((k) => ({
    projectId: t.project_id, taskKey: keyById.get(t.id)!, number: k.display_number, title: k.title, status: k.status, org: k.org?.name ?? null,
  })))
  const members: DossierMember[] = projects.flatMap((p) => p.members.map((m) => ({ projectId: p.id, name: m.user.name, email: m.user.email, role: m.role })))
  const sprints: DossierSprint[] = projects.flatMap((p) => p.sprints.map((s) => {
    const inSprint = dossierTasks.filter((t) => t.projectId === p.id && t.sprint === s.name)
    return { projectId: p.id, name: s.name, status: s.status, startDate: s.start_date, endDate: s.end_date, total: inSprint.length, done: inSprint.filter((t) => t.statusCategory === 'done').length }
  }))

  // Mesma janela e mesma escolha de sprint dos gráficos (projectInsights): ativa, senão a concluída mais recente.
  const weekList = [...new Set(lastDays(WEEKS * 7, now).map(weekKey))].slice(-WEEKS)
  const dossierProjects: DossierProject[] = []
  for (const p of projects) {
    const mine = dossierTasks.filter((t) => t.projectId === p.id)
    const done = mine.filter((t) => t.statusCategory === 'done').length
    const open = mine.filter((t) => !FINISHED.includes(t.statusCategory)).length
    const rows = timeRows.filter((r) => r.task.project_id === p.id)
    const doneWeek = new Map<string, number>()
    for (const r of rows) {
      if (r.status?.category !== 'done' || !r.time.completedAt) continue
      const wk = weekKey(dayKey(r.time.completedAt))
      doneWeek.set(wk, (doneWeek.get(wk) ?? 0) + 1)
    }
    const sprint = p.sprints
      .filter((s) => s.start_date && s.end_date && (s.status === 'active' || s.status === 'completed'))
      .sort((a, b) => (a.status === b.status ? b.end_date!.getTime() - a.end_date!.getTime() : a.status === 'active' ? -1 : 1))[0]
    const load = new Map<string, { open: number; activeHours: number }>()
    for (const t of mine) {
      for (const who of t.assignees.length ? t.assignees : ['Sem responsável']) {
        const cur = load.get(who) ?? { open: 0, activeHours: 0 }
        if (!FINISHED.includes(t.statusCategory)) cur.open++
        cur.activeHours = Math.round((cur.activeHours + t.activeHours) * 10) / 10
        load.set(who, cur)
      }
    }
    dossierProjects.push({
      id: p.id, name: p.name, description: p.description, owner: p.owner.name, color: p.color,
      startDate: p.start_date, targetDate: p.target_date, archived: !!p.archived_at,
      totals: {
        total: mine.length, done, open,
        overdue: mine.filter((t) => t.overdue).length,
        deliveredInPeriod: mine.filter((t) => inPeriod(t.completedAt) || (!opts.from && !opts.to && !!t.completedAt)).length,
        pctDone: mine.length ? Math.round((done / mine.length) * 100) : 0,
      },
      weekly: weekList.map((week) => ({ week, completed: doneWeek.get(week) ?? 0 })),
      burndown: sprint ? sprintBurndown(rows, new Set([sprint.id]), { id: sprint.id, name: sprint.name, start: sprint.start_date!, end: sprint.end_date! }, now) : null,
      workload: [...load.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.open - a.open),
    })
  }

  return {
    generatedAt: now, generatedBy: me.name, period: { from: opts.from, to: opts.to },
    projects: dossierProjects, tasks: dossierTasks, activities, comments, approvals, tickets, sprints, members,
  }
}
