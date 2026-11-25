import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { adminService } from '@/services/adminService'
import { Loading } from '@/components/ui'
import './projects.css'

interface UserOption {
  id: string
  name: string
  email?: string
  avatar?: string | null
}

/**
 * Autocomplete de pessoa por nome, reusado em "Adicionar membro",
 * responsável de task e (futuramente) @menção. Busca via GET /users, já
 * escopado por organograma no backend — nunca lista quem o requester não
 * pode ver (services/users.ts:listUsers).
 */
export function UserPicker({
  onSelect, excludeIds = [], placeholder = 'Buscar por nome…',
}: {
  onSelect: (user: UserOption) => void
  excludeIds?: string[]
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // GET /users ignora o termo e devolve a lista inteira: busca uma vez e filtra aqui.
  // Lista completa em memória; mandar ?q= ao backend quando passar de alguns milhares.
  useEffect(() => {
    setLoading(true)
    adminService.getUsers().then(setUsers).catch(() => setUsers([])).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const filtered = useMemo(() => {
    const excluded = new Set(excludeIds)
    const term = query.trim().toLowerCase()
    return users
      .filter((u) => !excluded.has(u.id))
      .filter((u) => !term || u.name.toLowerCase().includes(term) || !!u.email?.toLowerCase().includes(term))
      .slice(0, 8)
  }, [users, query, excludeIds])

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 32px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--field-line)', background: 'var(--bg-input)', color: 'var(--text-1)', fontSize: 14,
          }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Limpar busca"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {open && (
        <div className="pj-pop" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 30, maxHeight: 260, overflowY: 'auto' }}>
          {loading ? (
            <Loading size="compact" label="Buscando…" />
          ) : filtered.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--text-3)' }}>Nenhuma pessoa encontrada.</div>
          ) : (
            filtered.map((user) => (
              <button
                key={user.id}
                onClick={() => { onSelect(user); setQuery(''); setOpen(false) }}
                className="pj-opt"
              >
                {user.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
