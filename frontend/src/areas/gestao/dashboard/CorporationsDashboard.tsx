import { Fragment, useState, useEffect, useCallback } from 'react'
import { dashboardService } from '@/services/dashboardService'
import { Card, Figures, StatCard, StatusBadge, PriorityBadge, TierBadge, TruncatedText, SortHeader, Pagination, SearchableSelect, Loading } from '@/components/ui'
import { useTableSort } from '@/hooks/useTableSort'
import { useTicketPage, serverSort } from '@/hooks/useTicketPage'
import { useQueueName } from '@/hooks/useQueueName'
import { NestedBars, type SunNode } from '@/components/charts/NestedBars'
import { FilterField } from '@/components/filters/FilterField'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { DashFilters, DashHead, ticketLink } from './parts'

export function CorporationsDashboard({ onNavigate }: { onNavigate?: (a: { view: string; filters?: any }) => void }) {
  const [data, setData] = useState<any[]>([])
  // Opções do filtro vêm da carga sem filtro — senão, marcada uma empresa, as outras somem da lista
  const [allOrgs, setAllOrgs] = useState<any[]>([])
  const queueName = useQueueName()
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const colSort = useTableSort<string>()
  // Chamados ativos só da empresa expandida, paginados no servidor
  const orgTickets = useTicketPage({
    orgId: expanded ?? undefined,
    status: 'active',
    ...serverSort(colSort.sort, { 'ID': 'id', 'Título': 'title', 'Analista': 'assignee', 'Fila': 'queue', 'Prioridade': 'priority', 'Status': 'status' }, { sort: 'date', dir: 'desc' }),
  }, { enabled: !!expanded })
  const [orgFilter, setOrgFilter] = useState('all')
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('corporations-dashboard'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)
  const activeFilterCount = countActiveFilters({ org: orgFilter }, { org: 'all' })

  function handleClear() { setOrgFilter('all'); setActiveSavedFilter(null) }
  function handleSelectSaved(filter: SavedFilter) {
    if (typeof filter.filters.org === 'string') setOrgFilter(filter.filters.org)
    setActiveSavedFilter(filter)
  }
  function handleSaveFilter(name: string) {
    const filter: SavedFilter = { id: crypto.randomUUID(), name, filters: { org: orgFilter } }
    saveFilter('corporations-dashboard', filter)
    setSavedFilters(getSavedFilters('corporations-dashboard'))
  }
  function handleDeleteSaved(id: string) {
    deleteFilter('corporations-dashboard', id)
    setSavedFilters(getSavedFilters('corporations-dashboard'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (orgFilter !== 'all') params.orgId = orgFilter
      const d = await dashboardService.getCorporations(params)
      setData(d)
      if (orgFilter === 'all') setAllOrgs(d)
    } catch (err) {
      console.error('[CorporationsDashboard]', err)
    } finally {
      setLoading(false)
    }
  }, [orgFilter])

  useEffect(() => { load() }, [load])

  const orgRows = orgTickets.rows.filter((t: any) => t.orgId === expanded)

  return (
    <div className="dash-page">
      <DashHead title="Empresas e filas de sustentação" sub="SLA e volume por empresa; abra uma linha para ver filas e chamados">
        <DashFilters activeCount={activeFilterCount} saved={savedFilters} activeSaved={activeSavedFilter}
          onSelect={handleSelectSaved} onSave={handleSaveFilter} onDelete={handleDeleteSaved} onClear={handleClear}>
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
                ...allOrgs.map(d => ({ value: d.org.id, label: d.org.name })),
              ]}
            />
          </FilterField>
        </DashFilters>
      </DashHead>

      <Figures>
        <StatCard label="Empresas ativas" value={String(data.length)} />
        <StatCard label="Chamados ativos" value={data.reduce((s, d) => s + d.activeTickets, 0).toLocaleString('pt-BR')} />
        <StatCard label="Prazo vencido" value={data.reduce((s, d) => s + d.overdueTickets, 0).toLocaleString('pt-BR')} />
      </Figures>

      {loading ? (
        <Loading label="Carregando dashboard…" />
      ) : data.length === 0 ? (
        <p className="empty-line">Nenhuma empresa vinculada encontrada</p>
      ) : (
        <div className="scroll-x" style={{ marginTop: 28 }}>
          <table className="table">
            <thead><tr>{['Empresa', 'Plano', 'SLA', 'Ativos', 'Vencidos', 'Filas'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.map(item => {
                const isExpanded = expanded === item.org.id
                return (
                  <Fragment key={item.org.id}>
                    <tr data-link="" className={isExpanded ? 'open' : undefined} onClick={() => setExpanded(isExpanded ? null : item.org.id)}>
                      <td style={{ width: '40%', overflowWrap: 'anywhere', fontWeight: isExpanded ? 600 : 400 }}>{item.org.name}{item.org.managerGlobal && <small> · Global</small>}</td>
                      <td><TierBadge tier={item.org.tier} /></td>
                      <td className="num">{item.org.slaHours}h</td>
                      <td className="num">{item.activeTickets}</td>
                      <td className={`num ${item.overdueTickets > 0 ? 'urgent' : ''}`}>{item.overdueTickets}</td>
                      <td className="num">{item.queueStats?.length || 0}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="detail">
                        <td colSpan={6}>
                          {item.queueStats?.length > 0 ? (
                            <table className="table" style={{ marginBottom: 24 }}>
                              <thead><tr>{['Fila de sustentação', 'Ativos', 'Vencidos', 'Analistas'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                              <tbody>
                                {item.queueStats.map((qs: any) => (
                                  <tr key={qs.queue.id}>
                                    <td>{qs.queue.name}</td>
                                    <td className="num">{qs.active}</td>
                                    <td className={`num ${qs.overdue > 0 ? 'urgent' : ''}`}>{qs.overdue}</td>
                                    <td className="num">{qs.analysts}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : <p className="empty-line" style={{ paddingTop: 0 }}>Nenhuma fila de sustentação vinculada ou ativa.</p>}

                          <div className="sect-top" style={{ alignItems: 'center' }}>
                            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Chamados ativos ({orgTickets.total})</span>
                            <Pagination variant="toolbar" page={orgTickets.page} pageSize={orgTickets.pageSize} total={orgTickets.total} onPageChange={orgTickets.setPage} onPageSizeChange={orgTickets.setPageSize} />
                          </div>
                          {orgRows.length > 0 ? (
                            <table className="table">
                              <thead><tr>{['ID', 'Título', 'Analista', 'Fila', 'Prioridade', 'Status'].map(h => <th key={h}><SortHeader label={h} {...colSort.header(h)} /></th>)}</tr></thead>
                              <tbody>
                                {orgRows.map((t: any) => (
                                  <tr key={t.id} {...ticketLink(t.id, onNavigate)}>
                                    <td className="id">{t.displayNumber}</td>
                                    <td className="main"><TruncatedText text={t.title} /></td>
                                    <td>{t.assignedTo?.name || 'Não atribuído'}</td>
                                    <td>{queueName(t.queue) || '—'}</td>
                                    <td><PriorityBadge priority={t.priority} /></td>
                                    <td><StatusBadge status={t.status} compact /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : orgTickets.loading ? (
                            <Loading size="compact" label="Carregando chamados…" />
                          ) : (
                            <p className="empty-line">Nenhum chamado ativo encontrado para esta corporação.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && data.some(d => d.activeTickets > 0) && (
        <Card className="sect">
          <h3>Onde estão os chamados ativos</h3>
          <p>A parte vermelha é SLA vencido. Clique numa empresa para dividir por fila.</p>
          <div className="sect-body">
            <NestedBars ariaLabel="Chamados ativos por empresa, fila e SLA" rootLabel="Todas as empresas" data={sunburstData(data)} />
          </div>
        </Card>
      )}
    </div>
  )
}

/** Empresa → fila → no prazo / vencido. O que não está em fila de sustentação vira "Outras filas". */
function sunburstData(rows: any[]): SunNode[] {
  return rows.filter(d => d.activeTickets > 0).map(d => {
    const queues = (d.queueStats ?? []).filter((q: any) => q.active > 0)
    // Sem fila de sustentação: a empresa se divide direto em no prazo / vencido.
    if (!queues.length) return {
      id: d.org.id, label: d.org.name,
      children: [
        { id: `${d.org.id}:ok`, label: 'No prazo', value: Math.max(0, d.activeTickets - d.overdueTickets) },
        { id: `${d.org.id}:late`, label: 'SLA vencido', value: d.overdueTickets, color: 'var(--danger)' },
      ],
    }
    const inQueues = queues.reduce((a: number, q: any) => a + q.active, 0)
    const children: SunNode[] = queues.map((q: any) => ({
      id: `${d.org.id}:${q.queue.id}`, label: q.queue.name,
      children: [
        { id: `${d.org.id}:${q.queue.id}:ok`, label: 'No prazo', value: Math.max(0, q.active - q.overdue) },
        { id: `${d.org.id}:${q.queue.id}:late`, label: 'SLA vencido', value: q.overdue, color: 'var(--danger)' },
      ],
    }))
    if (d.activeTickets > inQueues) children.push({ id: `${d.org.id}:outras`, label: 'Outras filas', value: d.activeTickets - inQueues })
    return { id: d.org.id, label: d.org.name, children }
  })
}
