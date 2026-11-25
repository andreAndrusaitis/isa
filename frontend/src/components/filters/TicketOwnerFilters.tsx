import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { FilterField } from './FilterField'
import type { Organization, User } from '@/types'

export const ASSIGNEE_ME = 'me'
export const ASSIGNEE_NONE = 'none'

/** CSV do filtro "Analista responsável" → params da listagem/contadores (o servidor soma com OR). */
export function assigneeParams(csv: string, meId: string): { assignedToId?: string; unassigned?: true } {
  const vals = csv && csv !== 'all' ? csv.split(',') : []
  const ids = vals.filter((v) => v !== ASSIGNEE_NONE).map((v) => (v === ASSIGNEE_ME ? meId : v))
  return { assignedToId: ids.length ? ids.join(',') : undefined, unassigned: vals.includes(ASSIGNEE_NONE) || undefined }
}

/**
 * Analistas que a pessoa enxerga: admin todos; Gerente/Ticket Manager a hierarquia inteira
 * abaixo dele; Analista o próprio time. Só UX — a carteira é imposta no servidor.
 */
export function visibleAssignees(users: User[], me: { id: string; role: string }): User[] {
  const staff = users.filter((u) => ['agent', 'supervisor', 'manager'].includes(u.role) && u.id !== me.id)
  if (me.role === 'admin') return staff
  if (me.role === 'agent') {
    const chief = users.find((u) => u.id === me.id)?.manager_id
    return chief ? staff.filter((u) => u.manager_id === chief) : []
  }
  const below = new Set([me.id])
  for (let grew = true; grew; ) {
    grew = false
    for (const u of staff) if (u.manager_id && below.has(u.manager_id) && !below.has(u.id)) { below.add(u.id); grew = true }
  }
  return staff.filter((u) => below.has(u.id))
}

/** Empresa + Analista responsável, iguais em todas as telas de chamados. */
export function TicketOwnerFilters({ orgs, users, me, org, onOrgChange, assignee, onAssigneeChange }: {
  orgs: Organization[]
  users: User[]
  me: { id: string; role: string }
  org: string
  onOrgChange: (v: string) => void
  assignee: string
  onAssigneeChange: (v: string) => void
}) {
  return (
    <>
      <FilterField label="Empresa">
        <SearchableSelect
          compact
          multiple
          value={org}
          onChange={onOrgChange}
          placeholder="Todas"
          searchPlaceholder="Buscar empresa..."
          options={[{ value: 'all', label: 'Todas' }, ...orgs.map((o) => ({ value: o.id, label: o.name }))]}
        />
      </FilterField>
      <FilterField label="Analista responsável">
        <SearchableSelect
          compact
          multiple
          value={assignee}
          onChange={onAssigneeChange}
          placeholder="Todos"
          searchPlaceholder="Buscar analista..."
          options={[
            { value: 'all', label: 'Todos' },
            ...(me.role === 'admin' ? [] : [{ value: ASSIGNEE_ME, label: 'Meus chamados' }]),
            { value: ASSIGNEE_NONE, label: 'Sem responsável' },
            ...visibleAssignees(users, me).map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      </FilterField>
    </>
  )
}
