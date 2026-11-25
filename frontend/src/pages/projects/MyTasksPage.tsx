import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { EmptyState, Btn, Modal, PageHeader, PriorityDot, SortHeader, TruncatedText, Loading } from '@/components/ui'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect, matchesFilter } from '@/components/filters/FilterSelect'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, SavedFilter } from '@/utils/filterStorage'
import { useTableSort, SortValue } from '@/hooks/useTableSort'
import api from '@/services/api'
import { Task, ProjectStatus } from '@/types/projects'
import '@/components/projects/insights/projects.css'
import { useTaskDrawer } from '@/components/projects/taskDrawerContext'

interface MyTask extends Task {
  project: { id: string; name: string }
  status?: ProjectStatus
  key?: string | null
  list?: { name: string } | null
  createdAt: string
  updatedAt: string
}

type FilterKey = 'all' | 'today' | 'overdue' | 'week' | 'upcoming' | 'no_due' | 'done'

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'today', label: 'Hoje' },
  { key: 'overdue', label: 'Atrasadas' },
  { key: 'week', label: 'Esta semana' },
  { key: 'upcoming', label: 'Próximas' },
  { key: 'no_due', label: 'Sem prazo' },
  { key: 'done', label: 'Concluídas' },
]

// Aceita tanto os nomes curtos usados nos links da Minha área quanto as chaves
// internas, para que /my-tasks?filter=overdue funcione vindo de qualquer lugar.
const QUERY_ALIASES: Record<string, FilterKey> = {
  today: 'today', overdue: 'overdue', week: 'week', upcoming: 'upcoming', no_due: 'no_due', done: 'done', all: 'all',
}


const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Nenhuma',
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3, none: 4 }

type ColumnKey =
  | 'title' | 'description' | 'status' | 'priority' | 'startDate' | 'dueDate' | 'tags' | 'project'
  | 'type' | 'list' | 'sprint' | 'storyPoints' | 'createdAt' | 'updatedAt'
type SortKey = ColumnKey | 'seq'

interface ColumnDef {
  key: ColumnKey
  label: string
  width: number // mínimo em px
  grow?: number // fração da sobra (colunas de texto)
  hidden?: boolean // fora do padrão; liga-se em "Colunas"
  sort: (task: MyTask) => SortValue
  render: (task: MyTask) => React.ReactNode
}

const muted = { fontSize: 13.5, color: 'var(--text-3)' } as const
const dateOrNull = (iso?: string | null) => (iso ? new Date(iso) : null)
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const tagNames = (task: MyTask) => (task.tags ?? []).map((t) => t.tag.name).join(', ')
const isOverdue = (task: MyTask) => !!task.dueDate && task.status?.category !== 'done' && new Date(task.dueDate) < startOfToday()

const plain = (value?: string | null, style: React.CSSProperties = muted) =>
  value ? <TruncatedText text={value} style={style} /> : <span style={muted}>—</span>

const COLUMN_DEFS: ColumnDef[] = [
  {
    key: 'title', label: 'Título', width: 260, grow: 2, sort: (t) => t.title,
    render: (t) => plain(t.title, { fontSize: 14, fontWeight: 500, color: 'var(--text-1)' }),
  },
  { key: 'description', label: 'Descrição', width: 200, grow: 1.5, sort: (t) => t.description, render: (t) => plain(t.description) },
  { key: 'status', label: 'Status', width: 150, sort: (t) => t.status?.name, render: (t) => plain(t.status?.name, { fontSize: 13.5, color: 'var(--text-1)' }) },
  {
    key: 'priority', label: 'Prioridade', width: 110, sort: (t) => PRIORITY_RANK[t.priority],
    render: (t) => <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}><PriorityDot priority={t.priority} />{PRIORITY_LABEL[t.priority] ?? t.priority}</span>,
  },
  { key: 'startDate', label: 'Início', width: 100, sort: (t) => dateOrNull(t.startDate), render: (t) => <span style={muted}>{fmtDate(t.startDate)}</span> },
  {
    key: 'dueDate', label: 'Prazo', width: 110, sort: (t) => dateOrNull(t.dueDate),
    render: (t) => t.dueDate
      ? <span style={{ fontSize: 13.5, color: isOverdue(t) ? 'var(--danger)' : 'var(--text-2)', fontWeight: isOverdue(t) ? 600 : 400 }}>{fmtDate(t.dueDate)}</span>
      : <span style={muted}>sem prazo</span>,
  },
  { key: 'tags', label: 'Tags', width: 160, grow: 1, sort: tagNames, render: (t) => plain(tagNames(t)) },
  { key: 'project', label: 'Projeto', width: 150, sort: (t) => t.project?.name, render: (t) => plain(t.project?.name, { fontSize: 13.5, color: 'var(--text-2)' }) },
  { key: 'type', label: 'Tipo', width: 130, hidden: true, sort: (t) => t.taskType?.name, render: (t) => plain(t.taskType?.name) },
  { key: 'list', label: 'Lista', width: 140, hidden: true, sort: (t) => t.list?.name, render: (t) => plain(t.list?.name) },
  { key: 'sprint', label: 'Sprint', width: 140, hidden: true, sort: (t) => t.sprint?.name, render: (t) => plain(t.sprint?.name) },
  { key: 'storyPoints', label: 'Pontos', width: 80, hidden: true, sort: (t) => t.storyPoints, render: (t) => <span style={muted}>{t.storyPoints ?? '—'}</span> },
  { key: 'createdAt', label: 'Criada em', width: 100, hidden: true, sort: (t) => dateOrNull(t.createdAt), render: (t) => <span style={muted}>{fmtDate(t.createdAt)}</span> },
  { key: 'updatedAt', label: 'Atualizada em', width: 110, hidden: true, sort: (t) => dateOrNull(t.updatedAt), render: (t) => <span style={muted}>{fmtDate(t.updatedAt)}</span> },
]

const SORT_GETTERS = Object.fromEntries([
  ['seq', (t: MyTask) => t.seq],
  ...COLUMN_DEFS.map((c) => [c.key, c.sort]),
]) as Record<SortKey, (task: MyTask) => SortValue>

// Coluna ID fica fora das preferências: sempre primeira e fixa à esquerda.
const ID_WIDTH = 104

type ColumnPref = { key: ColumnKey; visible: boolean }

const DEFAULT_COLUMN_ORDER: ColumnPref[] = COLUMN_DEFS.map((c) => ({ key: c.key, visible: !c.hidden }))

// Preferência salva antes de existirem colunas novas: mantém a ordem salva,
// descarta chaves que não existem mais (ex.: 'seq') e anexa as novas ocultas.
export function mergeColumnPrefs(saved: Array<{ key: string; visible: boolean }>): ColumnPref[] {
  const known = saved.filter((c): c is ColumnPref => COLUMN_DEFS.some((d) => d.key === c.key))
  const missing = COLUMN_DEFS.filter((d) => !known.some((c) => c.key === d.key)).map((d) => ({ key: d.key, visible: false }))
  return [...known, ...missing]
}

const cellStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden', padding: '12px 16px 12px 0' }

function TaskId({ task }: { task: MyTask }) {
  return <TruncatedText text={task.key || `#${task.seq}`} style={{ fontSize: 13.5, color: isOverdue(task) ? 'var(--danger)' : 'var(--text-3)' }} />
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfToday() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function endOfWeek() {
  const d = endOfToday()
  d.setDate(d.getDate() + (6 - d.getDay()))
  return d
}

export default function MyTasksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // A task abre num drawer sobre a lista; ao fechar, recarrega sem perder filtros nem rolagem.
  const { openTask } = useTaskDrawer(refresh)
  const [tasks, setTasks] = useState<MyTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fProject, setFProject] = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const [fPriority, setFPriority] = useState('all')
  const [fTag, setFTag] = useState('all')
  const [search, setSearch] = useState('') // busca fora do painel: ID, título ou projeto
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const tableSort = useTableSort<SortKey>({ key: 'dueDate', dir: 1 })
  const [columnPrefs, setColumnPrefs] = useState(DEFAULT_COLUMN_ORDER)
  const [columnsModalOpen, setColumnsModalOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('my-tasks'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)

  const FILTER_DEFAULTS = { fProject: 'all', fStatus: 'all', fPriority: 'all', fTag: 'all', dateFrom: '', dateTo: '' }
  const activeFilterCount = countActiveFilters({ fProject, fStatus, fPriority, fTag, dateFrom, dateTo }, FILTER_DEFAULTS)

  function handleClearFilters() {
    setFProject('all'); setFStatus('all'); setFPriority('all'); setFTag('all')
    setDateFrom(''); setDateTo(''); setActiveSavedFilter(null)
  }

  function handleSelectSavedFilter(sf: SavedFilter) {
    const f = sf.filters
    if (f.fProject !== undefined) setFProject(f.fProject as string)
    if (f.fStatus !== undefined) setFStatus(f.fStatus as string)
    if (f.fPriority !== undefined) setFPriority(f.fPriority as string)
    if (f.fTag !== undefined) setFTag(f.fTag as string)
    if (f.dateFrom !== undefined) setDateFrom(f.dateFrom as string)
    if (f.dateTo !== undefined) setDateTo(f.dateTo as string)
    setActiveSavedFilter(sf)
  }

  function handleSaveFilter(name: string) {
    const sf: SavedFilter = { id: crypto.randomUUID(), name, filters: { fProject, fStatus, fPriority, fTag, dateFrom, dateTo } }
    saveFilter('my-tasks', sf)
    setSavedFilters(getSavedFilters('my-tasks'))
  }

  function handleDeleteSavedFilter(id: string) {
    deleteFilter('my-tasks', id)
    setSavedFilters(getSavedFilters('my-tasks'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  const active: FilterKey = QUERY_ALIASES[searchParams.get('filter') ?? ''] ?? 'all'

  function load() {
    setLoading(true)
    setError(null)
    api.get('/my-tasks')
      .then(({ data }) => setTasks(data.data))
      .catch(() => setError('Não foi possível carregar suas tarefas.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  function refresh() {
    api.get('/my-tasks').then(({ data }) => setTasks(data.data)).catch(() => {})
  }

  useEffect(() => {
    api.get('/my-tasks/columns')
      .then(({ data }) => { if (Array.isArray(data.data) && data.data.length > 0) setColumnPrefs(mergeColumnPrefs(data.data)) })
      .catch(() => {})
  }, [])

  function saveColumnPrefs(next: ColumnPref[]) {
    setColumnPrefs(next)
    api.put('/my-tasks/columns', { columns: next }).catch(() => {})
  }

  function toggleColumnVisible(key: ColumnKey) {
    saveColumnPrefs(columnPrefs.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)))
  }

  function moveColumn(key: ColumnKey, direction: -1 | 1) {
    const idx = columnPrefs.findIndex((c) => c.key === key)
    const targetIdx = idx + direction
    if (idx < 0 || targetIdx < 0 || targetIdx >= columnPrefs.length) return
    const next = [...columnPrefs]
    ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
    saveColumnPrefs(next)
  }

  const visibleColumns = useMemo(() => {
    const byKey = new Map(COLUMN_DEFS.map((c) => [c.key, c]))
    return columnPrefs.filter((c) => c.visible).map((c) => byKey.get(c.key)).filter((c): c is ColumnDef => !!c)
  }, [columnPrefs])

  const gridTemplate = [`${ID_WIDTH}px`, ...visibleColumns.map((c) => (c.grow ? `minmax(${c.width}px, ${c.grow}fr)` : `${c.width}px`))].join(' ')
  const tableMinWidth = visibleColumns.reduce((sum, c) => sum + c.width, ID_WIDTH)

  const projects = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) if (task.project) map.set(task.project.id, task.project.name)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [tasks])

  const statuses = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>()
    for (const task of tasks) if (task.status) map.set(task.status.name, task.status)
    return [...map.entries()].map(([name, s]) => ({ name, color: s.color }))
  }, [tasks])

  const tags = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) for (const t of task.tags ?? []) map.set(t.tag.id, t.tag.name)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [tasks])

  const filtered = useMemo(() => {
    const todayStart = startOfToday()
    const todayEnd = endOfToday()
    const weekEnd = endOfWeek()
    const from = dateFrom ? new Date(dateFrom) : null
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null

    const q = search.trim().toLowerCase()
    return tasks.filter((task) => {
      if (q && ![task.title, task.key ?? `#${task.seq}`, task.project?.name ?? ''].some((v) => v.toLowerCase().includes(q))) return false
      if (!matchesFilter(fProject, task.project?.id)) return false
      if (!matchesFilter(fStatus, task.status?.name)) return false
      if (!matchesFilter(fPriority, task.priority)) return false
      if (fTag !== 'all' && !(task.tags ?? []).some((t) => fTag.split(',').includes(t.tag.id))) return false

      const due = task.dueDate ? new Date(task.dueDate) : null
      if (from && (!due || due < from)) return false
      if (to && (!due || due > to)) return false

      const isDone = task.status?.category === 'done'
      const start = task.startDate ? new Date(task.startDate) : null
      // "Hoje" = vence hoje ou começa hoje (atrasada continua em "Atrasadas").
      const startsToday = !!start && start >= todayStart && start <= todayEnd && !(due && due < todayStart)

      switch (active) {
        case 'done': return isDone
        case 'no_due': return !due && !isDone
        case 'today': return !isDone && ((!!due && due >= todayStart && due <= todayEnd) || startsToday)
        case 'overdue': return !isDone && !!due && due < todayStart
        case 'week': return !isDone && !!due && due > todayEnd && due <= weekEnd
        case 'upcoming': return !isDone && !!due && due > weekEnd
        default: return true
      }
    })
  }, [tasks, active, search, fProject, fStatus, fPriority, fTag, dateFrom, dateTo])

  const sorted = tableSort.apply(filtered, SORT_GETTERS)

  function setFilter(key: FilterKey) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (key === 'all') next.delete('filter')
      else next.set('filter', key)
      return next
    })
  }

  if (loading) return <Loading />

  if (error) {
    return (
      <EmptyState
        title="Não foi possível carregar"
        desc={error}
        action={<Btn variant="secondary" size="sm" onClick={load}>Tentar novamente</Btn>}
      />
    )
  }

  return (
    <div>
      <PageHeader title="Minhas tarefas" actions={<Btn variant="secondary" size="sm" onClick={() => setColumnsModalOpen(true)}>Colunas</Btn>} />
      <div className="prj-body" style={{ gap: 14 }}>
      <div className="subtabs">
        {FILTERS.map((filter) => (
          <button key={filter.key} type="button" aria-pressed={active === filter.key} onClick={() => setFilter(filter.key)}>{filter.label}</button>
        ))}
      </div>
      <div className="prj-tools">
        <FilterSearchInput value={search} onChange={setSearch} placeholder="Buscar por ID, título ou projeto…" width="min(300px, 100%)" />
        <div style={{ position: 'relative' }}>
          <FilterButton
            activeCount={activeFilterCount}
            activeSavedFilter={activeSavedFilter}
            onOpen={() => setFilterOpen((v) => !v)}
            onClearSaved={() => { setActiveSavedFilter(null); handleClearFilters() }}
            isOpen={filterOpen}
          />
          <FilterDropdown
            isOpen={filterOpen}
            onClose={() => setFilterOpen(false)}
            savedFilters={savedFilters}
            onSelectSaved={handleSelectSavedFilter}
            onSaveNew={handleSaveFilter}
            onDeleteSaved={handleDeleteSavedFilter}
            onApply={() => {}}
            onClear={handleClearFilters}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            showDateFilter={true}
            dateLabel="Prazo"
          >
            <FilterField label="Status">
              <FilterSelect value={fStatus} onChange={setFStatus}>
                <option value="all">Todos</option>
                {statuses.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </FilterSelect>
            </FilterField>
            <FilterField label="Prioridade">
              <FilterSelect value={fPriority} onChange={setFPriority}>
                <option value="all">Todas</option>
                {Object.entries(PRIORITY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </FilterSelect>
            </FilterField>
            <FilterField label="Projeto">
              <FilterSelect value={fProject} onChange={setFProject}>
                <option value="all">Todos</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </FilterSelect>
            </FilterField>
            {tags.length > 0 && (
              <FilterField label="Tag">
                <FilterSelect value={fTag} onChange={setFTag}>
                  <option value="all">Todas</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </FilterSelect>
              </FilterField>
            )}
          </FilterDropdown>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="prj-empty"><EmptyState
          title="Nenhuma tarefa neste filtro"
          desc={active === 'all' ? 'Nenhuma tarefa atribuída a você ainda.' : 'Experimente outro filtro.'}
        /></div>
      ) : (
          // Um só contêiner rola nos dois eixos: cabeçalho fixo no topo e ID fixo à esquerda.
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 270px)', minHeight: 240 }}>
            <div style={{ minWidth: tableMinWidth }}>
              <div
                style={{
                  display: 'grid', gridTemplateColumns: gridTemplate,
                  position: 'sticky', top: 0, zIndex: 3,
                  borderBottom: '1px solid var(--rule)', background: 'var(--bg-card)', fontSize: 13, color: 'var(--text-3)',
                }}
              >
                <div className="mytask-sticky" style={{ ...cellStyle, padding: '10px 16px 10px 0' }}>
                  <SortHeader label="ID" {...tableSort.header('seq')} />
                </div>
                {visibleColumns.map(({ key, label }) => (
                  <div key={key} style={{ ...cellStyle, padding: '10px 16px 10px 0' }}>
                    <SortHeader label={label} {...tableSort.header(key)} />
                  </div>
                ))}
              </div>

              {sorted.map((task) => (
                <button
                  key={task.id}
                  className="mytask-row"
                  onClick={() => openTask(task.project.id, task.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: gridTemplate, width: '100%', padding: 0,
                    border: 'none', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', textAlign: 'left', color: 'var(--text-1)', font: 'inherit',
                  }}
                >
                  <span className="mytask-sticky" style={cellStyle}><TaskId task={task} /></span>
                  {visibleColumns.map((col) => <span key={col.key} style={cellStyle}>{col.render(task)}</span>)}
                </button>
              ))}
            </div>
          </div>
      )}

      <Modal isOpen={columnsModalOpen} onClose={() => setColumnsModalOpen(false)} title="Configurar colunas" width={380}>
        <div>
          <p className="prj-note" style={{ marginBottom: 8 }}>A coluna ID fica sempre visível e fixa à esquerda.</p>
          {columnPrefs.map(({ key, visible }, idx) => {
            const def = COLUMN_DEFS.find((c) => c.key === key)
            if (!def) return null
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, fontSize: 14, color: 'var(--text-1)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={visible} onChange={() => toggleColumnVisible(key)} />
                  {def.label}
                </label>
                <button
                  className="icon-act"
                  aria-label={`Mover ${def.label} para cima`}
                  onClick={() => moveColumn(key, -1)}
                  disabled={idx === 0}
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  className="icon-act"
                  aria-label={`Mover ${def.label} para baixo`}
                  onClick={() => moveColumn(key, 1)}
                  disabled={idx === columnPrefs.length - 1}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
            )
          })}
        </div>
      </Modal>
      </div>
    </div>
  )
}
