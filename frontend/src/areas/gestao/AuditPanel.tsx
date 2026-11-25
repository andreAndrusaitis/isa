import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { PageHeader, EmptyState, Btn, Modal, SortHeader, TruncatedText, Pagination } from '../../components/ui'
import { useTableSort } from '@/hooks/useTableSort'
import { ChevronRight } from 'lucide-react'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { csvCell } from '@/utils/exportSafety'
import { Loading } from '@/components/ui'
import './gestao.css'

export function AuditPanel() {
  const [logs, setLogs] = useState<any[]>([])
  const colSort = useTableSort<string>()
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState({
    action: '',
    resource: '',
    startDate: '',
    endDate: '',
    userId: '',
    search: '',
  })
  const [selectedLog, setSelectedLog] = useState<any>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('audit'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }

  const loadLogs = async () => {
    setLoading(true)
    try {
      const data = await adminService.getAuditLogs({
        page,
        limit: pageSize,
        ...filters
      })
      setLogs(data.items)
      setTotal(data.total ?? 0)
    } catch (err) {
      console.error('[AuditPanel] Erro ao carregar logs:', err)
    } finally {
      setLoading(false)
    }
  }

  const exportLogs = async () => {
    try {
      // Fetch all logs matching filters without pagination for export
      const data = await adminService.getAuditLogs({
        limit: 1000,
        ...filters
      })
      
      const headers = ['Data/hora', 'Recurso', 'Ação', 'Responsável', 'E-mail', 'IP', 'User Agent', 'Detalhes']
      const rows = data.items.map((log: any) => [
        new Date(log.created_at).toLocaleString('pt-BR'),
        log.resource,
        log.action,
        log.user?.name || 'Sistema',
        log.user?.email || 'N/A',
        log.ip || '',
        log.user_agent || '',
        JSON.stringify(log.details)
      ])

      const csvContent = [
        headers.join(','),
        ...rows.map((r: any) => r.map((cell: any) => csvCell(cell)).join(','))
      ].join('\n')

      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', `audit_logs_${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      console.error('[AuditPanel] Erro ao exportar logs:', err)
    }
  }

  useEffect(() => {
    loadLogs()
  }, [page, pageSize, filters])

  const actionLabels: Record<string, string> = {
    LOGIN: 'Login no sistema',
    LOGOUT: 'Sair do sistema',
    CREATE_USER: 'Novo usuário',
    UPDATE_USER: 'Edição de usuário',
    DELETE_USER: 'Exclusão de usuário',
    CREATE_ORG: 'Nova organização',
    UPDATE_ORG: 'Edição de organização',
    DELETE_ORG: 'Exclusão de organização',
    CREATE_CATEGORY: 'Nova categoria',
    UPDATE_CATEGORY: 'Edição de categoria',
    DELETE_CATEGORY: 'Exclusão de categoria',
    CREATE_QUEUE: 'Nova fila',
    UPDATE_QUEUE: 'Edição de fila',
    UPDATE_QUEUE_MEMBERS: 'Analistas da fila',
    DELETE_QUEUE: 'Exclusão de fila',
    CREATE_TICKET: 'Novo chamado',
    UPDATE_TICKET: 'Edição de chamado',
  }

  const resourceLabels: Record<string, string> = {
    AUTH: 'Autenticação',
    TICKET: 'Chamados',
    USER: 'Usuários',
    CATEGORY: 'Categorias',
    ORG: 'Organizações',
    QUEUE: 'Filas',
    SLA: 'Planos/SLA',
    ROUTING: 'Roteamento',
  }

  const AUDIT_DEFAULTS = { action: '', resource: '', startDate: '', endDate: '', userId: '', search: '' }
  const activeFilterCount = countActiveFilters(
    filters as unknown as Record<string, string | boolean>,
    AUDIT_DEFAULTS as unknown as Record<string, string | boolean>
  )

  const handleClear = () => {
    setFilters({ action: '', resource: '', startDate: '', endDate: '', userId: '', search: '' })
    setPage(1)
    setActiveSavedFilter(null)
  }
  const handleSelectSaved = (sf: SavedFilter) => {
    const f = sf.filters
    setFilters({
      action: (f.action as string) ?? '',
      resource: (f.resource as string) ?? '',
      startDate: (f.startDate as string) ?? '',
      endDate: (f.endDate as string) ?? '',
      userId: (f.userId as string) ?? '',
      search: (f.search as string) ?? '',
    })
    setPage(1)
    setActiveSavedFilter(sf)
  }
  const handleSaveFilter = (name: string) => {
    const sf: SavedFilter = { id: crypto.randomUUID(), name, filters: filters as unknown as Record<string, string> }
    saveFilter('audit', sf)
    setSavedFilters(getSavedFilters('audit'))
  }
  const handleDeleteSaved = (id: string) => {
    deleteFilter('audit', id)
    setSavedFilters(getSavedFilters('audit'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader
        title="Auditoria"
        subtitle="Rastreabilidade de todas as ações importantes realizadas no sistema"
        actions={<>
          <Btn variant="secondary" size="sm" onClick={exportLogs}>Exportar CSV</Btn>
          <div style={{ position: 'relative' }}>
            <FilterButton
              activeCount={activeFilterCount}
              activeSavedFilter={activeSavedFilter}
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
              dateFrom={filters.startDate}
              dateTo={filters.endDate}
              onDateFromChange={(v) => { setFilters({ ...filters, startDate: v }); setPage(1) }}
              onDateToChange={(v) => { setFilters({ ...filters, endDate: v }); setPage(1) }}
              showDateFilter={true}
            >
              <FilterField label="Recurso">
                <FilterSelect value={filters.resource} onChange={v => { setFilters({ ...filters, resource: v }); setPage(1) }}>
                  <option value="">Todos</option>
                  <option value="AUTH">Autenticação</option>
                  <option value="TICKET">Chamados</option>
                  <option value="USER">Usuários</option>
                  <option value="ORG">Organizações</option>
                  <option value="CATEGORY">Categorias</option>
                  <option value="QUEUE">Filas</option>
                </FilterSelect>
              </FilterField>
              <FilterField label="Ação">
                <FilterSelect value={filters.action} onChange={v => { setFilters({ ...filters, action: v }); setPage(1) }}>
                  <option value="">Todas</option>
                  <option value="LOGIN">Logins</option>
                  <option value="CREATE_USER">Criação de usuário</option>
                  <option value="UPDATE_USER">Edição de usuário</option>
                  <option value="DELETE_USER">Exclusão de usuário</option>
                  <option value="DELETE">Todas as exclusões</option>
                </FilterSelect>
              </FilterField>
              <FilterField label="Busca">
                <input
                  placeholder="User, IP, Ação..."
                  value={filters.search || ''}
                  onChange={e => { setFilters({ ...filters, search: e.target.value }); setPage(1) }}
                  maxLength={100}
                  style={{ width: '100%', height: 32, padding: '0 8px', fontSize: 13, border: '0 solid var(--field-line)', background: 'var(--bg-input)', color: 'var(--text-1)', fontFamily: 'var(--font)', outline: 'none' }}
                />
              </FilterField>
            </FilterDropdown>
          </div>
        </>}
      />

      <div className="scroll-x" style={{ flex: 1, overflowY: 'auto', padding: '0 var(--page-gutter) 24px' }}>
        {loading && logs.length === 0 ? (
          <Loading label="Carregando logs de auditoria…" />
        ) : logs.length === 0 ? (
          <EmptyState title="Nenhum log encontrado" desc="Não há registros de auditoria para os filtros selecionados." />
        ) : (
          <table className="table">
            <thead><tr>{['Ação', 'Responsável', 'Recurso', 'IP', 'Data/hora', ''].map(h => <th key={h}>{h && <SortHeader label={h} {...colSort.header(h)} />}</th>)}</tr></thead>
            <tbody>
              {/* Ordena só a página carregada; ordenação global exigiria sort no backend */}
              {colSort.apply(logs, {
                'Data/hora': log => new Date(log.created_at),
                'Recurso': log => resourceLabels[log.resource] || log.resource,
                'Ação': log => actionLabels[log.action] || log.action,
                'Responsável': log => log.user?.name || 'Sistema',
                'IP': log => log.ip,
              }).map((log) => (
                <tr key={log.id}>
                  <td className="main" style={{ width: '32%' }}>
                    <TruncatedText text={actionLabels[log.action] || log.action} style={log.action === 'DELETE_USER' ? { color: 'var(--danger)' } : undefined} />
                    {log.action === 'DELETE_USER' && (log.details?.deletedUserName || log.details?.deletedUserEmail) && (
                      <small title={`${log.details.deletedUserName} (${log.details.deletedUserEmail})`}>{log.details.deletedUserName}{log.details.deletedUserEmail && ` · ${log.details.deletedUserEmail}`}</small>
                    )}
                  </td>
                  <td className="main" style={{ width: '30%' }}>
                    <TruncatedText text={log.user?.name || 'Sistema'} />
                    <small>{log.user?.email || 'Ação automática'}</small>
                  </td>
                  <td>{resourceLabels[log.resource] || log.resource}</td>
                  <td className="num" style={{ color: 'var(--text-3)' }}>{log.ip || '—'}</td>
                  <td className="num">{new Date(log.created_at).toLocaleString('pt-BR')}</td>
                  <td style={{ width: 32 }}><button type="button" className="icon-act" aria-label="Ver detalhes" onClick={() => setSelectedLog(log)}><ChevronRight size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={handlePageSizeChange} label="logs" />

      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title="Detalhes da auditoria"
        width={560}
      >
        {selectedLog && (
          <>
            <dl className="pairs">
              <dt>ID</dt><dd>{selectedLog.id}</dd>
              <dt>Data</dt><dd>{new Date(selectedLog.created_at).toLocaleString('pt-BR')}</dd>
              <dt>Responsável</dt><dd>{selectedLog.user?.name} ({selectedLog.user?.email})</dd>
              <dt>IP</dt><dd>{selectedLog.ip}</dd>
              <dt>Navegador</dt><dd>{selectedLog.user_agent}</dd>
              {selectedLog.action === 'DELETE_USER' && selectedLog.details && <>
                <dt>Usuário excluído</dt><dd style={{ color: 'var(--danger)' }}>{selectedLog.details.deletedUserName || selectedLog.details.deletedUserId || '—'}</dd>
                <dt>E-mail original</dt><dd>{selectedLog.details.deletedUserEmail || '—'}</dd>
                <dt>Perfil</dt><dd>{selectedLog.details.deletedUserRole || '—'}</dd>
                {selectedLog.details.deletedUserOrgName && <><dt>Empresa</dt><dd>{selectedLog.details.deletedUserOrgName}</dd></>}
                {selectedLog.details.actorName && <><dt>Excluído por</dt><dd>{selectedLog.details.actorName} {selectedLog.details.actorEmail ? `(${selectedLog.details.actorEmail})` : ''}</dd></>}
                {selectedLog.details.deletedAt && <><dt>Excluído em</dt><dd>{new Date(selectedLog.details.deletedAt).toLocaleString('pt-BR')}</dd></>}
              </>}
            </dl>

            <h3 className="sect-title" style={{ margin: '24px 0 10px', fontSize: 15 }}>Dados da operação (JSON)</h3>
            <pre style={{ margin: 0, padding: 12, background: 'var(--tint)', fontSize: 12.5, color: 'var(--text-1)', overflowX: 'auto' }}>{JSON.stringify(selectedLog.details, null, 2)}</pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <Btn onClick={() => setSelectedLog(null)}>Fechar</Btn>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
