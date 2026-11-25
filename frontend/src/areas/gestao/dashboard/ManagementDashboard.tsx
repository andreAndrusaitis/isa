import { useState, useEffect, useCallback } from 'react'
import { dashboardService } from '@/services/dashboardService'
import { UnassignedTicket } from '@/types'
import { Btn, Card, Figures, PriorityBadge, SortHeader, StatCard, Loading } from '@/components/ui'
import { useTableSort, PRIORITY_RANK, ticketNumber } from '@/hooks/useTableSort'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { FilterField } from '@/components/filters/FilterField'
import { toast } from '@/store/toastStore'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { DashFilters, DashHead, TicketCells, ticketLink } from './parts'

const LEVELS = [
  { key: 'evidence', label: 'Em evidência', range: 'mais de 5 h', tone: 'urgent' },
  { key: 'critical', label: 'Crítico', range: '3 a 5 h', tone: 'soon' },
  { key: 'alert', label: 'Alerta', range: '1 a 3 h', tone: '' },
  { key: 'attention', label: 'Atenção', range: 'menos de 1 h', tone: '' },
]
const COLS = ['ID', 'Título / empresa', 'Aberto há', 'Prior.', 'Categoria', 'Fila', 'Ação']

export function ManagementDashboard({ agents: _agents, onNavigate }: { agents: any[]; onNavigate?: (a: { view: string; filters?: any }) => void }) {
  const [data, setData] = useState<{ tickets: UnassignedTicket[]; summary: any; agents: any[] } | null>(null)
  const colSort = useTableSort<string>()
  const [queueFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('management-dashboard'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)
  const activeFilterCount = countActiveFilters({ priority: priorityFilter }, { priority: 'all' })

  function handleClear() { setPriorityFilter('all'); setActiveSavedFilter(null) }
  function handleSelectSaved(filter: SavedFilter) {
    if (typeof filter.filters.priority === 'string') setPriorityFilter(filter.filters.priority)
    setActiveSavedFilter(filter)
  }
  function handleSaveFilter(name: string) {
    const filter: SavedFilter = { id: crypto.randomUUID(), name, filters: { priority: priorityFilter } }
    saveFilter('management-dashboard', filter)
    setSavedFilters(getSavedFilters('management-dashboard'))
  }
  function handleDeleteSaved(id: string) {
    deleteFilter('management-dashboard', id)
    setSavedFilters(getSavedFilters('management-dashboard'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = {}
      if (queueFilter !== 'all') params.queue = queueFilter
      if (priorityFilter !== 'all') params.priority = priorityFilter
      const d = await dashboardService.getManagement(params)
      setData(d)
    } catch (err) {
      console.error('[ManagementDashboard]', err)
    } finally {
      setLoading(false)
    }
  }, [queueFilter, priorityFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const interval = setInterval(load, 2 * 60 * 1000)
    return () => clearInterval(interval)
  }, [load])

  async function handleAssign(ticketId: string, agentId: string) {
    try {
      await dashboardService.assignTicket(ticketId, agentId)
      load()
      toast.success('Chamado atribuído.')
    } catch (err: any) {
      console.error('[ManagementDashboard] assign error', err)
      toast.error(err.response?.data?.error || 'Não foi possível atribuir o chamado.')
    }
  }

  return (
    <div className="dash-page">
      <DashHead title="Chamados sem atribuição" sub="Atualiza sozinho a cada 2 minutos">
        <DashFilters activeCount={activeFilterCount} saved={savedFilters} activeSaved={activeSavedFilter}
          onSelect={handleSelectSaved} onSave={handleSaveFilter} onDelete={handleDeleteSaved} onClear={handleClear}>
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
        <Loading label="Carregando chamados…" />
      ) : (
        LEVELS.map(lv => {
          const group = data?.tickets.filter(t => t.level === lv.key) || []
          if (group.length === 0) return null
          return (
            <Card key={lv.key} className="sect">
              <h3>{lv.label}<small>{group.length} · {lv.range}</small></h3>
              <div className="scroll-x sect-body">
                <table className="table">
                  <thead><tr>{COLS.map(h => <th key={h}>{h === 'Ação' ? h : <SortHeader label={h} {...colSort.header(h)} />}</th>)}</tr></thead>
                  <tbody>
                    {colSort.apply(group, {
                      'ID': t => ticketNumber(t),
                      'Título / empresa': t => t.title,
                      'Categoria': t => t.category?.name,
                      'Fila': t => t.queue,
                      'Prior.': t => PRIORITY_RANK[t.priority],
                      'Aberto há': t => t.hoursOpen,
                    }).map(t => (
                      <tr key={t.id} {...ticketLink(t.id, onNavigate)}>
                        <TicketCells id={t.display_number} title={t.title} org={t.org?.name} />
                        <td className={`num ${lv.tone}`}>{t.hoursOpen}h</td>
                        <td><PriorityBadge priority={t.priority} /></td>
                        <td>{t.category?.name || '—'}</td>
                        <td>{t.queue}</td>
                        <td style={{ width: 150 }}><AssignButton ticketId={t.id} agents={data?.agents || []} onAssign={handleAssign} /></td>
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

function AssignButton({ ticketId, agents, onAssign }: { ticketId: string; agents: any[]; onAssign: (tid: string, aid: string) => void }) {
  const [open, setOpen] = useState(false)
  if (!open) return <Btn variant="secondary" size="xs" onClick={e => { e.stopPropagation(); setOpen(true) }}>Atribuir</Btn>
  return (
    <select autoFocus aria-label="Analista" onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); onAssign(ticketId, e.target.value); setOpen(false) }} onBlur={() => setOpen(false)}
      style={{ width: '100%', height: 30, padding: '0 8px', fontSize: 13, border: '0 solid var(--field-line)', background: 'var(--bg-input)', color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
      <option value="">Analista...</option>
      {agents.map((a: any) => <option key={a.id} value={a.id}>{a.name.split(' ')[0]}</option>)}
    </select>
  )
}
