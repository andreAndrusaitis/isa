import { CSSProperties, ReactNode } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { SortDir } from '@/hooks/useTableSort'

// Cabeçalho de coluna clicável com setas. Herda fonte/cor/caixa do cabeçalho
// onde é colocado, então serve tanto em grids quanto em <th>.
export function SortHeader({ label, dir, onClick, style }: {
  label: ReactNode; dir: SortDir | null; onClick: () => void; style?: CSSProperties
}) {
  const active = dir !== null
  const Icon = !active ? ChevronsUpDown : dir === 1 ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={onClick}
      aria-sort={!active ? 'none' : dir === 1 ? 'ascending' : 'descending'}
      title={typeof label === 'string' ? `Ordenar por ${label}` : 'Ordenar'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none',
        cursor: 'pointer', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', textAlign: 'inherit',
        color: active ? 'var(--text-1)' : 'inherit', minWidth: 0, maxWidth: '100%',
        ...style,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <Icon size={12} style={{ flexShrink: 0, opacity: active ? 1 : 0.45 }} />
    </button>
  )
}
