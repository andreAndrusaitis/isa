import { Search } from 'lucide-react'
import './filters.css'

interface FilterSearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  width?: number | string
  maxLength?: number
}

export function FilterSearchInput({ value, onChange, placeholder = 'Buscar...', width = 220, maxLength = 100 }: FilterSearchInputProps) {
  return (
    <div className="filter-search" style={{ flex: `0 1 ${typeof width === 'number' ? `${width}px` : width}` }}>
      <Search size={14} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
      />
    </div>
  )
}
