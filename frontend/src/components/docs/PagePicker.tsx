import { useEffect, useState } from 'react'
import { Inp, Loading, Modal } from '@/components/ui'
import { docsService } from '@/services/docsService'
import type { DocListItem } from '@/types/docs'

/** Busca de páginas: serve ao Ctrl+K e ao "link para página". */
export function PagePicker({ onPick, onClose, title = 'Escolher página' }: { spaceId?: string; onPick: (p: DocListItem) => void; onClose: () => void; title?: string }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<DocListItem[] | null>(null)
  const [at, setAt] = useState(0)
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      (q.trim().length >= 2 ? docsService.search(q.trim()) : docsService.recent())
        .then(r => { if (alive) { setItems(r); setAt(0) } })
        .catch(() => { if (alive) setItems([]) })
    }, q ? 220 : 0)
    return () => { alive = false; clearTimeout(t) }
  }, [q])
  return (
    <Modal isOpen onClose={onClose} title={title} width={560}>
      <Inp autoFocus value={q} placeholder="Buscar por título ou conteúdo" aria-label="Buscar página" onChange={e => setQ(e.target.value)} onKeyDown={e => {
        const n = items?.length ?? 0
        if (e.key === 'ArrowDown' && n) { e.preventDefault(); setAt(i => (i + 1) % n) }
        if (e.key === 'ArrowUp' && n) { e.preventDefault(); setAt(i => (i + n - 1) % n) }
        if (e.key === 'Enter' && items?.[at]) { e.preventDefault(); onPick(items[at]) }
      }} />
      <div className="doc-picker" role="listbox">
        {!items ? <Loading size="compact" label="Buscando…" /> : items.length === 0 ? <p>Nenhuma página encontrada.</p> : items.map((p, i) => (
          <button key={p.id} type="button" role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onClick={() => onPick(p)}>
            <span className="doc-icon">{p.icon ?? '📄'}</span>
            <span><b>{p.title}</b><small>{p.space.name}{p.snippet ? ` · ${p.snippet}` : ''}</small></span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
