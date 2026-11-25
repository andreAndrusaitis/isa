import { ReactNode } from 'react'
import { Menu, X } from 'lucide-react'

export { NavItem, NavSection } from './NavItem'

// ── MobileMenuButton ──────────────────────────────────────────────────────────
export function MobileMenuButton({ onClick, isOpen }: { onClick: () => void; isOpen?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mobile-menu-btn"
      aria-label={isOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
      title="Menu de navegação"
    >
      {isOpen ? <X size={18} /> : <Menu size={18} />}
    </button>
  )
}

// ── PageHeader ────────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head" style={{ padding: '26px var(--page-gutter) 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, flexShrink: 0 }}>
      <div style={{ minWidth: 0, flex: '1 1 200px' }}>
        <h1 style={{ color: 'var(--text-1)', fontSize: 'clamp(23px, 2.1vw, 28px)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.025em', margin: 0, wordBreak: 'break-word' }}>{title}</h1>
        {subtitle && <div style={{ color: 'var(--text-3)', fontSize: 14.5, marginTop: 6, wordBreak: 'break-word' }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  )
}
