import { chartTone } from './chartUtils'
import type { Part } from './Ribbon'
import './charts.css'

/** Colunas largas com o valor em cima: poucas categorias em ordem. */
export function Columns({ parts, ariaLabel, height = 170 }: { parts: Part[]; ariaLabel: string; height?: number }) {
  const max = Math.max(1, ...parts.map(p => p.value))
  if (!parts.some(p => p.value > 0)) return <p className="chart-empty">Sem dados no período.</p>
  return (
    <div className="columns" role="list" aria-label={ariaLabel}>
      {parts.map((p, i) => (
        <div key={p.id} role="listitem">
          <b>{p.value.toLocaleString('pt-BR')}</b>
          <i aria-hidden style={{ height: Math.max(6, (p.value / max) * height), background: chartTone(p.color, i) }} />
          <span>{p.label}</span>
        </div>
      ))}
    </div>
  )
}
