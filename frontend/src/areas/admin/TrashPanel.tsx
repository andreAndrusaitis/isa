import { useEffect, useState } from 'react'
import api, { apiErrorMessage } from '@/services/api'
import { adminService } from '@/services/adminService'
import { useAuthStore } from '@/store/auth'
import { sysAlert } from '@/store/alertStore'
import { toast } from '@/store/toastStore'
import { Btn, Card, Inp, PageHeader, Pagination, Toggle, TruncatedText, Loading } from '@/components/ui'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { SettingRow } from './SettingRow'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'

interface TrashRow {
  id: string
  displayNumber: string
  title: string
  org: { id: string; name: string } | null
  deletedBy: { id: string; name: string } | null
  deletedAt: string
  purgeAt: string | null
}

interface TrashConfig { enabled: boolean; retention_days: number }

const fmt = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const daysLeft = (d: string) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000))

export function TrashPanel() {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [rows, setRows] = useState<TrashRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [orgId, setOrgId] = useState('all')
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<TrashConfig | null>(null)
  const [days, setDays] = useState('')

  const [filterOpen, setFilterOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('trash'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)

  const TRASH_DEFAULTS = { orgId: 'all' }
  const activeFilterCount = countActiveFilters(
    { orgId },
    TRASH_DEFAULTS
  )

  const handleClear = () => {
    setSearch('')
    setOrgId('all')
    setActiveSavedFilter(null)
    setPage(1)
  }

  const handleSelectSaved = (sf: SavedFilter) => {
    const f = sf.filters
    if (typeof f.search === 'string') setSearch(f.search)
    if (typeof f.orgId === 'string') setOrgId(f.orgId)
    setActiveSavedFilter(sf)
    setPage(1)
  }

  const handleSaveFilter = (name: string) => {
    const sf: SavedFilter = {
      id: crypto.randomUUID(),
      name,
      filters: { search, orgId },
    }
    saveFilter('trash', sf)
    setSavedFilters(getSavedFilters('trash'))
  }

  const handleDeleteSaved = (id: string) => {
    deleteFilter('trash', id)
    setSavedFilters(getSavedFilters('trash'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  const load = () => {
    setLoading(true)
    const effectiveOrgId = !orgId || orgId === 'all' ? undefined : orgId
    api.get('/tickets/trash', {
      params: {
        page,
        pageSize,
        search: search.trim() || undefined,
        orgId: effectiveOrgId,
      }
    })
      .then(r => { setRows(r.data.data); setTotal(r.data.total) })
      .catch(err => toast.error(apiErrorMessage(err, 'Não foi possível carregar a Lixeira.')))
      .finally(() => setLoading(false))
  }

  // Busca com pequeno atraso para não consultar a cada tecla.
  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [page, pageSize, search, orgId])

  useEffect(() => {
    adminService.getOrganizations().then(setOrgs).catch(() => {})
    api.get('/tickets/trash/config').then(r => { setConfig(r.data.data); setDays(String(r.data.data.retention_days)) }).catch(() => {})
  }, [])

  const restore = async (t: TrashRow) => {
    if (!await sysAlert.confirm('Restaurar chamado', `${t.displayNumber} volta para as listas com o mesmo número, histórico e anexos.`, 'primary', 'Restaurar')) return
    try {
      await api.post(`/tickets/${t.id}/restore`)
      toast.success(`${t.displayNumber} restaurado.`)
      load()
    } catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível restaurar o chamado.')) }
  }

  const purge = async (t: TrashRow) => {
    if (!await sysAlert.confirm('Excluir definitivamente', `${t.displayNumber} será apagado de vez, com mensagens, histórico e anexos. Esta ação não pode ser desfeita.`, 'danger', 'Excluir definitivamente')) return
    try {
      await api.delete(`/tickets/${t.id}/permanent`)
      toast.success(`${t.displayNumber} excluído definitivamente.`)
      load()
    } catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível excluir o chamado.')) }
  }

  const saveConfig = async (patch: Partial<TrashConfig>) => {
    try {
      const r = await api.put('/tickets/trash/config', patch)
      setConfig(r.data.data)
      setDays(String(r.data.data.retention_days))
      toast.success('Retenção da Lixeira salva.')
      load()
    } catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível salvar a retenção.')) }
  }

  const daysNum = Number(days)
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 3650

  return (
    <div className="adm">
      <PageHeader
        title="Lixeira"
        subtitle={config?.enabled ? `Chamados excluídos são apagados de vez após ${config.retention_days} dias` : 'Limpeza automática desativada'}
      />
      <div className="adm-body">
        <div>
          <div className="adm-tools">
            <FilterSearchInput
              value={search}
              onChange={v => { setSearch(v); setPage(1) }}
              placeholder="Buscar por número ou título..."
              width={280}
            />

            <div style={{ position: 'relative' }}>
              <FilterButton
                activeCount={activeFilterCount}
                activeSavedFilter={activeSavedFilter}
                onOpen={() => setFilterOpen(v => !v)}
                onClearSaved={() => {
                  setActiveSavedFilter(null)
                  handleClear()
                }}
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
                <FilterField label="Empresa">
                  <FilterSelect value={orgId} onChange={v => { setOrgId(v); setPage(1) }}>
                    <option value="all">Todas as empresas</option>
                    {orgs.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </FilterSelect>
                </FilterField>
              </FilterDropdown>
            </div>
            <div className="push">
              <Pagination
                variant="toolbar"
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={s => { setPageSize(s); setPage(1) }}
                label="chamados"
              />
            </div>
          </div>
          {loading && rows.length === 0 ? <Loading /> : (
            <div className="adm-scroll">
              <table className="table" style={{ minWidth: 900 }}>
                <thead><tr>{['Chamado', 'Título', 'Empresa', 'Excluído por', 'Excluído em', 'Apagado de vez', 'Ações'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--text-3)' }}>Lixeira vazia</td></tr>}
                  {rows.map(t => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{t.displayNumber}</td>
                      <td style={{ maxWidth: 260, overflow: 'hidden' }}><TruncatedText text={t.title} style={{ display: 'block' }} /></td>
                      <td>{t.org?.name ?? '—'}</td>
                      <td>{t.deletedBy?.name ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(t.deletedAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }} title={t.purgeAt ? fmt(t.purgeAt) : undefined}>
                        {t.purgeAt ? `em ${daysLeft(t.purgeAt)} dia(s)` : 'Nunca (limpeza desativada)'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div className="adm-actions" style={{ justifyContent: 'flex-start', marginLeft: -10 }}>
                          <Btn variant="ghost" size="xs" onClick={() => restore(t)}>Restaurar</Btn>
                          <Btn variant="ghost" size="xs" style={{ color: 'var(--danger)' }} onClick={() => purge(t)}>Excluir definitivamente</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {isAdmin && config && (
          <Card className="adm-section">
            <h2 className="adm-h">Retenção</h2>
            <SettingRow label="Limpeza automática" help={config.enabled
              ? `Exclusão permanente configurada para ${config.retention_days} dias após descarte.`
              : 'Limpeza automática desativada. Chamados na lixeira são mantidos por tempo indeterminado.'}>
              <Toggle value={config.enabled} onChange={() => saveConfig({ enabled: !config.enabled })} label="Limpeza automática" />
            </SettingRow>
            <SettingRow label="Excluir definitivamente após:" htmlFor="trash-days">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Inp id="trash-days" type="number" min={1} max={3650} value={days} disabled={!config.enabled} onChange={e => setDays(e.target.value)} style={{ width: 96 }} />
                <span>dias</span>
                <Btn variant="secondary" disabled={!config.enabled || !daysValid || daysNum === config.retention_days} onClick={() => saveConfig({ retention_days: daysNum })}>Salvar</Btn>
              </div>
              {!daysValid && <p role="alert" className="adm-error">Informe um prazo válido de 1 a 3650 dias.</p>}
            </SettingRow>
          </Card>
        )}
      </div>
    </div>
  )
}
