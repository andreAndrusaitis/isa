/**
 * Barra de filtros da lista de chamados da equipe (busca, filtros, salvos e
 * paginação). Diferenças por perfil preservadas: o analista tem "Ativos" e
 * ordena por urgência primeiro; a gestão tem Fila e "SLA vencido", ordena por
 * SLA primeiro.
 */
import { SKADI_NAME } from '@/utils/skadi'
import { Pagination } from '@/components/ui'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect } from '@/components/filters/FilterSelect'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { TicketOwnerFilters } from '@/components/filters/TicketOwnerFilters'
import { PROFILES, type TicketFilters } from './useTicketFilters'

interface PageControls { page: number; pageSize: number; total: number; setPage: (p: number) => void; setPageSize: (s: number) => void }

export function TicketFilterBar({ filters: f, categories, orgs, users, me, queues, page }: {
  filters: TicketFilters
  categories: { id: string; name: string }[]
  orgs: any[]
  users: any[]
  me: any
  queues: { id: string; name: string }[]
  page: PageControls
}) {
  const agent = f.profile === 'agent'
  const changed: [string, boolean][] = [
    ['situação', f.fStatus !== PROFILES[f.profile].defaults.fStatus], ['prioridade', f.fPriority !== 'all'], ['tipo', f.fType !== 'all'],
    ['categoria', f.fCategory !== 'all'], ['empresa', f.fOrg !== 'all'], ['fila', f.fQueue !== 'all'], ['responsável', f.fAgent !== 'all'],
    ['período', !!(f.dateFrom || f.dateTo)], ['prazo vencido', f.fOverdue], ['ordem', f.sortBy !== PROFILES[f.profile].defaults.sortBy],
  ]
  const activeLabels = changed.flatMap(([name, on]) => on ? [name] : [])

  return (
    <div className="filter-bar">
      <FilterSearchInput value={f.search} onChange={f.setSearch} placeholder="Buscar..." {...(agent ? {} : { width: 200 })} />

      {/* Filter button + dropdown */}
      <div style={{ position: 'relative' }}>
        <FilterButton
          activeCount={f.activeFilterCount}
          activeSavedFilter={f.activeSavedFilter}
          activeLabels={activeLabels}
          onOpen={() => f.setFilterOpen(v => !v)}
          onClearSaved={() => { f.setActiveSavedFilter(null); f.handleClear() }}
          isOpen={f.filterOpen}
        />
        <FilterDropdown
          isOpen={f.filterOpen}
          onClose={() => f.setFilterOpen(false)}
          savedFilters={f.savedFilters}
          onSelectSaved={f.handleSelectSaved}
          onSaveNew={f.handleSaveFilter}
          onDeleteSaved={f.handleDeleteSaved}
          onApply={() => {}}
          onClear={f.handleClear}
          dateFrom={f.dateFrom}
          dateTo={f.dateTo}
          onDateFromChange={f.setDateFrom}
          onDateToChange={f.setDateTo}
          showDateFilter={true}
        >
          <FilterField label="Status">
            {agent ? (
              <FilterSelect value={f.fStatus} onChange={v => f.setFStatus(v)} exclusive={['all', 'active']}>
                <option value="active">Ativos (abertos + atend.)</option>
                <option value="all">Todos</option>
                <option value="open">Aberto</option>
                <option value="in_progress">Em atendimento</option>
                <option value="pending">Pendente</option>
                <option value="resolved">Resolvido</option>
                <option value="closed">Fechado</option>
              </FilterSelect>
            ) : (
              <FilterSelect value={f.fStatus} onChange={v => f.setFStatus(v)}>
                <option value="all">Todos</option>
                <option value="open">Aberto</option>
                <option value="in_progress">Em atendimento</option>
                <option value="pending">Pendente</option>
                <option value="resolved">Resolvido</option>
                <option value="closed">Fechado</option>
                <option value="ai_resolved">Resolvido pela {SKADI_NAME}</option>
                <option value="team_resolved">Resolvido pela equipe</option>
                <option value="team_closed">Fechado pela equipe</option>
              </FilterSelect>
            )}
          </FilterField>
          <FilterField label="Prioridade">
            <FilterSelect value={f.fPriority} onChange={v => f.setFPriority(v)}>
              <option value="all">Todas</option>
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </FilterSelect>
          </FilterField>
          <FilterField label="Tipo">
            <FilterSelect value={f.fType} onChange={v => f.setFType(v)}>
              <option value="all">Todos</option>
              <option value="incident">Incidente</option>
              <option value="request">Requisição</option>
              <option value="problem">Problema</option>
              <option value="change">Mudança</option>
            </FilterSelect>
          </FilterField>
          {!agent && (
            <FilterField label="Fila">
              <FilterSelect value={f.fQueue} onChange={v => f.setFQueue(v)}>
                <option value="all">Todas</option>
                {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
              </FilterSelect>
            </FilterField>
          )}
          <FilterField label="Categoria">
            <FilterSelect value={f.fCategory} onChange={v => f.setFCategory(v)}>
              <option value="all">Todas</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FilterSelect>
          </FilterField>
          <TicketOwnerFilters
            orgs={orgs}
            users={users}
            me={me}
            org={f.fOrg}
            onOrgChange={f.setFOrg}
            assignee={f.fAgent}
            onAssigneeChange={f.setFAgent}
          />
          <FilterField label="Ordenar por">
            <FilterSelect single value={f.sortBy} onChange={v => f.setSortBy(v)}>
              {agent ? (
                <>
                  <option value="urgency">Urgência</option>
                  <option value="sla">SLA ↑</option>
                </>
              ) : (
                <>
                  <option value="sla">SLA ↑</option>
                  <option value="urgency">Urgência</option>
                </>
              )}
              <option value="priority">Prioridade</option>
              <option value="date">Mais recente</option>
            </FilterSelect>
          </FilterField>
          {!agent && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={f.fOverdue} onChange={e => f.setFOverdue(e.target.checked)} />
              SLA vencido
            </label>
          )}
        </FilterDropdown>
      </div>

      <div style={{ marginLeft: 'auto' }}>
        <Pagination
          variant="toolbar"
          page={page.page}
          pageSize={page.pageSize}
          total={page.total}
          onPageChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      </div>
    </div>
  )
}
