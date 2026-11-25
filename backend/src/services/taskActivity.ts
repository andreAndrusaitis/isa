/**
 * Histórico da task: registro de eventos e a linha do tempo pronta para a tela.
 * from_value/to_value guardam ids (status, pessoas, listas, tasks) ou texto; aqui
 * viram nomes. O que pode sumir depois (tag, item de checklist, arquivo) é gravado por nome.
 */
import type { TaskActivityType } from '@prisma/client'
import prisma from '../config/prisma'
import { logger } from '../utils/logger'

const MAX_TEXT = 200

/**
 * Chamado depois que a ação já foi gravada: falhar aqui não pode devolver erro de
 * algo que deu certo (um anexo reenviado sairia duplicado). O histórico perde o
 * evento e o erro fica no log.
 */
export async function logTaskActivity(taskId: string, actorId: string, type: TaskActivityType, values: { from?: string | null; to?: string | null } = {}) {
  try {
    await prisma.taskActivity.create({
      data: { task_id: taskId, actor_id: actorId, type, from_value: values.from ?? null, to_value: values.to ?? null },
    })
  } catch (err) {
    logger.error(`[Projetos] histórico da task ${taskId} (${type}) não gravado: ${(err as Error)?.message ?? err}`)
  }
}

export type ChecklistAction = 'added' | 'done' | 'reopened' | 'removed'

export function logChecklistActivity(taskId: string, actorId: string, action: ChecklistAction, text: string) {
  return logTaskActivity(taskId, actorId, 'checklist_changed', { to: JSON.stringify({ action, text: text.slice(0, MAX_TEXT) }) })
}

function parseChecklist(raw: string | null): { action: ChecklistAction; text: string } | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return typeof v?.action === 'string' && typeof v?.text === 'string' ? v : null
  } catch { return null }
}

const csv = (v: string | null) => (v ? v.split(',').filter(Boolean) : [])
const TASK_REF_TYPES = new Set(['relation_added', 'relation_removed', 'dependency_changed', 'subtask_added'])
const PERSON_TYPES = new Set(['assignee_changed', 'watcher_added', 'watcher_removed', 'approval_requested'])

type Lookups = { named: Map<string, string>; people: Map<string, string>; tasks: Map<string, string> }
type Raw = { type: string; from_value: string | null; to_value: string | null }

/** Valores do evento em texto de tela. Nome que não existe mais vira "(removido)". */
export function resolveActivity(a: Raw, l: Lookups) {
  const gone = '(removido)'
  const via = (map: Map<string, string>, id: string | null) => (id ? map.get(id) ?? gone : null)
  switch (a.type) {
    case 'status_changed': case 'moved_list': case 'sprint_changed': case 'task_type_changed':
      return { from: via(l.named, a.from_value), to: via(l.named, a.to_value) }
    case 'assignees_changed': {
      const before = csv(a.from_value)
      const after = csv(a.to_value)
      const name = (id: string) => l.people.get(id) ?? gone
      return { added: after.filter((id) => !before.includes(id)).map(name), removed: before.filter((id) => !after.includes(id)).map(name) }
    }
    case 'checklist_changed': {
      const item = parseChecklist(a.to_value)
      return item ? { action: item.action, to: item.text } : {}
    }
    case 'description_changed': case 'created':
      return {} // a descrição inteira não cabe no histórico
    default:
      if (PERSON_TYPES.has(a.type)) return { from: via(l.people, a.from_value), to: via(l.people, a.to_value) }
      if (TASK_REF_TYPES.has(a.type)) return { from: via(l.tasks, a.from_value), to: via(l.tasks, a.to_value) }
      return { from: a.from_value, to: a.to_value }
  }
}

/** Linha do tempo da task, da mais antiga para a mais nova. */
export async function getTaskTimeline(projectId: string, taskId: string, limit = 300) {
  const rows = await prisma.taskActivity.findMany({
    where: { task_id: taskId },
    orderBy: { created_at: 'desc' },
    take: limit,
    include: { actor: { select: { id: true, name: true, avatar: true } } },
  })
  const peopleIds = new Set<string>()
  const taskIds = new Set<string>()
  for (const r of rows) {
    const values = [r.from_value, r.to_value].filter((v): v is string => !!v)
    if (r.type === 'assignees_changed') values.flatMap((v) => csv(v)).forEach((id) => peopleIds.add(id))
    else if (PERSON_TYPES.has(r.type)) values.forEach((id) => peopleIds.add(id))
    else if (TASK_REF_TYPES.has(r.type)) values.forEach((id) => taskIds.add(id))
  }
  const where = { project_id: projectId }
  const [statuses, lists, sprints, types, people, tasks] = await Promise.all([
    prisma.projectStatus.findMany({ where, select: { id: true, name: true } }),
    prisma.projectList.findMany({ where, select: { id: true, name: true } }),
    prisma.sprint.findMany({ where, select: { id: true, name: true } }),
    prisma.taskType.findMany({ where, select: { id: true, name: true } }),
    peopleIds.size ? prisma.user.findMany({ where: { id: { in: [...peopleIds] } }, select: { id: true, name: true } }) : [],
    // Só tasks do projeto: relação antiga com task de fora não mostra o título.
    taskIds.size ? prisma.task.findMany({ where: { id: { in: [...taskIds] }, project_id: projectId }, select: { id: true, seq: true, key: true, title: true } }) : [],
  ])
  const lookups: Lookups = {
    named: new Map([...statuses, ...lists, ...sprints, ...types].map((x) => [x.id, x.name])),
    people: new Map(people.map((u) => [u.id, u.name])),
    tasks: new Map(tasks.map((t) => [t.id, `${t.key ?? `#${t.seq}`} ${t.title}`])),
  }
  return rows.reverse().map((r) => ({ id: r.id, type: r.type, createdAt: r.created_at, actor: r.actor, ...resolveActivity(r, lookups) }))
}
