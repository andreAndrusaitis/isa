import { X } from 'lucide-react'
import type { SavedFilter } from '@/utils/filterStorage'
import './filters.css'

interface FilterButtonProps {
  activeCount: number
  activeSavedFilter: SavedFilter | null
  onOpen: () => void
  onClearSaved: () => void
  isOpen: boolean
  /** Nomes dos filtros em uso ("situação", "fila"); sem eles mostra só a quantidade. */
  activeLabels?: string[]
}

export function FilterButton({ activeCount, activeSavedFilter, onOpen, onClearSaved, isOpen, activeLabels }: FilterButtonProps) {
  return (
    <div className="filter-trigger">
      <button type="button" aria-label="Filtros" aria-expanded={isOpen} onClick={onOpen}>Filtros</button>
      {activeSavedFilter ? (
        <span>
          {activeSavedFilter.name}
          <button type="button" aria-label="Remover filtro salvo" onClick={(e) => { e.stopPropagation(); onClearSaved() }}><X size={12} /></button>
        </span>
      ) : activeCount > 0 && (
        <span>
          <span aria-label={`${activeCount} filtros ativos`}>
            {activeLabels?.length ? `Por ${activeLabels.join(', ')}` : <><b>{activeCount}</b> {activeCount === 1 ? 'ativo' : 'ativos'}</>}
          </span>
          <button type="button" onClick={onClearSaved}>limpar</button>
        </span>
      )}
    </div>
  )
}
