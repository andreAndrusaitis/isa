import { useState, useEffect, useCallback } from 'react'
import { dashboardService } from '@/services/dashboardService'
import { adminService } from '@/services/adminService'
import { SlaExpiringTicket, ForecastOverdueTicket } from '@/types'
import { Card, Figures, StatCard, StatusBadge, PriorityBadge, SortHeader, TruncatedText, Loading } from '@/components/ui'
import { useTableSort, STATUS_RANK, PRIORITY_RANK, ticketNumber } from '@/hooks/useTableSort'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { DashFilters, DashHead, TicketCells, formatTimeRemaining, ticketLink } from './parts'

const LEVELS = [
  { key: 'critical', label: 'Crítico', range: 'até 30 min', tone: 'urgent' },
  { key: 'alert', label: 'Alerta', range: '30 min a 2 h', tone: 'soon' },
  { key: 'attention', label: 'Atenção', range: '2 a 4 h', tone: '' },
]
const COLS = ['ID', 'Título / empresa', 'Tempo', 'Analista', 'Prior.', 'Status', 'Fila']

export function SlaExpiringDashboard({ onNavigate }: { onNavigate?: (a: { view: string; filters?: any }) => void }) {
  const [data, setData] = useState<{ tickets: SlaExpiringTicket[]; forecastOverdue?: ForecastOverdueTicket[]; summary: any } | null>(null)
  const colSort = useTableSort<string>()
  const [queueFilter, setQueueFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [queues, setQueues] = useState<any[]>([])
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('dashboard-sla'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = {}
      if (queueFilter !== 'all') params.queue = queueFilter
      if (priorityFilter !== 'all') params.priority = priorityFilter
      const d = await dashboardService.getSlaExpiring(params)
      setData(d)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('[SlaExpiringDashboard]', err)
    } finally {
      setLoading(false)
    }
  }, [queueFilter, priorityFilter])

  useEffect(() => {
    adminService.getQueues().then(setQueues).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const interval = setInterval(load, 2 * 60 * 1000)
    return () => clearInterval(interval)
  }, [load])

  const SLA_DEFAULTS = { queueFilter: 'all', priorityFilter: 'all' }
  const activeFilterCount = countActiveFilters({ queueFilter, priorityFilter }, SLA_DEFAULTS)

  const handleClear = () => { setQueueFilter('all'); setPriorityFilter('all'); setActiveSavedFilter(null) }
  const handleSelectSaved = (sf: SavedFilter) => {
    const f = sf.filters
    if (f.queueFilter !== undefined) setQueueFilter(f.queueFilter as string)
    if (f.priorityFilter !== undefined) setPriorityFilter(f.priorityFilter as string)
    setActiveSavedFilter(sf)
  }
  const handleSaveFilter = (name: string) => {
    const sf: SavedFilter = { id: crypto.randomUUID(), name, filters: { queueFilter, priorityFilter } }
    saveFilter('dashboard-sla', sf)
    setSavedFilters(getSavedFilters('dashboard-sla'))
  }
  const handleDeleteSaved = (id: string) => {
    deleteFilter('dashboard-sla', id)
    setSavedFilters(getSavedFilters('dashboard-sla'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  if (loading) return <Loading label="Carregando dashboard…" style={{ height: '100%' }} />

  const total = data?.summary?.total || 0
  const critical = data?.summary?.critical || 0
  const forecast = data?.forecastOverdue ?? []

  return (
    <div className="dash-page">
      <DashHead title="SLA a vencer" sub={`Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}, a cada 2 minutos`}>
        <DashFilters activeCount={activeFilterCount} saved={savedFilters} activeSaved={activeSavedFilter}
          onSelect={handleSelectSaved} onSave={handleSaveFilter} onDelete={handleDeleteSaved} onClear={handleClear}>
          <FilterField label="Fila">
            <FilterSelect value={queueFilter} onChange={v => setQueueFilter(v)}>
              <option value="all">Todas as filas</option>
              {queues.map((q: any) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </FilterSelect>
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
        <StatCard label="Previsão de projeto vencida" value={String(data?.summary?.forecastOverdue ?? 0)} sub="SLA pausado no projeto" />
      </Figures>

      {critical > 0 && (
        <p className="urgent" style={{ margin: '16px 0 0', fontSize: 14 }}>
          {critical} chamado{critical !== 1 ? 's' : ''} vence{critical === 1 ? '' : 'm'} em menos de 30 minutos.
        </p>
      )}
      {total === 0 && <p className="empty-line">Nenhum chamado próximo do vencimento. Todos os SLAs estão dentro do prazo seguro.</p>}

      {LEVELS.map(lv => {
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
                    'Status': t => STATUS_RANK[t.status],
                    'Tempo': t => t.minutesRemaining,
                  }).map(t => (
                    <tr key={t.id} {...ticketLink(t.id, onNavigate)}>
                      <TicketCells id={t.display_number} title={t.title} org={t.org?.name} />
                      <td className={`num ${lv.tone}`}>{formatTimeRemaining(t.minutesRemaining)}</td>
                      <td>{t.assignedTo?.name || 'Não atribuído'}</td>
                      <td><PriorityBadge priority={t.priority} /></td>
                      <td><StatusBadge status={t.status} /></td>
                      <td>{t.queue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      })}

      {/* Em projeto com a previsão vencida: SLA pausado, mas o cliente segue esperando. */}
      {forecast.length > 0 && (
        <Card className="sect">
          <h3>Previsão de projeto vencida<small>{forecast.length}</small></h3>
          <p>Chamados vinculados a uma task cujo prazo passou sem conclusão. Atualize o prazo da task (o cliente é avisado) ou devolva o chamado ao atendimento.</p>
          <div className="scroll-x sect-body">
            <table className="table">
              <thead><tr>{['ID', 'Título / empresa', 'Previsão', 'Task do projeto', 'Analista'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {forecast.map(t => (
                  <tr key={t.id} {...ticketLink(t.id, onNavigate)}>
                    <TicketCells id={t.display_number} title={t.title} org={t.org?.name} />
                    <td className="num urgent">{new Date(t.task.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} · há {t.overdueDays} dia{t.overdueDays !== 1 ? 's' : ''}</td>
                    <td className="main" style={{ width: '25%' }}><TruncatedText text={`${t.task.key} ${t.task.title}`} /><small>{t.task.project.name}</small></td>
                    <td>{t.assignedTo?.name || 'Não atribuído'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
