import { useState, type ReactNode } from 'react'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { TruncatedText } from '@/components/ui'
import type { SavedFilter } from '@/utils/filterStorage'
import '../gestao.css'

/** Título da visão, com os controles à direita. */
export function DashHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="dash-head">
      <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
      {children && <div>{children}</div>}
    </div>
  )
}

/** Botão de filtros das visões do painel (sem período). */
export function DashFilters({ activeCount, saved, activeSaved, onSelect, onSave, onDelete, onClear, children }: {
  activeCount: number; saved: SavedFilter[]; activeSaved: SavedFilter | null
  onSelect: (f: SavedFilter) => void; onSave: (name: string) => void; onDelete: (id: string) => void; onClear: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <FilterButton activeCount={activeCount} activeSavedFilter={activeSaved} onOpen={() => setOpen(v => !v)} onClearSaved={onClear} isOpen={open} />
      <FilterDropdown isOpen={open} onClose={() => setOpen(false)} savedFilters={saved} onSelectSaved={onSelect} onSaveNew={onSave} onDeleteSaved={onDelete}
        onApply={() => {}} onClear={onClear} dateFrom="" dateTo="" onDateFromChange={() => {}} onDateToChange={() => {}} showDateFilter={false}>
        {children}
      </FilterDropdown>
    </div>
  )
}

/** Escolha entre períodos, no mesmo desenho das abas internas. */
export function Choice<T extends string | number>({ label, options, value, onChange }: { label: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="subtabs" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  )
}

/** Número e título do chamado, com a empresa embaixo: as duas primeiras colunas das tabelas. */
export function TicketCells({ id, title, org }: { id: ReactNode; title: string; org?: string | null }) {
  return <>
    <td className="id">{id}</td>
    <td className="main"><TruncatedText text={title} />{org && <small>{org}</small>}</td>
  </>
}

/** Linha que abre o chamado, quando a tela pode navegar. */
export const ticketLink = (id: string, onNavigate?: (a: { view: string; filters?: any }) => void) =>
  onNavigate ? { 'data-link': '', onClick: () => onNavigate({ view: 'queue_all', filters: { ticketId: id } }) } : {}

export function formatTimeRemaining(minutes: number): string {
  if (minutes <= 0) return '< 1 min'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}
