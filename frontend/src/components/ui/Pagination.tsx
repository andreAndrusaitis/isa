import { CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const PAGE_SIZES = [25, 50, 100] as const

// Números a exibir: sempre 1 e última, vizinhos da atual, "…" nos saltos.
// 1 2 3 4 5 6 7 | 1 … 4 5 6 … 20 | 1 2 3 4 5 … 20
export function pageItems(current: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const start = Math.max(2, Math.min(current - 1, totalPages - 4))
  const end = Math.min(totalPages - 1, Math.max(current + 1, 5))
  const mid = Array.from({ length: end - start + 1 }, (_, i) => start + i)
  return [1, ...(start > 2 ? ['…' as const] : []), ...mid, ...(end < totalPages - 1 ? ['…' as const] : []), totalPages]
}

const btn: CSSProperties = {
  minWidth: 28, height: 28, padding: '0 6px', border: 0, background: 'none', color: 'var(--text-2)', fontSize: 13, fontFamily: 'var(--font)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const btnSm = btn
const current: CSSProperties = { ...btn, color: 'var(--text-1)', fontWeight: 600, background: 'var(--accent-soft)' }

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  label?: string
  variant?: 'footer' | 'toolbar'
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  label = 'chamados',
  variant = 'footer',
}: PaginationProps) {
  if (total === 0) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  if (variant === 'toolbar') {
    return (
      <nav aria-label="Paginação" className="pagination-toolbar">
        <span className="pagination-toolbar-info" aria-live="polite">
          {from}–{to} de {total}
        </span>
        <span className="pagination-toolbar-sep" aria-hidden>·</span>
        <label className="pagination-toolbar-size">
          Por página
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            aria-label="Itens por página"
          >
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span className="pagination-toolbar-sep" aria-hidden>·</span>
        <div className="pagination-toolbar-pages">
          <button
            type="button"
            style={{ ...btnSm, opacity: page === 1 ? 0.4 : 1 }}
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft size={14} />
          </button>
          <div className="pagination-desktop-only" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {pageItems(page, totalPages).map((p, i) => p === '…'
              ? <span key={`gap-${i}`} style={{ padding: '0 2px', color: 'var(--text-3)' }} aria-hidden>…</span>
              : (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={`Página ${p}`}
                  style={p === page ? current : btnSm}
                >
                  {p}
                </button>
              ))}
          </div>
          <span className="pagination-mobile-only" aria-current="page">
            página {page}
          </span>
          <button
            type="button"
            style={{ ...btnSm, opacity: page === totalPages ? 0.4 : 1 }}
            disabled={page === totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Próxima página"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </nav>
    )
  }

  return (
    <nav aria-label="Paginação" style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '10px var(--page-gutter)',
      borderTop: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 12, color: 'var(--text-3)', flexShrink: 0,
      position: 'sticky', bottom: 0, left: 0, zIndex: 4,
    }}>
      <span aria-live="polite">{from}–{to} de {total} {label}</span>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        Por página
        <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
          style={{ height: 28, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font)', padding: '0 4px' }}>
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <button type="button" style={{ ...btn, opacity: page === 1 ? 0.4 : 1 }} disabled={page === 1}
            onClick={() => onPageChange(page - 1)} aria-label="Página anterior">
            <ChevronLeft size={14} />
          </button>
          {pageItems(page, totalPages).map((p, i) => p === '…'
            ? <span key={`gap-${i}`} style={{ padding: '0 2px' }} aria-hidden>…</span>
            : (
              <button key={p} type="button" onClick={() => onPageChange(p)} aria-current={p === page ? 'page' : undefined}
                aria-label={`Página ${p}`}
                style={p === page ? current : btn}>
                {p}
              </button>
            ))}
          <button type="button" style={{ ...btn, opacity: page === totalPages ? 0.4 : 1 }} disabled={page === totalPages}
            onClick={() => onPageChange(page + 1)} aria-label="Próxima página">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </nav>
  )
}
