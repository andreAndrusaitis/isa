import './filters.css'

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="filter-label">{label}</span>
      {children}
    </div>
  )
}
