import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { Task, ProjectStatus, ProjectMemberWithUser, Sprint, TaskType, Tag } from '@/types/projects'
import { listTasks, updateTask } from '@/services/tasksService'
import { listProjectStatuses, listMembers, listSprints, listTaskTypes, listTags, listLists } from '@/services/projectsService'
import { getSocket, joinProjectRoom, leaveProjectRoom } from '@/services/socketService'
import { TaskDrawer } from '@/components/projects/TaskDrawer'
import { CreateTaskModal } from '@/components/projects/CreateTaskModal'
import { Btn, EmptyState, Loading } from '@/components/ui'
import { BoardView, BoardGroupBy } from '@/components/projects/views/BoardView'
import { ListView } from '@/components/projects/views/ListView'
import { CalendarView } from '@/components/projects/views/CalendarView'
import { TimelineView } from '@/components/projects/views/TimelineView'
import { useProjectRole } from '@/components/projects/projectRole'
import { BulkActionBar } from '@/components/projects/BulkActionBar'
import { taskLabel } from '@/components/projects/taskKey'
import '@/components/projects/insights/projects.css'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect, matchesFilter } from '@/components/filters/FilterSelect'
import { useFilterPanel } from '@/components/filters/useFilterPanel'

export type ViewMode = 'board' | 'list' | 'calendar' | 'gantt' | 'timeline'

const VIEWS: Array<{ mode: ViewMode; label: string }> = [
  { mode: 'board', label: 'Board' },
  { mode: 'list', label: 'Lista' },
  { mode: 'calendar', label: 'Calendário' },
  { mode: 'gantt', label: 'Gantt' },
  { mode: 'timeline', label: 'Timeline' },
]

/**
 * Página única de trabalho do projeto. Board, Lista, Calendário, Gantt e
 * Timeline são MODOS de exibição da mesma coleção de tasks (nunca há
 * cópias independentes de uma task por visualização) — trocar de view é uma troca de componente local, não uma
 * navegação de rota, então o estado de tasks carregado uma vez é reusado por
 * todas elas, sem recarregar ao alternar.
 */
export default function ProjectTasksPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([])
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  // Padrão do sistema: busca (ID/título) fora; o resto no painel de filtros, salvo por projeto.
  const filters = useFilterPanel(`project-tasks:${projectId}`, {
    status: 'all', assignee: 'all', priority: 'all', type: 'all', tag: 'all', sprint: 'all', dateFrom: '', dateTo: '',
  })
  const [groupBy, setGroupBy] = useState<BoardGroupBy>('status')
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const view = (searchParams.get('view') as ViewMode) ?? 'board'
  const openTaskId = searchParams.get('task')
  // ?list=<id>: vem do painel "Listas" do shell do projeto.
  const listFilter = searchParams.get('list')
  const [listName, setListName] = useState<string | null>(null)

  useEffect(() => {
    setListName(null)
    if (!projectId || !listFilter) return
    let cancelled = false
    listLists(projectId)
      .then((ls) => { if (!cancelled) setListName(ls.find((l) => l.id === listFilter)?.name ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId, listFilter])

  function load() {
    if (!projectId) return
    setLoading(true)
    setLoadError(null)
    Promise.all([
      listProjectStatuses(projectId),
      listTasks(projectId),
      listMembers(projectId).catch(() => []),
      listSprints(projectId).catch(() => []),
      listTaskTypes(projectId).catch(() => []),
      listTags(projectId).catch(() => []),
    ]).then(([s, t, m, sp, tt, tg]) => {
      setStatuses(s)
      setTasks(t)
      setMembers(m)
      setSprints(sp)
      setTaskTypes(tt)
      setTags(tg)
    }).catch((err) => {
      setLoadError(apiErrorMessage(err, 'Não foi possível carregar as tasks do projeto.'))
    }).finally(() => setLoading(false))
  }

  useEffect(load, [projectId])

  // Sincronia em tempo real: outra pessoa move/edita uma task e todos que
  // estão olhando este projeto veem a mudança sem precisar recarregar a
  // página (backend já emite task.created/task.updated em services/tasks.ts).
  useEffect(() => {
    if (!projectId) return
    const socket = getSocket()
    if (!socket) return

    joinProjectRoom(projectId)

    const handleCreated = ({ task }: { task: Task }) => {
      // Subtarefa não vira card solto (a lista só traz tasks raiz): só soma no contador da mãe.
      if (task.parentId) {
        setTasks((prev) => prev.map((t) => (t.id === task.parentId ? { ...t, subtasksCount: (t.subtasksCount ?? 0) + 1 } : t)))
        return
      }
      setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]))
    }
    // O payload do socket é a task crua (sem tags/responsáveis): mescla, não substitui.
    const handleUpdated = ({ task }: { task: Task }) => mergeTask(task)
    // Reconexão (ex.: Azure derruba o websocket) sai de todas as rooms.
    const rejoin = () => joinProjectRoom(projectId)

    socket.on('task.created', handleCreated)
    socket.on('task.updated', handleUpdated)
    socket.on('connect', rejoin)

    return () => {
      socket.off('task.created', handleCreated)
      socket.off('task.updated', handleUpdated)
      socket.off('connect', rejoin)
      leaveProjectRoom(projectId)
    }
  }, [projectId])

  function setView(mode: ViewMode) {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('view', mode); return next })
  }

  function openTask(taskId: string) {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('task', taskId); return next })
  }

  function mergeTask(changes: Partial<Task> & { id: string }) {
    setTasks((prev) => prev.map((t) => (t.id === changes.id ? { ...t, ...changes } : t)))
  }

  function closeTask() {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete('task'); return next })
  }

  // Otimista: aplica a mudança local antes da resposta do servidor, senão o
  // card só "pula" de coluna/dia depois do round-trip do PATCH — parecendo
  // travado durante o drag. Desfaz se o servidor recusar.
  const { canEdit, canConfigure } = useProjectRole() // visualizador: sem criar nem mover

  async function moveTask(taskId: string, changes: Partial<{ statusId: string; dueDate: string | null }>) {
    if (!projectId) return
    const previous = tasks.find((t) => t.id === taskId)
    if (!previous) return
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...changes } : t)))
    try {
      const updated = await updateTask(projectId, taskId, changes)
      // A resposta do PATCH é a task crua (sem tags, responsáveis, tipo, contadores,
      // bloqueios): mescla sobre o card para não perder essas relações.
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)))
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? previous : t)))
      toast.error(apiErrorMessage(err, 'Não foi possível mover a task.'))
    }
  }

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])

  const filteredTasks = useMemo(() => {
    const f = filters.values
    const q = searchText.trim().toLowerCase()
    return tasks.filter((t) => {
      if (listFilter && t.listId !== listFilter) return false
      // Busca no título e no ID ("bug-12" acha BUG-12).
      if (q && !t.title.toLowerCase().includes(q) && !taskLabel(t).toLowerCase().includes(q)) return false
      if (!matchesFilter(f.status, t.statusId)) return false
      // Responsável: o principal ou qualquer um dos "também responsáveis"; 'none' = sem responsável.
      if (f.assignee !== 'all') {
        const people = [t.assigneeId ?? 'none', ...(t.multiAssignees ?? []).map((a) => a.userId)]
        if (!f.assignee.split(',').some((id) => people.includes(id))) return false
      }
      if (!matchesFilter(f.priority, t.priority)) return false
      if (!matchesFilter(f.type, t.taskTypeId)) return false
      if (!matchesFilter(f.sprint, t.sprintId ?? 'none')) return false
      if (f.tag !== 'all' && !(t.tags ?? []).some((x) => f.tag.split(',').includes(x.tagId))) return false
      if (f.dateFrom || f.dateTo) {
        const due = t.dueDate?.slice(0, 10)
        if (!due || (f.dateFrom && due < f.dateFrom) || (f.dateTo && due > f.dateTo)) return false
      }
      return true
    })
  }, [tasks, searchText, filters.values, listFilter])

  function clearListFilter() {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete('list'); return next })
  }

  // Seleção só vale para o que está visível: filtrou, as escondidas saem do lote.
  const visibleSelected = useMemo(
    () => filteredTasks.filter((t) => selectedIds.has(t.id)).map((t) => t.id),
    [filteredTasks, selectedIds],
  )

  function toggleSelection(taskIds: string[], selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of taskIds) { if (selected) next.add(id); else next.delete(id) }
      return next
    })
  }

  function reloadTasks() {
    if (!projectId) return
    listTasks(projectId).then(setTasks).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div className="prj-tools" style={{ padding: '4px var(--page-gutter) 12px', justifyContent: 'space-between', flexShrink: 0 }}>
        <div role="tablist" aria-label="Visualização das tasks" className="subtabs">
          {VIEWS.map(({ mode, label }) => (
            <button key={mode} type="button" role="tab" aria-selected={view === mode} onClick={() => setView(mode)}>{label}</button>
          ))}
        </div>
        <Btn variant="primary" size="sm" onClick={() => setCreateOpen(true)} disabled={statuses.length === 0 || !canEdit}
          title={canEdit ? undefined : 'Visualizadores não criam tasks'}>
          Nova task
        </Btn>
      </div>

      {(view === 'board' || view === 'list' || view === 'calendar') && (
        <div className="prj-tools" style={{ padding: '0 var(--page-gutter) 14px', flexShrink: 0 }}>
          <FilterSearchInput value={searchText} onChange={setSearchText} placeholder="Buscar por ID ou título…" width="min(260px, 100%)" />
          <div style={{ position: 'relative' }}>
            <FilterButton {...filters.buttonProps} />
            <FilterDropdown {...filters.dropdownProps} dateLabel="Prazo">
              <FilterField label="Status">
                <FilterSelect value={filters.values.status} onChange={(v) => filters.set('status', v)}>
                  <option value="all">Todos</option>
                  {statuses.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </FilterSelect>
              </FilterField>
              <FilterField label="Responsável">
                <FilterSelect value={filters.values.assignee} onChange={(v) => filters.set('assignee', v)}>
                  <option value="all">Todos</option>
                  <option value="none">Sem responsável</option>
                  {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
                </FilterSelect>
              </FilterField>
              <FilterField label="Prioridade">
                <FilterSelect value={filters.values.priority} onChange={(v) => filters.set('priority', v)}>
                  <option value="all">Todas</option>
                  <option value="critical">Crítica</option>
                  <option value="high">Alta</option>
                  <option value="normal">Normal</option>
                  <option value="low">Baixa</option>
                  <option value="none">Sem prioridade</option>
                </FilterSelect>
              </FilterField>
              <FilterField label="Tipo">
                <FilterSelect value={filters.values.type} onChange={(v) => filters.set('type', v)}>
                  <option value="all">Todos</option>
                  {taskTypes.map((tt) => <option key={tt.id} value={tt.id}>{tt.name} ({tt.prefix})</option>)}
                </FilterSelect>
              </FilterField>
              {tags.length > 0 && (
                <FilterField label="Tag">
                  <FilterSelect value={filters.values.tag} onChange={(v) => filters.set('tag', v)}>
                    <option value="all">Todas</option>
                    {tags.map((tg) => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
                  </FilterSelect>
                </FilterField>
              )}
              {sprints.length > 0 && (
                <FilterField label="Sprint">
                  <FilterSelect value={filters.values.sprint} onChange={(v) => filters.set('sprint', v)}>
                    <option value="all">Todas</option>
                    <option value="none">Sem sprint</option>
                    {sprints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                  </FilterSelect>
                </FilterField>
              )}
            </FilterDropdown>
          </div>
          {listFilter && (
            <span className="prj-scope">
              Lista: {listName ?? '…'}
              <button type="button" className="icon-act" onClick={clearListFilter} aria-label="Mostrar todas as listas" title="Mostrar todas as listas"><X size={14} /></button>
            </span>
          )}
          {(filters.activeCount > 0 || searchText || listFilter) && (
            <span style={{ fontSize: 13, color: 'var(--text-3)' }} role="status">
              {filteredTasks.length} de {tasks.length} tasks
            </span>
          )}
          <div style={{ flex: 1 }} />

          {view === 'board' && (
            <>
              <select
                aria-label="Agrupar por"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as BoardGroupBy)}
                className="prj-select"
              >
                <option value="status">Agrupar por status</option>
                <option value="assignee">Agrupar por responsável</option>
                <option value="priority">Agrupar por prioridade</option>
                <option value="sprint">Agrupar por sprint</option>
              </select>

              <Btn variant="ghost" size="sm" onClick={() => setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'))} title="Alternar densidade dos cards">
                {density === 'compact' ? 'Compacta' : 'Confortável'}
              </Btn>
            </>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <Loading label="Carregando tarefas…" />
        ) : loadError ? (
          <EmptyState
            title="Não foi possível carregar as tasks"
            desc={loadError}
            action={<Btn variant="secondary" size="sm" onClick={load}>Tentar novamente</Btn>}
          />
        ) : (
          <>
            {view === 'board' && (
              <BoardView
                statuses={statuses}
                tasks={filteredTasks}
                onOpenTask={openTask}
                onMoveTask={(id, statusId) => { if (canEdit) moveTask(id, { statusId }) }}
                members={members}
                sprints={sprints}
                groupBy={groupBy}
                density={density}
              />
            )}
            {view === 'list' && (
              <ListView
                statuses={statuses}
                tasks={filteredTasks}
                onOpenTask={openTask}
                members={members}
                selection={canEdit ? { selectedIds, onToggle: toggleSelection } : undefined}
                onStatusChange={canEdit ? (id, statusId) => moveTask(id, { statusId }) : undefined}
              />
            )}
            {view === 'calendar' && (
              <CalendarView tasks={filteredTasks} statusById={statusById} onOpenTask={openTask} onMoveTask={(id, dueDate) => { if (canEdit) moveTask(id, { dueDate }) }} />
            )}
            {(view === 'gantt' || view === 'timeline') && projectId && (
              <TimelineView projectId={projectId} mode={view} onOpenTask={openTask} />
            )}
          </>
        )}
      </div>

      {view === 'list' && canEdit && projectId && visibleSelected.length > 0 && (
        <BulkActionBar
          projectId={projectId}
          selectedIds={visibleSelected}
          visibleCount={filteredTasks.length}
          statuses={statuses}
          members={members}
          sprints={sprints}
          canConfigure={canConfigure}
          onApplied={() => { setSelectedIds(new Set()); reloadTasks() }}
          onClear={() => setSelectedIds(new Set())}
          onSelectAllVisible={() => toggleSelection(filteredTasks.map((t) => t.id), true)}
        />
      )}

      {openTaskId && projectId && <TaskDrawer projectId={projectId} taskId={openTaskId} onClose={closeTask} onTaskChange={mergeTask} onOpenTask={openTask} />}
      {projectId && (
        <CreateTaskModal
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(task) => { setTasks((prev) => [...prev, task]); setCreateOpen(false) }}
          projectId={projectId}
          statuses={statuses}
          defaultStatusId={(statuses.find((st) => st.category === 'open') ?? statuses[0])?.id}
        />
      )}
    </div>
  )
}
