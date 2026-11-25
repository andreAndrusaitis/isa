import { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useCountUp } from '@/lib/motion'

/** Bloco da página. */
export function Card({ children, style = {}, className, ...props }: { children: ReactNode; style?: CSSProperties } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `panel ${className}` : 'panel'} style={style} {...props}>{children}</div>
}

/** Número com rótulo em cima. Vários lado a lado formam uma faixa (ver `.figures`). */
export function StatCard({ label, value, sub, accent, tone, icon: Icon, onClick }: { label: ReactNode; value: number | string; sub?: ReactNode; accent?: string; tone?: 'late' | 'soon' | 'calm' | 'ok' | 'alt'; icon?: LucideIcon; onClick?: () => void }) {
  const numeric = typeof value === 'number'
  const countRef = useCountUp(numeric ? value : 0, { format: (n) => n.toLocaleString('pt-BR') })
  const body = <>
    {Icon && <span className="figure-icon" aria-hidden><Icon size={21} /></span>}
    <span className="figure-label">{label}</span>
    <span className="figure-value" style={accent ? { color: accent } : undefined}>{numeric ? <span ref={countRef} /> : value}</span>
    {sub && <span className="figure-sub">{sub}</span>}
  </>
  return onClick
    ? <button type="button" className="figure" data-tone={tone} onClick={onClick}>{body}</button>
    : <div className="figure" data-tone={tone}>{body}</div>
}

/** Faixa de números em blocos. */
export function Figures({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="figures" style={style}>{children}</div>
}

/** Barra fina de proporção. */
export function Meter({ value, max = 100, tone = 'var(--accent)', label }: { value: number; max?: number; tone?: string; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return <span className="meter" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}><span style={{ width: `${pct}%`, background: tone }} /></span>
}
