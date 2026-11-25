import { useState, useEffect, useCallback, useRef } from 'react'
import { SKADI_NAME } from '@/utils/skadi'
import { dashboardService } from '@/services/dashboardService'
import { adminService } from '@/services/adminService'
import { ticketService } from '@/services/ticketService'
import { Btn, Card, Figures, StatCard, StatusBadge, PriorityBadge, SortHeader, SearchableSelect, Loading } from '@/components/ui'
import { useTableSort, STATUS_RANK, PRIORITY_RANK, ticketNumber } from '@/hooks/useTableSort'
import { DashboardOverview, SlaExpiringTicket } from '@/types'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { Columns } from '@/components/charts/Columns'
import { Donut } from '@/components/charts/Donut'
import { BarList } from '@/components/charts/BarList'
import { Archive, CheckCircle2, CircleDot, Pause, Play, Sparkles } from 'lucide-react'
import { HeatmapGrid } from '@/components/charts/HeatmapGrid'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { Choice, DashFilters, DashHead, TicketCells, formatTimeRemaining, ticketLink } from './parts'

const PERIODS = [['day', '30 dias'], ['week', '12 semanas'], ['month', '12 meses']] as const
const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto', in_progress: 'Em atendimento', pending: 'Pendente', resolved: 'Resolvido', ai_resolved: `Resolvidos pela ${SKADI_NAME}`, closed: 'Fechado'
}
// Resolvido e Fechado aqui são só da equipe: a lista precisa abrir o mesmo recorte do número.
const LIST_FILTER: Record<string, string> = { resolved: 'team_resolved', closed: 'team_closed' }
const listFilter = (status: string) => ({ view: 'queue_all', filters: { status: LIST_FILTER[status] ?? status } })
const PRIORITY_LABELS: Record<string, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' }
// Semana começando na segunda (índices do getDay: 0 = domingo).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const WEEKDAY_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function formatTooltipDate(dateStr: string, period: string) {
  try {
    if (period === 'day') {
      const [year, month, day] = dateStr.split('-').map(Number)
      const date = new Date(year, month - 1, day, 12, 0, 0)
      const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
      const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
      return `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()} (${dayNames[date.getDay()]})`
    } else if (period === 'week') {
      const [year, month, day] = dateStr.split('-').map(Number)
      const start = new Date(year, month - 1, day, 12, 0, 0)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `Semana de ${pad(start.getDate())}/${pad(start.getMonth() + 1)} a ${pad(end.getDate())}/${pad(end.getMonth() + 1)}/${end.getFullYear()}`
    } else if (period === 'month') {
      const [year, month] = dateStr.split('-')
      const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
      const mIdx = parseInt(month, 10) - 1
      return `${months[mIdx] || month} de ${year}`
    } else if (period === 'year') {
      return `Ano: ${dateStr}`
    }
  } catch (e) {
    console.error('Error formatting date:', e)
  }
  return dateStr
}

function formatAxisDate(dateStr: string, period: string) {
  try {
    if (period === 'day') {
      const [, month, day] = dateStr.split('-')
      return `${day}/${month}`
    } else if (period === 'week') {
      const [, month, day] = dateStr.split('-')
      return `${day}/${month}`
    } else if (period === 'month') {
      const [year, month] = dateStr.split('-')
      const shortMonths = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
      const mIdx = parseInt(month, 10) - 1
      const shortYear = year.slice(2)
      return `${shortMonths[mIdx] || month}/${shortYear}`
    } else if (period === 'year') {
      return dateStr
    }
  } catch (e) {
    console.error('Error formatting axis date:', e)
  }
  return dateStr
}

const STATUS_ICON: Record<string, typeof CircleDot> = { open: CircleDot, in_progress: Play, pending: Pause, resolved: CheckCircle2, ai_resolved: Sparkles, aiResolved: Sparkles, closed: Archive }
const STATUS_TONE: Record<string, 'soon' | 'ok' | 'alt' | 'calm' | undefined> = { in_progress: 'alt', pending: 'soon', resolved: 'ok', closed: 'calm' }
const STATUS_COLOR: Record<string, string> = { open: 'var(--c1)', in_progress: 'var(--c3)', pending: 'var(--c4)', resolved: 'var(--c2)', aiResolved: 'var(--c6)', ai_resolved: 'var(--c6)', closed: 'var(--text-3)' }

export function OverviewDashboard({ onNavigate }: { onNavigate?: (a: { view: string; filters?: any }) => void }) {
  const colSort = useTableSort<string>()
  const [data, setData] = useState<DashboardOverview | null>(null)
  const [period, setPeriod] = useState('month')
  const [orgFilter, setOrgFilter] = useState('all')
  const [queueFilter, setQueueFilter] = useState('all')
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('dashboard-overview'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)
  const [orgs, setOrgs] = useState<any[]>([])
  const [queues, setQueues] = useState<any[]>([])
  const [expiring, setExpiring] = useState<SlaExpiringTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const [selectedPoint, setSelectedPoint] = useState<{ date: string; tickets: { id: string }[] } | null>(null)
  const [selectedTicketsDetails, setSelectedTicketsDetails] = useState<any[]>([])
  const [loadingTickets, setLoadingTickets] = useState(false)
  const ticketsListRef = useRef<HTMLDivElement>(null)

  // Reset selected point when filters change
  useEffect(() => {
    setSelectedPoint(null)
  }, [period, orgFilter, queueFilter])

  // Fetch detailed tickets when selectedPoint changes
  useEffect(() => {
    if (!selectedPoint || !selectedPoint.tickets.length) {
      setSelectedTicketsDetails([])
      return
    }
    setLoadingTickets(true)
    // Mostra até 100 chamados do ponto (limite da página); paginar se um dia passar disso
    const ids = selectedPoint.tickets.slice(0, 100).map((t: any) => t.id).join(',')
    ticketService.getTicketsPage({ ids, page: 1, pageSize: 100, sort: 'date', dir: 'desc' })
      .then(res => setSelectedTicketsDetails(res.data))
      .catch(err => {
        console.error('[OverviewDashboard] Erro ao carregar chamados:', err)
      })
      .finally(() => {
        setLoadingTickets(false)
      })
  }, [selectedPoint])

  // Scroll to tickets list when opened
  useEffect(() => {
    if (selectedPoint && ticketsListRef.current) {
      ticketsListRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedPoint, loadingTickets])

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = { period }
      if (orgFilter !== 'all') params.orgId = orgFilter
      if (queueFilter !== 'all') params.queue = queueFilter
      const [d, sla] = await Promise.all([
        dashboardService.getOverview(params),
        dashboardService.getSlaExpiring(params).catch(() => null),
      ])
      setData(d)
      setExpiring(sla?.tickets ?? [])
      setLastUpdated(new Date())
    } catch (err) {
      console.error('[OverviewDashboard]', err)
    } finally {
      setLoading(false)
    }
  }, [period, orgFilter, queueFilter])

  useEffect(() => {
    Promise.all([adminService.getOrganizations(), adminService.getQueues()]).then(([o, q]) => {
      setOrgs(o); setQueues(q)
    })
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const interval = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [load])

  const OV_DEFAULTS = { period: 'month', orgFilter: 'all', queueFilter: 'all' }
  const activeFilterCount = countActiveFilters({ period, orgFilter, queueFilter }, OV_DEFAULTS)

  const handleClear = () => { setPeriod('month'); setOrgFilter('all'); setQueueFilter('all'); setActiveSavedFilter(null) }
  const handleSelectSaved = (sf: SavedFilter) => {
    const f = sf.filters
    if (f.period !== undefined) setPeriod(f.period as string)
    if (f.orgFilter !== undefined) setOrgFilter(f.orgFilter as string)
    if (f.queueFilter !== undefined) setQueueFilter(f.queueFilter as string)
    setActiveSavedFilter(sf)
  }
  const handleSaveFilter = (name: string) => {
    const sf: SavedFilter = { id: crypto.randomUUID(), name, filters: { period, orgFilter, queueFilter } }
    saveFilter('dashboard-overview', sf)
    setSavedFilters(getSavedFilters('dashboard-overview'))
  }
  const handleDeleteSaved = (id: string) => {
    deleteFilter('dashboard-overview', id)
    setSavedFilters(getSavedFilters('dashboard-overview'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  if (loading) return <Loading label="Carregando dashboard…" style={{ height: '100%' }} />

  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0
  const queueLabel = (id: string) => queues.find((q: any) => q.id === id)?.name || id

  return (
    <div className="dash-page">
      <DashHead title="Visão geral" sub={`Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}>
        <DashFilters activeCount={activeFilterCount} saved={savedFilters} activeSaved={activeSavedFilter}
          onSelect={handleSelectSaved} onSave={handleSaveFilter} onDelete={handleDeleteSaved} onClear={handleClear}>
          <FilterField label="Período">
            <FilterSelect single value={period} onChange={v => setPeriod(v)}>
              <option value="day">Por Dia (últimos 30 dias)</option>
              <option value="week">Por semana (últimas 12 semanas)</option>
              <option value="month">Por mês (últimos 12 meses)</option>
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
          <FilterField label="Fila">
            <FilterSelect value={queueFilter} onChange={v => setQueueFilter(v)}>
              <option value="all">Todas as filas</option>
              {queues.map((q: any) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </FilterSelect>
          </FilterField>
        </DashFilters>
      </DashHead>

      <Figures>
        {data && Object.entries(data.counts).map(([status, count]) => (
          <StatCard key={status} icon={STATUS_ICON[status]} tone={STATUS_TONE[status]} label={STATUS_LABELS[status]} value={count.toLocaleString('pt-BR')}
            sub={total > 0 ? `${Math.round((count / total) * 100)}% do total` : ''}
            onClick={onNavigate ? () => onNavigate(listFilter(status)) : undefined} />
        ))}
      </Figures>

      <div className="dash-grid">
      <Card className="sect w8">
        <div className="sect-top">
          <div>
            <h3 className="sect-title">Chamados abertos por período</h3>
            <p>Área: abertos para a equipe. Linha: resolvidos pela {SKADI_NAME}.</p>
          </div>
          <Choice label="Agrupar por" options={PERIODS} value={period} onChange={setPeriod} />
        </div>
        <div className="sect-body">
          <TimeSeriesChart
            ariaLabel="Chamados abertos por período"
            height={318}
            data={(data?.timeSeries || []).map(p => ({ x: p.date, count: p.count, aiResolved: p.aiResolved }))}
            series={[
              { key: 'count', label: 'Chamados abertos', color: 'var(--c1)', type: 'area' },
              { key: 'aiResolved', label: `Resolvidos pela ${SKADI_NAME}`, color: 'var(--c6)', type: 'line' },
            ]}
            xLabel={(x) => formatAxisDate(x, period)}
            tooltipTitle={(x) => formatTooltipDate(x, period)}
            selected={selectedPoint?.date}
            selectHint="Clique para listar os chamados"
            onSelect={(i) => {
              const p = data!.timeSeries[i]
              setSelectedPoint(selectedPoint?.date === p.date ? null : { date: p.date, tickets: p.tickets ?? [] })
            }}
          />
        </div>
      </Card>
        <Card className="sect w4">
          <h3>Por situação</h3>
          <div className="sect-body">
            <Donut ariaLabel="Chamados por situação" center="chamados" onSelect={onNavigate ? id => onNavigate(listFilter(id)) : undefined}
              parts={Object.entries(data?.counts ?? {}).map(([id, value]) => ({ id, label: STATUS_LABELS[id], value, color: STATUS_COLOR[id] }))} />
          </div>
        </Card>
        <Card className="sect w5">
          <h3>Vencem nas próximas 4 horas<small>{expiring.length}</small></h3>
          <div className="sect-body">
            {expiring.length === 0 ? <p className="empty-line">Nenhum chamado perto do prazo.</p> : (
              <table className="table">
                <tbody>
                  {expiring.slice(0, 6).map(t => (
                    <tr key={t.id} {...ticketLink(t.id, onNavigate)}>
                      <TicketCells id={t.display_number} title={t.title} org={t.assignedTo?.name ?? 'Sem responsável'} />
                      <td className={`num ${t.level === 'critical' ? 'urgent' : t.level === 'alert' ? 'soon' : ''}`} style={{ textAlign: 'right' }}>{formatTimeRemaining(t.minutesRemaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        <Card className="sect" style={{ gridColumn: 'span 3' }}>
          <h3>Por prioridade</h3>
          <div className="sect-body">
            <Columns ariaLabel="Chamados por prioridade"
              parts={['low', 'medium', 'high'].map((id, i) => ({ id, label: PRIORITY_LABELS[id] ?? id, value: data?.priorityDist?.find(p => p.priority === id)?._count._all ?? 0, color: ['color-mix(in srgb, var(--text-3) 55%, var(--bg-card))', 'var(--c4)', 'var(--c5)'][i] }))} />
          </div>
        </Card>
        <Card className="sect w4">
          <h3>Por fila</h3>
          <div className="sect-body">
            <BarList ariaLabel="Chamados por fila" showShare colorful labelWidth={110} items={(data?.queueDist || []).map(q => ({ id: q.queue ?? 'sem-fila', label: q.queue ?? 'Sem fila', value: q._count._all })).sort((a, b) => b.value - a.value)} />
          </div>
        </Card>
      <Card className="sect wide">
        <h3>Quando os chamados chegam</h3>
        <p>Abertura por dia da semana e hora nos últimos {data?.demand?.days ?? 90} dias, {(data?.demand?.total ?? 0).toLocaleString('pt-BR')} chamados.</p>
        <div className="sect-body">
          {data?.demand && (
            <HeatmapGrid
              ariaLabel="Chamados abertos por dia da semana e hora"
              rows={WEEK_ORDER.map(d => WEEKDAY_SHORT[d])}
              cols={Array.from({ length: 24 }, (_, h) => `${h}h`)}
              values={WEEK_ORDER.map(d => data.demand!.matrix[d])}
              tooltipTitle={(r, c) => `${WEEKDAY_LONG[WEEK_ORDER[r]]}, ${c}h–${c + 1}h`}
            />
          )}
        </div>
      </Card>
      </div>

      {selectedPoint && (
        <div ref={ticketsListRef} className="panel sect">
          <div className="sect-top">
            <div>
              <h3 className="sect-title">Chamados de {formatTooltipDate(selectedPoint.date, period)}</h3>
              <p>
                {selectedPoint.tickets.length === 0
                  ? 'Nenhum chamado aberto neste período'
                  : selectedPoint.tickets.length === 1
                  ? '1 chamado aberto no período selecionado'
                  : `Mostrando ${selectedPoint.tickets.length} chamados abertos no período selecionado`}
              </p>
            </div>
            <Btn variant="ghost" size="sm" onClick={() => setSelectedPoint(null)}>Fechar painel</Btn>
          </div>
          {loadingTickets ? (
            <Loading size="compact" label="Carregando chamados…" />
          ) : selectedTicketsDetails.length === 0 ? (
            <p className="empty-line">Nenhum chamado aberto registrado neste período.</p>
          ) : (
            <div className="scroll-x sect-body">
              <table className="table">
                <thead><tr>{['ID', 'Título / empresa', 'Status', 'Prioridade', 'Fila', 'Criado em'].map(h => <th key={h}><SortHeader label={h} {...colSort.header(h)} /></th>)}</tr></thead>
                <tbody>
                  {colSort.apply(selectedTicketsDetails, {
                    'ID': (t: any) => ticketNumber(t),
                    'Título / empresa': (t: any) => t.title,
                    'Status': (t: any) => STATUS_RANK[t.status],
                    'Prioridade': (t: any) => PRIORITY_RANK[t.priority],
                    'Fila': (t: any) => queueLabel(t.queue),
                    'Criado em': (t: any) => new Date(t.createdAt),
                  }).map(t => (
                    <tr key={t.id} {...ticketLink(t.id, onNavigate)}>
                      <TicketCells id={t.displayNumber} title={t.title} org={t.org?.name} />
                      <td><StatusBadge status={t.status} /></td>
                      <td><PriorityBadge priority={t.priority} /></td>
                      <td>{queueLabel(t.queue)}</td>
                      <td className="num">{new Date(t.createdAt).toLocaleDateString('pt-BR')} às {new Date(t.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
