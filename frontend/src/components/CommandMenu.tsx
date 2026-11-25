/**
 * Busca geral (Ctrl K): telas que a pessoa pode abrir, ajustes por palavra parecida
 * e chamados pelo número ou assunto. Setas escolhem, Enter abre.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search, Ticket as TicketIcon } from 'lucide-react'
import { StatusBadge } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { useNavStore } from '@/store/nav'
import { ticketService } from '@/services/ticketService'
import { buildMenu } from '@/access/menu'
import { searchSettings } from '@/access/settings'
import { hasAreaPermission } from '@/utils/permissions'
import type { Ticket } from '@/types'
import { pathOf } from './MainNav'

interface Entry { id: string; label: string; hint: string; icon: any; path: string; ticket?: Ticket }
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Telas do menu que casam com o texto; vazio mostra as primeiras. */
export function matchScreens(entries: Entry[], query: string, limit = 7): Entry[] {
  const terms = plain(query).split(/\s+/).filter(Boolean)
  const found = entries.filter(e => terms.every(t => plain(`${e.label} ${e.hint}`).includes(t)))
  return found.sort((a, b) => Number(plain(b.label).startsWith(terms[0] ?? '')) - Number(plain(a.label).startsWith(terms[0] ?? ''))).slice(0, limit)
}

export function CommandTrigger() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  // Documentos tem a própria busca no mesmo atalho.
  const own = pathname.startsWith('/documentos')
  useEffect(() => {
    if (own) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [own])
  return (
    <>
      <button type="button" className="cmd-trigger" onClick={() => setOpen(true)} aria-label="Buscar (Ctrl K)">
        <Search size={17} aria-hidden /><span>Buscar chamado ou tela</span><kbd>Ctrl K</kbd>
      </button>
      {open && <CommandMenu onClose={() => setOpen(false)} />}
    </>
  )
}

function CommandMenu({ onClose }: { onClose: () => void }) {
  const user = useAuthStore(s => s.user)!
  const { queues, counts } = useNavStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [at, setAt] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const screens = useMemo<Entry[]>(() => {
    let section = ''
    return buildMenu(user, { queues, counts }).flatMap(e => {
      if ('section' in e) { section = e.section; return [] }
      return [{ id: e.view, label: e.label, hint: e.group ?? section, icon: e.icon, path: pathOf(e.view) }]
    })
  }, [user, queues, counts])

  const found = useMemo(() => {
    const direct = matchScreens(screens, query)
    const extra = !query.trim() ? [] : searchSettings(query)
      .filter(s => (s.area ? hasAreaPermission(user, s.area) : user.role === 'admin') && !direct.some(d => d.id === s.view))
      .map(s => ({ id: s.view, label: s.label, hint: s.group, icon: s.icon, path: pathOf(s.view) }))
    return [...direct, ...extra].slice(0, 8)
  }, [screens, query, user])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || (user.modules?.tickets === false && user.role !== 'admin')) { setTickets([]); return }
    let alive = true
    const t = setTimeout(() => {
      ticketService.getTicketsPage({ search: q, page: 1, pageSize: 5, sort: 'date', dir: 'desc' })
        .then(r => { if (alive) setTickets(r.data) }).catch(() => { if (alive) setTickets([]) })
    }, 220)
    return () => { alive = false; clearTimeout(t) }
  }, [query, user])

  const entries: Entry[] = [
    ...tickets.map(t => ({ id: `t-${t.id}`, label: t.title, hint: t.displayNumber, icon: TicketIcon, path: `/c/${encodeURIComponent(t.id)}`, ticket: t })),
    ...found,
  ]
  useEffect(() => { setAt(0) }, [query, tickets.length])
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [at])

  const go = (e?: Entry) => { if (e) { onClose(); navigate(e.path) } }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(entries.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(entries[at]) }
  }
  const row = (e: Entry, i: number) => (
    <button key={e.id} id={`cmd-${i}`} type="button" role="option" aria-selected={i === at} className="cmd-row" onMouseMove={() => setAt(i)} onClick={() => go(e)}>
      <i aria-hidden>{e.icon && <e.icon size={17} />}</i>
      <span>{e.label}<small>{e.hint}</small></span>
      {e.ticket && <StatusBadge status={e.ticket.status} compact />}
      {i === at && <CornerDownLeft size={15} aria-hidden />}
    </button>
  )

  return (
    <div className="cmd-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Busca">
        <label className="cmd-input">
          <Search size={19} aria-hidden />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Número, assunto, tela ou ajuste" aria-label="Buscar" role="combobox" aria-expanded aria-controls="cmd-list" aria-activedescendant={entries.length ? `cmd-${at}` : undefined} />
          <kbd>Esc</kbd>
        </label>
        <div id="cmd-list" ref={listRef} className="cmd-list" role="listbox" aria-label="Resultados">
          {entries.length === 0 && <p>Nada com “{query}”.</p>}
          {tickets.length > 0 && <h3>Chamados</h3>}
          {entries.slice(0, tickets.length).map((e, i) => row(e, i))}
          {found.length > 0 && <h3>{query.trim() ? 'Telas' : 'Ir para'}</h3>}
          {found.map((e, i) => row(e, tickets.length + i))}
        </div>
      </div>
    </div>
  )
}
