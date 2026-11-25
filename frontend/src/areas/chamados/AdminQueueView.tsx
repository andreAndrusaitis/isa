import { useState, useEffect } from 'react'
import { SKADI_NAME } from '@/utils/skadi'
import { adminService } from '@/services/adminService'
import { ticketService } from '@/services/ticketService'
import { connectSocket } from '@/services/socketService'
import { useAuthStore } from '@/store/auth'
import { SLABadge, isAiResolved, PageHeader, EmptyState, Pagination, Loading, Btn } from '@/components/ui'
import { IntakeFlag } from '@/components/IntakeFlag'
import { useTableSort } from '@/hooks/useTableSort'
import { useTicketPage, useDebounced, serverSort } from '@/hooks/useTicketPage'
import { TicketDetail } from './TicketDetail'
import { TicketRow, TicketRowsHeader } from './list/TicketRow'
import { Ticket, User, Category, Organization, Queue } from '@/types'
import { ScrollFadeIndicator } from '@/components/ui/ScrollFadeIndicator'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { FilterField } from '@/components/filters/FilterField'
import { TicketOwnerFilters, assigneeParams, ASSIGNEE_NONE } from '@/components/filters/TicketOwnerFilters'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'

type ColKey = 'id' | 'title' | 'status' | 'priority' | 'queue' | 'sla' | 'agent'
export function AdminQueueView({ initialFilters, onTicketUpdate, currentUser }: { initialFilters?: any; onTicketUpdate?: (id: string, updates: any) => void; currentUser?: any }) {
  const [data, setData] = useState<{ users: User[]; orgs: Organization[]; queues: Queue[]; categories: Category[] }>({ users: [], orgs: [], queues: [], categories: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(initialFilters?.status || 'all')
  const [queue,  setQueue]  = useState(initialFilters?.queue || 'all')
  const [type,   setType]   = useState('all')
  const [org,    setOrg]    = useState<string>(initialFilters?.orgId || 'all')
  const [agent,  setAgent]  = useState<string>(
    [initialFilters?.assignedToId, initialFilters?.unassigned && ASSIGNEE_NONE].filter(Boolean).join(',') || 'all')
  const me = useAuthStore(s => s.user) ?? { id: '', role: 'admin' }
  const [sort,   setSort]   = useState('newest')
  const colSort = useTableSort<ColKey>()

  // Lista paginada no servidor (busca casa título, número exibido e id)
  const debouncedSearch = useDebounced(search)
  const ticketPage = useTicketPage({
    status: status !== 'all' ? status : undefined,
    queueId: queue !== 'all' ? queue : undefined,
    type: type !== 'all' ? type : undefined,
    categoryId: initialFilters?.categoryId,
    orgId: org !== 'all' ? org : undefined,
    ...assigneeParams(agent, me.id),
    overdue: initialFilters?.overdue || undefined,
    search: debouncedSearch.trim() || undefined,
    ...serverSort(colSort.sort, { id: 'id', title: 'title', status: 'status', priority: 'priority', queue: 'queue', sla: 'sla', agent: 'assignee' },
      sort === 'newest' ? { sort: 'date', dir: 'desc' } : { sort: 'sla', dir: 'asc' }),
  })
  const { rows, setRows } = ticketPage

  const [filterOpen, setFilterOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('admin-queue'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)

  const filterDefaults = { status: 'all', queue: 'all', type: 'all', org: 'all', agent: 'all' }
  const activeFilterCount = countActiveFilters({ status, queue, type, org, agent }, filterDefaults)

  const activeLabels = [['situação', status], ['fila', queue], ['tipo', type], ['empresa', org], ['responsável', agent]].flatMap(([label, v]) => v !== 'all' ? [label] : [])

  function handleClear() {
    setStatus('all'); setQueue('all'); setType('all'); setOrg('all'); setAgent('all')
    setActiveSavedFilter(null)
  }
  function handleSelectSaved(filter: SavedFilter) {
    const f = filter.filters
    if (typeof f.status === 'string') setStatus(f.status)
    if (typeof f.queue === 'string') setQueue(f.queue)
    if (typeof f.type === 'string') setType(f.type)
    setOrg(typeof f.org === 'string' ? f.org : 'all')
    setAgent(typeof f.agent === 'string' ? f.agent : 'all')
    setActiveSavedFilter(filter)
  }
  function handleSaveFilter(name: string) {
    const filter: SavedFilter = { id: crypto.randomUUID(), name, filters: { status, queue, type, org, agent } }
    saveFilter('admin-queue', filter)
    setSavedFilters(getSavedFilters('admin-queue'))
  }
  function handleDeleteSaved(id: string) {
    deleteFilter('admin-queue', id)
    setSavedFilters(getSavedFilters('admin-queue'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  useEffect(() => {
    Promise.all([
      adminService.getUsers(),
      adminService.getOrganizations(),
      adminService.getQueues(),
      adminService.getCategories(),
      // Se tivermos um ticketId inicial (vindo do dashboard), abrimos ele
      initialFilters?.ticketId ? ticketService.getTicket(initialFilters.ticketId).catch(() => null) : null,
    ]).then(([u, o, q, c, target]) => {
      setData({ users: u, orgs: o, queues: q, categories: c }); setLoading(false)
      if (target) setSelected(target)
    }).catch(err => {
      console.error('[AdminQueueView] Erro ao carregar dados:', err)
      setError('Erro ao carregar chamados. Verifique a conexão com o servidor.')
      setLoading(false)
    })
  }, [initialFilters])

  const accessToken = useAuthStore(s => s.accessToken)
  useEffect(() => {
    if (!accessToken) return
    const socket = connectSocket(accessToken)
    const onDeleted = ({ id }: { id: string }) => {
      setRows(prev => prev.filter(t => t.id !== id))
      reload()
      setSelected(s => (s?.id === id ? null : s))
    }
    const reload = () => ticketPage.scheduleReload()
    socket.on('ticket:deleted', onDeleted)
    socket.on('ticket:created', reload)
    socket.on('ticket:updated', reload)
    return () => {
      socket.off('ticket:deleted', onDeleted)
      socket.off('ticket:created', reload)
      socket.off('ticket:updated', reload)
    }
  }, [accessToken, setRows, ticketPage.scheduleReload])

  if (loading) return <Loading label="Carregando chamados…" />
  if (error) return <EmptyState title="Erro ao carregar chamados" desc={error} action={<Btn variant="secondary" size="sm" onClick={() => window.location.reload()}>Tentar novamente</Btn>} />

  const { users: USERS, orgs: ORGS, queues: QUEUES, categories: CATEGORIES } = data

  if (selected && currentUser) {
    return (
      <TicketDetail
        ticket={selected}
        currentUser={currentUser}
        users={USERS}
        queues={QUEUES}
        categories={CATEGORIES}
        orgs={ORGS}
        onClose={() => setSelected(null)}
        onTicketUpdate={(id, updates) => {
          setRows(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
          setSelected(s => s?.id === id ? { ...s, ...updates } : s)
          onTicketUpdate?.(id, updates)
        }}
      />
    )
  }

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <PageHeader title="Todos os chamados" subtitle={`${ticketPage.total} chamados`}/>
      <div className="filter-bar">
        <FilterSearchInput value={search} onChange={setSearch} placeholder="Buscar por número ou título..." width={260} />
        <div style={{ position: 'relative' }}>
          <FilterButton
            activeCount={activeFilterCount}
            activeSavedFilter={activeSavedFilter}
            activeLabels={activeLabels}
            onOpen={() => setFilterOpen((v) => !v)}
            onClearSaved={() => { setActiveSavedFilter(null); handleClear() }}
            isOpen={filterOpen}
          />
          <FilterDropdown
            isOpen={filterOpen}
            onClose={() => setFilterOpen(false)}
            savedFilters={savedFilters}
            onSelectSaved={handleSelectSaved}
            onSaveNew={handleSaveFilter}
            onDeleteSaved={handleDeleteSaved}
            onApply={() => {}}
            onClear={handleClear}
            dateFrom=""
            dateTo=""
            onDateFromChange={() => {}}
            onDateToChange={() => {}}
            showDateFilter={false}
          >
            <FilterField label="Status">
              <FilterSelect value={status} onChange={v => setStatus(v)}>
                <option value="all">Todos os status</option>
                <option value="open">Aberto</option>
                <option value="in_progress">Em atendimento</option>
                <option value="pending">Pendente</option>
                <option value="resolved">Resolvido</option>
                <option value="closed">Fechado</option>
                <option value="ai_resolved">Resolvido pela {SKADI_NAME}</option>
                <option value="team_resolved">Resolvido pela equipe</option>
                <option value="team_closed">Fechado pela equipe</option>
              </FilterSelect>
            </FilterField>
            <FilterField label="Fila">
              <FilterSelect value={queue} onChange={v => setQueue(v)}>
                <option value="all">Todas as filas</option>
                {QUEUES.map((q: any)=><option key={q.id} value={q.id}>{q.name}</option>)}
              </FilterSelect>
            </FilterField>
            <FilterField label="Tipo">
              <FilterSelect value={type} onChange={v => setType(v)}>
                <option value="all">Todos os tipos</option>
                <option value="incident">Incidente</option>
                <option value="request">Requisição</option>
                <option value="problem">Problema</option>
                <option value="change">Mudança</option>
              </FilterSelect>
            </FilterField>
            <TicketOwnerFilters
              orgs={data.orgs}
              users={data.users}
              me={me}
              org={org}
              onOrgChange={setOrg}
              assignee={agent}
              onAssigneeChange={setAgent}
            />
            <FilterField label="Ordenar por">
              <FilterSelect single value={sort} onChange={v => setSort(v)}>
                <option value="newest">Mais recentes</option>
                <option value="sla">SLA mais urgente</option>
              </FilterSelect>
            </FilterField>
          </FilterDropdown>
        </div>
        {initialFilters && (
          <Btn variant="ghost" size="sm" onClick={() => window.location.reload()}>Limpar filtros do dashboard</Btn>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <Pagination
            variant="toolbar"
            page={ticketPage.page}
            pageSize={ticketPage.pageSize}
            total={ticketPage.total}
            onPageChange={ticketPage.setPage}
            onPageSizeChange={ticketPage.setPageSize}
          />
        </div>
      </div>
      <ScrollFadeIndicator className="stack-list">
        <div className="ticket-list">
        <TicketRowsHeader
          className="admin-grid-header"
          number={['id', 'Número']}
          subject={['title', 'Assunto']}
          status={['status', 'Situação']}
          priority="priority"
          owner={['agent', 'Responsável']}
          due={['sla', 'Prazo']}
          header={colSort.header}
        />
        {ticketPage.loading && rows.length===0 && <Loading label="Carregando chamados…" className="app-loading-pinned"/>}
        {!ticketPage.loading && rows.length===0 && <EmptyState title="Nenhum chamado encontrado" desc="Tente ajustar os filtros."/>}
        {rows.map((t: any) => (
          <TicketRow
            key={t.id}
            className="admin-grid-row"
            status={t.status}
            number={t.displayNumber}
            title={t.title}
            type={t.type}
            priority={t.priority}
            done={['resolved', 'closed'].includes(t.status)}
            meta={[
              t.is_reopened && <span className="danger">Reaberto</span>,
              <IntakeFlag ticketId={t.id} status={t.intake_status} ticketStatus={t.status} compact />,
              <span>{ORGS.find((o: any) => o.id === t.orgId)?.name ?? '—'}</span>,
              <span>{t.queue ? QUEUES.find((q: any) => q.id === t.queue)?.name ?? 'Fila desconhecida' : 'Sem fila'}</span>,
            ]}
            deadline={isAiResolved(t) ? '—' : <SLABadge deadline={t.slaDeadline} status={t.status} resolvedAt={t.resolved_at} compact />}
            ownerName={USERS.find((u: any) => u.id === t.assignedToId)?.name}
            owner={<span>{USERS.find((u: any) => u.id === t.assignedToId)?.name ?? 'Sem responsável'}</span>}
            onOpen={() => setSelected(t)}
          />
        ))}
        </div>
      </ScrollFadeIndicator>
    </div>
  )
}
