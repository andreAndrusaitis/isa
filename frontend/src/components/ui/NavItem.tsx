import { ChevronDown } from 'lucide-react'

export function NavItem({ icon: Icon, label, active, count = 0, onClick, indent = false }: {
  icon?: any; label: string; active: boolean; count?: number; onClick: () => void; indent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`nav-item${indent ? ' indent' : ''}`}
    >
      {Icon && <Icon size={16} strokeWidth={1.8} aria-hidden />}
      <span title={label}>{label}</span>
      {count > 0 && <b>{count}</b>}
    </button>
  )
}

export function NavSection({ label, open, onToggle }: { label: string; open?: boolean; onToggle?: () => void }) {
  if (!onToggle) return <div className="nav-section">{label}</div>
  return (
    <button type="button" className="nav-section" onClick={onToggle} aria-expanded={!!open}>
      <span>{label}</span>
      <ChevronDown size={13} aria-hidden style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
    </button>
  )
}
