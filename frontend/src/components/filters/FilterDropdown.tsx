import { useRef, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Btn } from '@/components/ui'
import type { SavedFilter } from '@/utils/filterStorage'
import './filters.css'

interface FilterDropdownProps {
  isOpen: boolean
  onClose: () => void
  savedFilters: SavedFilter[]
  onSelectSaved: (filter: SavedFilter) => void
  onSaveNew: (name: string) => void
  onDeleteSaved: (id: string) => void
  onApply: () => void
  onClear: () => void
  dateFrom: string
  dateTo: string
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  showDateFilter?: boolean
  /** Rótulo do período (padrão: data de abertura do chamado). */
  dateLabel?: string
  children: React.ReactNode
}

export function FilterDropdown({
  isOpen, onClose, savedFilters, onSelectSaved, onSaveNew, onDeleteSaved,
  onApply, onClear, dateFrom, dateTo, onDateFromChange, onDateToChange,
  showDateFilter = true, dateLabel = 'Data de abertura', children,
}: FilterDropdownProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [savingName, setSavingName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; width: number } | null>(null)

  useEffect(() => {
    if (!isOpen) { setShowSaveInput(false); setSavingName(''); return }
    function handleClick(e: MouseEvent) {
      const target = e.target as Element
      // Popovers de campos internos (SearchableSelect) são portados para o <body>;
      // clicar numa opção deles não é "fora" do filtro.
      if (target.closest?.('[data-floating-panel]')) return
      if (panelRef.current && !panelRef.current.contains(target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, onClose])

  // Anchors to the trigger's screen position (not DOM tree) since the
  // panel is portaled to <body> to escape overflow-clipping ancestors and sidebar stacking contexts.
  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) return
    const MARGIN = 8
    function reposition() {
      const rect = anchorRef.current!.getBoundingClientRect()
      const panelWidth = Math.min(340, Math.max(240, window.innerWidth * 0.9), window.innerWidth - 2 * MARGIN)
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN
      const spaceAbove = rect.top - MARGIN
      const openUp = spaceBelow < 200 && spaceAbove > spaceBelow
      const maxHeight = Math.max(150, openUp ? spaceAbove : spaceBelow)
      const left = Math.min(Math.max(rect.right - panelWidth, MARGIN), window.innerWidth - panelWidth - MARGIN)
      const top = openUp ? rect.top - MARGIN - maxHeight : rect.bottom + MARGIN
      setPos({ top, left, maxHeight, width: panelWidth })
    }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSave = () => {
    if (!savingName.trim()) return
    onSaveNew(savingName.trim())
    setSavingName('')
    setShowSaveInput(false)
  }

  return (
    <>
      <span ref={anchorRef} style={{ position: 'absolute', top: '100%', right: 0 }} />
      {pos && createPortal(
        <div ref={panelRef} className="filter-panel" style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}>
          <div className="filter-fields">
            {showDateFilter && (
              <div>
                <span className="filter-label">{dateLabel}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input aria-label="Data de" type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} />
                  <input aria-label="Data até" type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} />
                </div>
              </div>
            )}
            {children}
          </div>

          <div>
            <span className="filter-label">Filtros salvos neste navegador</span>
            {savedFilters.map((sf) => (
              <div key={sf.id} className="filter-saved" onClick={() => { onSelectSaved(sf); onClose() }}>
                <span>{sf.name}</span>
                <button type="button" className="icon-act danger" aria-label={`Excluir filtro ${sf.name}`} onClick={(e) => { e.stopPropagation(); onDeleteSaved(sf.id) }}><X size={14} /></button>
              </div>
            ))}
            {showSaveInput ? (
              <div className="filter-actions">
                <input
                  type="text"
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  placeholder="Nome do filtro..."
                  maxLength={50}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSaveInput(false) }}
                  autoFocus
                />
                <Btn size="xs" variant="ghost" onClick={handleSave}>Salvar</Btn>
              </div>
            ) : (
              <button type="button" className="filter-link" onClick={() => setShowSaveInput(true)}>+ Salvar atual</button>
            )}
          </div>

          <div className="filter-actions">
            <Btn size="sm" variant="ghost" aria-label="Limpar tudo" onClick={() => { onClear(); onClose() }}>Limpar tudo</Btn>
            <Btn size="sm" aria-label="Aplicar filtros" onClick={() => { onApply(); onClose() }}>Aplicar filtros</Btn>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
