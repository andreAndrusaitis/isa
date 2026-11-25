import { chartTone } from './chartUtils'
import './charts.css'

export type Part = { id: string; label: string; value: number; color?: string }

/** Partes de um todo numa fita única, com a legenda embaixo. Com `onSelect` cada parte vira botão. */
export function Ribbon({ parts, ariaLabel, onSelect }: { parts: Part[]; ariaLabel: string; onSelect?: (id: string) => void }) {
  const total = parts.reduce((a, p) => a + p.value, 0)
  if (!total) return <p className="chart-empty">Sem dados no período.</p>
  return (
    <div role="group" aria-label={ariaLabel}>
      <div className="ribbon" aria-hidden>
        {parts.map((p, i) => p.value > 0 && <i key={p.id} style={{ flexGrow: p.value, background: chartTone(p.color, i) }}>{p.value / total >= 0.07 ? Math.round((p.value / total) * 100) + '%' : ''}</i>)}
      </div>
      <ul className="ribbon-legend">
        {parts.map((p, i) => {
          const body = <><i style={{ background: chartTone(p.color, i) }} />{p.label}<b>{p.value.toLocaleString('pt-BR')}</b></>
          return <li key={p.id}>{onSelect ? <button type="button" onClick={() => onSelect(p.id)}>{body}</button> : <span>{body}</span>}</li>
        })}
      </ul>
    </div>
  )
}
