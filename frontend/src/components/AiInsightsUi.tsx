import type { ReactNode } from 'react'
import { Card, Meter } from '@/components/ui'
import type { AiInsights } from '@/services/aiService'

// Peças compartilhadas pelo painel do gestor (Triagem IA) e pelo Motor IA do admin.

const FIELD_LABEL: Record<string, string> = { type: 'Tipo', category: 'Categoria', subcategory: 'Subcategoria', priority: 'Prioridade' }
const fmtInt = (n: number) => n.toLocaleString('pt-BR')
const fmtPct = (r: number) => `${Math.round(r * 100)}%`

export const AI_DASHBOARD_STYLE = `
.ai-ins-kpis { display: flex; flex-wrap: wrap; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--border); }
.ai-ins-kpis > .figure { flex-basis: 160px; }
.ai-ins-kpis > .figure + .figure { padding-left: 20px; border-left: 1px solid var(--border); }
.ai-ins-two { display: grid; gap: 32px 48px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); }
.ai-ins-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-3); }
.ai-ins-field input, .ai-ins-field select { min-height: 36px; padding: 4px 8px; font-size: 13.5px; font-family: var(--font); border: 1px solid var(--field-line); background: var(--bg-input); color: var(--text-1); }
`

export function AiSection({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card style={{ padding: '16px 0 0' }}>
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: 'var(--text-1)' }}>{title}</h3>
      <p style={{ margin: '2px 0 16px', fontSize: 13, color: 'var(--text-3)' }}>{hint}</p>
      {children}
    </Card>
  )
}

/** YYYY-MM-DD no calendário de São Paulo, `daysAgo` dias atrás (é o que a API espera). */
export function spDate(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export function Kpi({ label, value, sub, alert, help }: { label: string; value: string; sub?: string; alert?: boolean; help?: string }) {
  return (
    <div className="figure">
      <span className="figure-label">{label}</span>
      <span className="figure-value">{value}</span>
      {sub && <span className="figure-sub" style={alert ? { color: 'var(--danger)' } : undefined}>{sub}</span>}
      {help && <span className="figure-sub">{help}</span>}
    </div>
  )
}

/** Acurácia por campo: barra + "acertos/total · %" em texto (a informação nunca depende só da cor). */
export function AccuracyBars({ rows }: { rows: AiInsights['accuracy'] }) {
  return (
    <ul aria-label="Acurácia por campo" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
      {rows.map(r => (
        <li key={r.field} style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, marginBottom: 6, color: 'var(--text-1)' }}>
            <span>{FIELD_LABEL[r.field] ?? r.field}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.total ? `${fmtPct(r.rate)} · ${fmtInt(r.correct)}/${fmtInt(r.total)}` : '—'}</span>
          </div>
          <Meter value={r.total ? r.rate * 100 : 0} />
        </li>
      ))}
    </ul>
  )
}
