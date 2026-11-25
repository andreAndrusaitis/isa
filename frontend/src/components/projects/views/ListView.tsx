import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Task, ProjectStatus, TaskPriority, ProjectMemberWithUser, Tag, StatusCategory } from '@/types/projects'
import { taskLabel } from '@/components/projects/taskKey'
import { StatusPill } from '@/components/projects/StatusPill'
import { relativeDay } from '@/components/projects/relativeDay'
import { Btn, EmptyState, PriorityDot, SortHeader } from '@/components/ui'
import { compareSortValues, type SortDir, type SortValue } from '@/hooks/useTableSort'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { PRIORITY_STEP } from '../priority'
import '../projects.css'

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Urgente', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade',
}

// Concluídas/canceladas são histórico: começam recolhidas para a lista abrir no que está em jogo.
const CLOSED_BY_DEFAULT: StatusCategory[] = ['done', 'cancelled']
const COLS = 10

export interface Selection {
  selectedIds: Set<string>
  onToggle: (taskIds: string[], selected: boolean) => void
}

const SR_ONLY: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }

function storageKey(projectId: string | undefined) {
  return `projetos:lista-grupos:${projectId ?? ''}`
}

type SortKey = 'seq' | 'title' | 'priority' | 'assignee' | 'startDate' | 'dueDate' | 'tags'
type TaskSort = { key: SortKey; dir: SortDir } | null

// Urgente primeiro no sentido crescente; sem prioridade fica no fim, como os outros vazios.
const PRIORITY_RANK: Record<TaskPriority, number | null> = { critical: 0, high: 1, normal: 2, low: 3, none: null }
const SORT_KEYS: SortKey[] = ['seq', 'title', 'priority', 'assignee', 'startDate', 'dueDate', 'tags']

function sortStorageKey(projectId: string | undefined) {
  return `projetos:lista-ordem:${projectId ?? ''}`
}

function readSort(key: string): TaskSort {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v && SORT_KEYS.includes(v.key) && (v.dir === 1 || v.dir === -1) ? v : null
  } catch { return null }
}

const dateOrNull = (iso?: string | null) => (iso ? new Date(iso) : null)

const taskTags = (task: Task): Tag[] => (Array.isArray(task.tags) ? task.tags : [])
  .map((t: any) => t.tag || t)
  .filter((t: any) => t && t.name)

function readOpen(key: string): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}

const Empty = ({ label }: { label?: string }) => <span role={label ? 'img' : undefined} aria-label={label} title={label} style={{ color: 'var(--text-3)' }}>—</span>

function DateCell({ value, overdue, today }: { value?: string | null; overdue?: boolean; today?: boolean }) {
  if (!value) return <Empty />
  return (
    <span
      title={new Date(value).toLocaleDateString('pt-BR')}
      style={{ color: overdue ? 'var(--danger)' : today ? 'var(--warning)' : 'var(--text-2)', fontWeight: overdue || today ? 600 : 400 }}
    >
      {relativeDay(value)}
    </span>
  )
}

/** Quem responde, em texto: o principal e quantos mais. */
function Assignees({ task, assignee }: { task: Task; assignee?: ProjectMemberWithUser }) {
  const people = [...(task.multiAssignees ?? [])].sort((a, b) => Number(b.userId === task.assigneeId) - Number(a.userId === task.assigneeId))
  if (people.length > 1) {
    const names = people.map((a) => a.user.name).join(', ')
    return <div role="img" aria-label={`Responsáveis: ${names}`} title={names} className="pj-cut">{people[0].user.name} +{people.length - 1}</div>
  }
  return assignee ? <div className="pj-cut" title={assignee.user.name}>{assignee.user.name}</div> : <Empty label="Sem responsável" />
}

function TaskRow({
  task, onOpenTask, assignee, isDone, selection, status, statuses, onStatusChange,
}: {
  task: Task
  onOpenTask: (id: string) => void
  assignee?: ProjectMemberWithUser
  isDone: boolean
  selection?: Selection
  status: ProjectStatus
  statuses: ProjectStatus[]
  onStatusChange?: (taskId: string, statusId: string) => void
}) {
  const selected = selection?.selectedIds.has(task.id) ?? false

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const due = task.dueDate && !isDone ? new Date(task.dueDate) : null
  const isOverdue = !!due && due < startOfToday
  const isDueToday = !!due && due.toDateString() === startOfToday.toDateString()

  const tags = taskTags(task)

  return (
    <tr className="lv-row" onClick={() => onOpenTask(task.id)} aria-selected={selection ? selected : undefined}>
      <td onClick={selection ? (e) => e.stopPropagation() : undefined}>
        {selection && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => selection.onToggle([task.id], e.target.checked)}
            aria-label={`Selecionar ${taskLabel(task)} ${task.title}`}
          />
        )}
      </td>

      <td>
        <div className="pj-cut" title={task.title} style={isDone ? { color: 'var(--text-3)', textDecoration: 'line-through' } : { fontSize: 14, fontWeight: 500 }}>
          {task.title}
          {task.isMilestone && <span aria-label="Marco" style={{ fontWeight: 400, color: 'var(--text-3)' }}> · marco</span>}
        </div>
      </td>

      <td className="pj-cut" style={{ color: 'var(--text-3)' }}>{taskLabel(task)}</td>

      <td><DateCell value={task.dueDate} overdue={isOverdue} today={isDueToday} /></td>

      <td><Assignees task={task} assignee={assignee} /></td>

      <td>
        <StatusPill status={status} statuses={statuses} onChange={onStatusChange ? (id) => onStatusChange(task.id, id) : undefined} />
      </td>

      <td>
        {task.priority === 'none' ? <Empty label="Sem prioridade" /> : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: task.priority === 'critical' ? 'var(--danger)' : 'var(--text-2)' }}>
            <PriorityDot priority={PRIORITY_STEP[task.priority]} />{PRIORITY_LABEL[task.priority]}
          </span>
        )}
      </td>

      <td className="lv-wide"><DateCell value={task.startDate} /></td>

      <td className="lv-wide">
        {tags.length > 0 ? (
          <div className="pj-cut" title={tags.map((t) => t.name).join(', ')} style={{ color: 'var(--text-2)' }}>
            {tags.slice(0, 2).map((tag, i) => <span key={tag.id}>{i > 0 && ', '}<span>{tag.name}</span></span>)}
            {tags.length > 2 && ` +${tags.length - 2}`}
          </div>
        ) : <Empty />}
      </td>

      <td style={{ textAlign: 'right' }}>
        <button
          type="button"
          className="pj-link lv-open"
          onClick={(e) => { e.stopPropagation(); onOpenTask(task.id) }}
          aria-label={`Abrir ${taskLabel(task)}`}
        >
          Abrir
        </button>
      </td>
    </tr>
  )
}

function StatusGroup({
  status, statuses, onStatusChange, tasks, onOpenTask, membersMap, selection, open, onToggleOpen,
}: {
  status: ProjectStatus
  statuses: ProjectStatus[]
  onStatusChange?: (taskId: string, statusId: string) => void
  tasks: Task[]
  onOpenTask: (id: string) => void
  membersMap?: Map<string, ProjectMemberWithUser>
  selection?: Selection
  open: boolean
  onToggleOpen: () => void
}) {
  // No celular Início e Tags somem: um colSpan maior criaria colunas vazias que roubam espaço do título.
  const narrow = useMediaQuery('(max-width: 767px)')
  const empty = tasks.length === 0
  const selectedInGroup = selection ? tasks.filter((t) => selection.selectedIds.has(t.id)).length : 0
  const allSelected = !empty && selectedInGroup === tasks.length

  return (
    <tbody>
      <tr>
        <td colSpan={narrow ? COLS - 2 : COLS} className="lv-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* O checkbox do grupo marca todas as tasks deste status, mesmo recolhido */}
            {selection && !empty && (
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = selectedInGroup > 0 && !allSelected }}
                onChange={(e) => selection.onToggle(tasks.map((t) => t.id), e.target.checked)}
                aria-label={`Selecionar todas as ${tasks.length} tasks de ${status.name}`}
              />
            )}
            <button
              type="button"
              onClick={onToggleOpen}
              disabled={empty}
              aria-expanded={empty ? undefined : open}
              className="lv-toggle"
            >
              {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <span className="pj-cut">{status.name}</span>
              <small>{selectedInGroup > 0 ? `${selectedInGroup} de ${tasks.length}` : tasks.length}</small>
            </button>
          </div>
        </td>
      </tr>
      {open && tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onOpenTask={onOpenTask}
          assignee={task.assigneeId && membersMap ? membersMap.get(task.assigneeId) : undefined}
          isDone={status.category === 'done'}
          selection={selection}
          status={status}
          statuses={statuses}
          onStatusChange={onStatusChange}
        />
      ))}
    </tbody>
  )
}

export function ListView({
  statuses,
  tasks,
  onOpenTask,
  members,
  selection,
  onStatusChange,
}: {
  statuses: ProjectStatus[]
  tasks: Task[]
  onOpenTask: (id: string) => void
  members?: ProjectMemberWithUser[]
  /** Presente quando quem vê pode editar: a etiqueta de status vira clicável. */
  onStatusChange?: (taskId: string, statusId: string) => void
  /** Presente quando quem vê pode editar: liga os checkboxes da edição em massa. */
  selection?: Selection
}) {
  const membersMap = useMemo(() => {
    if (!members) return undefined
    return new Map(members.map((m) => [m.userId, m]))
  }, [members])

  const byStatus = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) map.set(t.statusId, [...(map.get(t.statusId) ?? []), t])
    return map
  }, [tasks])

  // Só guardamos o que o usuário escolheu; o resto segue o padrão por categoria.
  const key = storageKey(statuses[0]?.projectId)
  const [saved, setSaved] = useState(() => ({ key, open: readOpen(key) }))
  // Os status chegam depois do primeiro render: relê o storage quando o projeto aparece/troca.
  if (saved.key !== key) setSaved({ key, open: readOpen(key) })

  // Ordena dentro de cada status, e a escolha fica salva por projeto. Sem ordenação, vale a ordem do projeto.
  const orderKey = sortStorageKey(statuses[0]?.projectId)
  const [order, setOrder] = useState(() => ({ key: orderKey, sort: readSort(orderKey) }))
  if (order.key !== orderKey) setOrder({ key: orderKey, sort: readSort(orderKey) })
  const sort = order.sort

  const toggleSort = (key: SortKey) => {
    const next: TaskSort = sort?.key !== key ? { key, dir: 1 } : sort.dir === 1 ? { key, dir: -1 } : null
    setOrder({ key: orderKey, sort: next })
    try {
      if (next) localStorage.setItem(orderKey, JSON.stringify(next))
      else localStorage.removeItem(orderKey)
    } catch { /* sem storage: só não persiste */ }
  }
  const sortHeader = (key: SortKey) => ({ dir: sort?.key === key ? sort.dir : null, onClick: () => toggleSort(key) })

  const sortValue = (task: Task, key: SortKey): SortValue => {
    switch (key) {
      case 'seq': return task.seq
      case 'title': return task.title
      case 'priority': return PRIORITY_RANK[task.priority]
      case 'assignee': return (task.assigneeId && membersMap?.get(task.assigneeId)?.user.name) || null
      case 'startDate': return dateOrNull(task.startDate)
      case 'dueDate': return dateOrNull(task.dueDate)
      case 'tags': return taskTags(task).map((t) => t.name).join(', ')
    }
  }
  const sorted = (list: Task[]) => (sort
    ? [...list].sort((a, b) => compareSortValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir))
    : list)

  const groups = statuses.map((status) => {
    const groupTasks = sorted(byStatus.get(status.id) ?? [])
    const open = groupTasks.length > 0 && (saved.open[status.id] ?? !CLOSED_BY_DEFAULT.includes(status.category))
    return { status, tasks: groupTasks, open }
  })
  const anyCollapsed = groups.some((g) => g.tasks.length > 0 && !g.open)

  const persist = (open: Record<string, boolean>) => {
    setSaved({ key, open })
    try { localStorage.setItem(key, JSON.stringify(open)) } catch { /* sem storage: só não persiste */ }
  }

  if (tasks.length === 0) {
    return <EmptyState title="Nenhuma tarefa neste projeto ainda." />
  }

  return (
    <div className="lv" style={selection ? { paddingBottom: 96 } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4, fontSize: 13.5, color: 'var(--text-3)' }}>
        <span>{tasks.length} task{tasks.length > 1 ? 's' : ''}</span>
        <Btn variant="ghost" size="xs" style={{ padding: 0 }} onClick={() => persist(Object.fromEntries(statuses.map((s) => [s.id, anyCollapsed])))}>
          {anyCollapsed ? 'Expandir tudo' : 'Recolher tudo'}
        </Btn>
      </div>

      <table className="table lv-table">
        <thead>
          <tr>
            <th style={{ width: 24 }}><span style={SR_ONLY}>Seleção</span></th>
            <th><SortHeader label="Demanda" {...sortHeader('title')} /></th>
            <th style={{ width: 78 }}><SortHeader label="ID" {...sortHeader('seq')} /></th>
            <th style={{ width: 96 }}><SortHeader label="Prazo" {...sortHeader('dueDate')} /></th>
            <th style={{ width: 130 }} title="Responsáveis"><SortHeader label="Resp." {...sortHeader('assignee')} /></th>
            <th style={{ width: 148 }}>Status</th>
            <th style={{ width: 100 }}><SortHeader label="Prioridade" {...sortHeader('priority')} /></th>
            <th className="lv-wide" style={{ width: 88 }}><SortHeader label="Início" {...sortHeader('startDate')} /></th>
            <th className="lv-wide" style={{ width: 124 }}><SortHeader label="Tags" {...sortHeader('tags')} /></th>
            <th style={{ width: 44 }}><span style={SR_ONLY}>Ações</span></th>
          </tr>
        </thead>
        {groups.map(({ status, tasks: groupTasks, open }) => (
          <StatusGroup
            key={status.id}
            status={status}
            statuses={statuses}
            onStatusChange={onStatusChange}
            tasks={groupTasks}
            onOpenTask={onOpenTask}
            membersMap={membersMap}
            selection={selection}
            open={open}
            onToggleOpen={() => persist({ ...saved.open, [status.id]: !open })}
          />
        ))}
      </table>
    </div>
  )
}
