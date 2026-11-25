import { useState, useEffect, useCallback } from 'react'
import { dashboardService } from '@/services/dashboardService'
import { InactiveTicket } from '@/types'
import { Card, Figures, PriorityBadge, SortHeader, StatCard, SearchableSelect, Loading } from '@/components/ui'
import { useTableSort, PRIORITY_RANK, ticketNumber } from '@/hooks/useTableSort'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { FilterField } from '@/components/filters/FilterField'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { DashFilters, DashHead, TicketCells, ticketLink } from './parts'

const LEVELS = [
  { key: 'critical', label: 'Crítico', range: '4 dias ou mais', tone: 'urgent' },
  { key: 'alert', label: 'Alerta', range: '3 dias', tone: 'soon' },
  { key: 'attention', label: 'Atenção', range: '2 dias', tone: '' },
  { key: 'monitor', label: 'Monitorar', range: '1 dia', tone: '' },
]
const COLS = ['ID', 'Título / empresa', 'Inativo há', 'Últ. por', 'Analista', 'Prior.', 'Fila']

const LAST_BY_LABELS: Record<string, string> = { client: 'Cliente', agent: 'Analista', system: 'Sistema' }

export function InactivityDashboard({ agents, queues, orgs, onNavigate }: { agents: any[]; queues: any[]; orgs: any[]; onNavigate?: (a: { view: string; filters?: any }) => void }) {
  const [data, setData] = useState<{ tickets: InactiveTicket[]; summary: any } | null>(null)
  const colSort = useTableSort<string>()
  const [analystFilter, setAnalystFilter] = useState('all')
  const [queueFilter, setQueueFilter] = useState('all')
  const [orgFilter, setOrgFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('inactivity-dashboard'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)
  const filterDefaults = { analyst: 'all', queue: 'all', org: 'all', priority: 'all' }
  const activeFilterCount = countActiveFilters(
    { analyst: analystFilter, queue: queueFilter, org: orgFilter, priority: priorityFilter },
    filterDefaults
  )

  function handleClear() {
    setAnalystFilter('all'); setQueueFilter('all'); setOrgFilter('all'); setPriorityFilter('all')
    setActiveSavedFilter(null)
  }
  function handleSelectSaved(filter: SavedFilter) {
    const f = filter.filters
    if (typeof f.analyst === 'string') setAnalystFilter(f.analyst)
    if (typeof f.queue === 'string') setQueueFilter(f.queue)
    if (typeof f.org === 'string') setOrgFilter(f.org)
    if (typeof f.priority === 'string') setPriorityFilter(f.priority)
    setActiveSavedFilter(filter)
  }
  function handleSaveFilter(name: string) {
    const filter: SavedFilter = { id: crypto.randomUUID(), name, filters: { analyst: analystFilter, queue: queueFilter, org: orgFilter, priority: priorityFilter } }
    saveFilter('inactivity-dashboard', filter)
    setSavedFilters(getSavedFilters('inactivity-dashboard'))
  }
  function handleDeleteSaved(id: string) {
    deleteFilter('inactivity-dashboard', id)
    setSavedFilters(getSavedFilters('inactivity-dashboard'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (analystFilter !== 'all') params.analystId = analystFilter
      if (queueFilter !== 'all') params.queue = queueFilter
      if (orgFilter !== 'all') params.orgId = orgFilter
      if (priorityFilter !== 'all') params.priority = priorityFilter
      const d = await dashboardService.getInactivity(params)
      setData(d)
    } catch (err) {
      console.error('[InactivityDashboard]', err)
    } finally {
      setLoading(false)
    }
  }, [analystFilter, queueFilter, orgFilter, priorityFilter])

  useEffect(() => { load() }, [load])

  return (
    <div className="dash-page">
      <DashHead title="Chamados parados" sub="Sem nenhuma atualização do cliente ou do analista">
        <DashFilters activeCount={activeFilterCount} saved={savedFilters} activeSaved={activeSavedFilter}
          onSelect={handleSelectSaved} onSave={handleSaveFilter} onDelete={handleDeleteSaved} onClear={handleClear}>
          <FilterField label="Analista">
            <SearchableSelect
              compact
              multiple
              value={analystFilter}
              onChange={v => setAnalystFilter(v)}
              placeholder="Todos os analistas"
              searchPlaceholder="Buscar analista..."
              options={[
                { value: 'all', label: 'Todos os analistas' },
                ...agents.map((a: any) => ({ value: a.id, label: a.name })),
              ]}
            />
          </FilterField>
          <FilterField label="Fila">
            <FilterSelect value={queueFilter} onChange={v => setQueueFilter(v)}>
              <option value="all">Todas as filas</option>
              {queues.map((q: any) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </FilterSelect>
          </FilterField>
          <FilterField label="Empresa">
            <SearchableSelect
              compact
              multiple
              value={orgFilter}
              onChange={v => setOrgFilter(v)}
              placeholder="Todas as empresas"
              searchPlaceholder="Buscar empresa..."
              options={[
                { value: 'all', label: 'Todas as empresas' },
                ...orgs.map((o: any) => ({ value: o.id, label: o.name })),
              ]}
            />
          </FilterField>
          <FilterField label="Prioridade">
            <FilterSelect value={priorityFilter} onChange={v => setPriorityFilter(v)}>
              <option value="all">Todas as prioridades</option>
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </FilterSelect>
          </FilterField>
        </DashFilters>
      </DashHead>

      <Figures>
        {LEVELS.map(lv => <StatCard key={lv.key} label={lv.label} value={String(data?.summary[lv.key] ?? 0)} sub={lv.range} />)}
      </Figures>

      {loading ? (
        <Loading label="Carregando chamados inativos…" />
      ) : !data?.tickets.length ? (
        <p className="empty-line">Nenhum chamado inativo nos últimos 4 dias.</p>
      ) : (
        LEVELS.map(lv => {
          const group = data?.tickets.filter(t => t.level === lv.key) || []
          if (group.length === 0) return null
          return (
            <Card key={lv.key} className="sect">
              <h3>{lv.label}<small>{group.length} · {lv.range}</small></h3>
              <div className="scroll-x sect-body">
                <table className="table">
                  <thead><tr>{COLS.map(h => <th key={h}><SortHeader label={h} {...colSort.header(h)} /></th>)}</tr></thead>
                  <tbody>
                    {colSort.apply(group, {
                      'ID': t => ticketNumber(t),
                      'Título / empresa': t => t.title,
                      'Analista': t => t.assignedTo?.name,
                      'Fila': t => t.queue,
                      'Prior.': t => PRIORITY_RANK[t.priority],
                      'Inativo há': t => t.inactiveDays,
                      'Últ. por': t => LAST_BY_LABELS[t.lastBy],
                    }).map(t => (
                      <tr key={t.id} {...ticketLink(t.id, onNavigate)}>
                        <TicketCells id={t.display_number} title={t.title} org={t.org?.name} />
                        <td className={`num ${lv.tone}`}>{t.inactiveDays} dia{t.inactiveDays !== 1 ? 's' : ''}</td>
                        <td>{LAST_BY_LABELS[t.lastBy]}</td>
                        <td>{t.assignedTo?.name?.split(' ')[0] || '—'}</td>
                        <td><PriorityBadge priority={t.priority} /></td>
                        <td>{t.queue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}
