import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import type { Tag } from '@/types/projects'
import { ColorDot } from '@/components/ui'
import { PROJECT_COLORS } from './ProjectColorPicker'
import './projects.css'

const TAG_COLORS = PROJECT_COLORS.map((c) => c.value)

/** Tag em texto, com um quadradinho na cor dela. */
export function TagChip({ tag, onRemove }: { tag: Pick<Tag, 'id' | 'name' | 'color'>; onRemove?: () => void }) {
  return (
    <span title={tag.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: 200, minWidth: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-1)' }}>
      <ColorDot color={tag.color || 'var(--text-3)'} />
      <span className="pj-cut">{tag.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remover tag ${tag.name}`} className="icon-act" style={{ width: 24, height: 24, marginLeft: -4, flexShrink: 0 }}>
          <X size={12} />
        </button>
      )}
    </span>
  )
}

/**
 * Seletor de tags em popover: busca, lista com marcação (clique adiciona/remove)
 * e "Criar tag" com escolha de cor. Teclado: ↑/↓ navega, Enter aplica, Esc fecha.
 */
export function TagPicker({ projectTags, selectedIds, onToggle, onCreate }: {
  projectTags: Tag[]
  selectedIds: string[]
  onToggle: (tagId: string, selected: boolean) => void
  onCreate: (name: string, color: string) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [newColor, setNewColor] = useState(TAG_COLORS[projectTags.length % TAG_COLORS.length])
  const rootRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => projectTags.filter((t) => t.name.toLowerCase().includes(q)), [projectTags, q])
  const canCreate = q.length > 0 && !projectTags.some((t) => t.name.toLowerCase() === q)
  const options = canCreate ? filtered.length + 1 : filtered.length

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    // Esc fecha só o seletor: captura na window antes do ouvinte do drawer/modal.
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onEsc, true)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onEsc, true) }
  }, [open])

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => { if (open) setNewColor(TAG_COLORS[projectTags.length % TAG_COLORS.length]) }, [open, projectTags.length])

  function close() { setOpen(false); setQuery('') }

  async function choose(index: number) {
    if (index < filtered.length) {
      const tag = filtered[index]
      onToggle(tag.id, !selectedIds.includes(tag.id))
    } else if (canCreate) {
      await onCreate(query.trim(), newColor)
      setQuery('')
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && options > 0) { e.preventDefault(); choose(active) }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title="Adicionar tag"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="pj-link"
        style={{ minHeight: 28 }}
      >
        Adicionar tag
      </button>

      {open && (
        <div className="pj-pop" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30, width: 250 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <Search size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Buscar ou criar tag…"
              aria-label="Buscar ou criar tag"
              maxLength={40}
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-1)', fontSize: 13 }}
            />
          </div>

          <div role="listbox" aria-label="Tags do projeto" aria-multiselectable="true" style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 0' }}>
            {filtered.length === 0 && !canCreate && (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-3)' }}>Nenhuma tag no projeto ainda. Digite um nome para criar.</div>
            )}
            {filtered.map((tag, i) => {
              const selected = selectedIds.includes(tag.id)
              return (
                <div
                  key={tag.id}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className="pj-opt"
                  data-active={active === i}
                >
                  <TagChip tag={tag} />
                  <span style={{ flex: 1 }} />
                  {selected && <Check size={14} style={{ color: 'var(--accent)' }} aria-hidden="true" />}
                </div>
              )
            })}
            {canCreate && (
              <div
                role="option"
                aria-selected={false}
                onMouseEnter={() => setActive(filtered.length)}
                onClick={() => choose(filtered.length)}
                className="pj-opt"
                data-active={active === filtered.length}
              >
                Criar <TagChip tag={{ id: 'new', name: query.trim(), color: newColor }} />
              </div>
            )}
          </div>

          {canCreate && (
            <div className="sw" style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  aria-pressed={newColor === c}
                  onClick={() => setNewColor(c)}
                  data-on={newColor === c}
                  style={{ width: 24, height: 24, background: c }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
