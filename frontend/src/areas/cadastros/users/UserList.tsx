import { useState, useEffect } from 'react'
import { Avatar, Btn, PageHeader, EmptyState, SortHeader, SearchableSelect, Pagination } from '@/components/ui'
import { toggleCsv } from '@/components/ui/SearchableSelect'
import { TextFilter } from '../Blocks'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterSelect, matchesFilter } from '@/components/filters/FilterSelect'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { FilterField } from '@/components/filters/FilterField'
import {
  getSavedFilters,
  saveFilter,
  deleteFilter,
  countActiveFilters,
  type SavedFilter,
} from '@/utils/filterStorage'
import { useAuthStore } from '@/store/auth'
import { hasAreaPermission } from '@/utils/permissions'
import { useTableSort } from '@/hooks/useTableSort'

interface UserListProps {
  users: any[]
  orgs: any[]
  selectedUser: any | null
  onSelectUser: (user: any) => void
  onOpenNew: () => void
  currentUserRole: string
}

export function UserList({
  users,
  orgs,
  selectedUser,
  onSelectUser,
  onOpenNew,
  currentUserRole,
}: UserListProps) {
  const colSort = useTableSort<string>()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [orgFilter, setOrgFilter] = useState('all')
  const [authFilter, setAuthFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('users'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const roleLabel: Record<string, string> = {
    admin: 'Administrador',
    manager: 'Gerente',
    supervisor: 'Ticket Manager',
    agent: 'Analista',
    user: 'Usuário final',
  }

  const allRoleOptions = [
    { value: 'admin', label: 'Administradores' },
    { value: 'manager', label: 'Gerentes' },
    { value: 'supervisor', label: 'Ticket Managers' },
    { value: 'agent', label: 'Analistas' },
    { value: 'user', label: 'Usuários' },
  ]

  const currentUser = useAuthStore((s) => s.user)
  const hasUsersPerm = hasAreaPermission(currentUser, 'users')

  const visibleByRole: Record<string, string[]> = {
    admin: ['admin', 'manager', 'supervisor', 'agent', 'user'],
    manager: ['supervisor', 'agent', 'user'],
    supervisor: ['agent', 'user'],
    agent: ['agent', 'user'],
    user: ['user'],
  }

  const visibleRoleValues = currentUserRole === 'admin'
    ? ['admin', 'manager', 'supervisor', 'agent', 'user']
    : (hasUsersPerm ? ['manager', 'supervisor', 'agent', 'user'] : (visibleByRole[currentUserRole || ''] ?? ['user']))
  const roleOptions = allRoleOptions.filter((option) => visibleRoleValues.includes(option.value))

  const creatableByRole: Record<string, string[]> = {
    admin: ['admin', 'manager', 'supervisor', 'agent', 'user'],
    manager: ['supervisor', 'agent', 'user'],
    supervisor: ['agent', 'user'],
    agent: ['user'],
  }
  const creatableRoles = currentUserRole === 'admin'
    ? ['admin', 'manager', 'supervisor', 'agent', 'user']
    : (hasUsersPerm ? ['manager', 'supervisor', 'agent', 'user'] : (creatableByRole[currentUserRole || ''] ?? []))
  const canCreate = creatableRoles.length > 0

  const getOrg = (id: string) => orgs.find((o) => o.id === id)

  const listed = users.filter((u) => currentUserRole === 'admin' || u.role !== 'admin')
  const filtered = listed.filter((u) => {
    const userAuth = u.authProvider || u.auth_provider || 'local'
    return (
      matchesFilter(roleFilter, u.role) &&
      matchesFilter(orgFilter, u.orgId || u.org_id) &&
      matchesFilter(authFilter, userAuth) &&
      (u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()))
    )
  })

  useEffect(() => {
    setPage(1)
  }, [search, roleFilter, orgFilter, authFilter])

  const totalUsers = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize))
  const currentPage = Math.min(page, totalPages)

  const USERS_DEFAULTS = { orgFilter: 'all', authFilter: 'all' }
  const activeFilterCount = countActiveFilters({ orgFilter, authFilter }, USERS_DEFAULTS)

  const handleClear = () => {
    setSearch('')
    setRoleFilter('all')
    setOrgFilter('all')
    setAuthFilter('all')
    setActiveSavedFilter(null)
    setPage(1)
  }

  const handleSelectSaved = (sf: SavedFilter) => {
    const f = sf.filters
    if (f.search !== undefined) setSearch(f.search as string)
    if (f.roleFilter !== undefined) setRoleFilter(f.roleFilter as string)
    if (f.orgFilter !== undefined) setOrgFilter(f.orgFilter as string)
    if (f.authFilter !== undefined) setAuthFilter(f.authFilter as string)
    setActiveSavedFilter(sf)
    setPage(1)
  }

  const handleSaveFilter = (name: string) => {
    const sf: SavedFilter = {
      id: crypto.randomUUID(),
      name,
      filters: { search, roleFilter, orgFilter, authFilter },
    }
    saveFilter('users', sf)
    setSavedFilters(getSavedFilters('users'))
  }

  const handleDeleteSaved = (id: string) => {
    deleteFilter('users', id)
    setSavedFilters(getSavedFilters('users'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  const rows = colSort
    .apply(filtered, {
      Usuário: (u) => u.name,
      Perfil: (u) => roleLabel[u.role],
      Empresa: (u) => getOrg(u.org_id || u.orgId)?.name,
      Entrada: (u) => u.authProvider || u.auth_provider || 'local',
    })
    .slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="cad-page" hidden={!!selectedUser}>
      <PageHeader
        title="Usuários"
        subtitle={`${users.length} usuário${users.length === 1 ? '' : 's'} no sistema`}
        actions={canCreate ? <Btn onClick={onOpenNew}>Novo usuário</Btn> : undefined}
      />

      <div className="cad-filters">
        <TextFilter
          label="Perfil"
          value={roleFilter}
          options={[
            { value: 'all', label: 'Todos', count: listed.length },
            ...roleOptions
              .map((o) => ({ ...o, count: listed.filter((u) => u.role === o.value).length }))
              .filter((o) => o.count > 0),
          ]}
          onPick={(v) => setRoleFilter(toggleCsv(roleFilter, v, ['all'], 'all'))}
        />
        <FilterSearchInput value={search} onChange={setSearch} placeholder="Nome ou e-mail" />
        <div style={{ position: 'relative' }}>
          <FilterButton
            activeCount={activeFilterCount}
            activeSavedFilter={activeSavedFilter}
            onOpen={() => setFilterOpen((v) => !v)}
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
            <FilterField label="Método de login">
              <FilterSelect value={authFilter} onChange={(v) => setAuthFilter(v)}>
                <option value="all">Todos os métodos</option>
                <option value="local">Senha local</option>
                <option value="microsoft">Microsoft</option>
              </FilterSelect>
            </FilterField>
            <FilterField label="Empresa">
              <SearchableSelect
                compact
                multiple
                value={orgFilter}
                onChange={(v) => setOrgFilter(v)}
                placeholder="Todas as empresas"
                searchPlaceholder="Buscar empresa..."
                options={[
                  { value: 'all', label: 'Todas as empresas' },
                  ...orgs.map((o) => ({ value: o.id, label: o.name })),
                ]}
              />
            </FilterField>
          </FilterDropdown>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Nenhum usuário encontrado" desc="Tente outro filtro ou termo de busca." />
      ) : (
        <div className="cad-body">
          <div className="cad-scroll">
            <table className="table">
              <thead>
                <tr>
                  {['Usuário', 'Perfil', 'Empresa', 'Entrada'].map((h) => (
                    <th key={h} className={h === 'Empresa' || h === 'Entrada' ? 'cad-wide' : undefined}>
                      <SortHeader label={h} {...colSort.header(h)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} data-open onClick={() => onSelectUser(u)}>
                    <td>
                      <div className="who-cell">
                        <span aria-hidden><Avatar name={u.name} src={u.avatar} size={38} /></span>
                        <div>
                          <button type="button" className="cad-main">{u.name}</button>
                          <span className="cad-sub">{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {roleLabel[u.role] || u.role}
                      {u.active === false
                        ? <span className="cad-sub" style={{ color: 'var(--danger)' }}>Inativo</span>
                        : u.position && <span className="cad-sub">{u.position}</span>}
                    </td>
                    <td className="cad-wide">{getOrg(u.org_id || u.orgId)?.name || '—'}</td>
                    <td className="cad-wide" style={{ color: 'var(--text-2)' }}>{(u.authProvider || u.auth_provider) === 'microsoft' ? 'Microsoft' : 'Senha local'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cad-pages">
            <Pagination
              variant="toolbar"
              page={currentPage}
              pageSize={pageSize}
              total={totalUsers}
              onPageChange={setPage}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize)
                setPage(1)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
