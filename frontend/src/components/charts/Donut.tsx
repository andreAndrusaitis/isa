import { useState } from 'react'
import { chartTone } from './chartUtils'
import type { Part } from './Ribbon'
import './charts.css'

const R = 62, W = 20, C = 2 * Math.PI * R, GAP = 4

/** Partes de um todo em rosca, com o total no meio e a legenda ao lado. Passar o mouse destaca a fatia. */
export function Donut({ parts, ariaLabel, center = 'total', onSelect }: { parts: Part[]; ariaLabel: string; center?: string; onSelect?: (id: string) => void }) {
  const [on, setOn] = useState<string | null>(null)
  const total = parts.reduce((a, p) => a + p.value, 0)
  if (!total) return <p className="chart-empty">Sem dados no período.</p>
  const shown = parts.filter(p => p.value > 0)
  const focus = shown.find(p => p.id === on)
  let start = 0
  return (
    <div className="donut" role="group" aria-label={ariaLabel}>
      <svg viewBox="0 0 160 160" aria-hidden="true">
        {shown.map(p => {
          const len = (p.value / total) * C
          const dash = Math.max(1.5, len - (shown.length > 1 ? GAP : 0))
          const el = (
            <circle key={p.id} cx="80" cy="80" r={R} fill="none" stroke={chartTone(p.color, parts.indexOf(p))} strokeWidth={on === p.id ? W + 4 : W}
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-start} transform="rotate(-90 80 80)" opacity={on && on !== p.id ? 0.35 : 1}
              onMouseEnter={() => setOn(p.id)} onMouseLeave={() => setOn(null)} />
          )
          start += len
          return el
        })}
        <text x="80" y="82" textAnchor="middle" className="donut-n">{(focus?.value ?? total).toLocaleString('pt-BR')}</text>
        <text x="80" y="102" textAnchor="middle" className="donut-l">{focus ? `${Math.round((focus.value / total) * 100)}%` : center}</text>
      </svg>
      <ul>
        {parts.map((p, i) => {
          const body = <><i style={{ background: chartTone(p.color, i) }} /><span>{p.label}</span><b>{p.value.toLocaleString('pt-BR')}</b><em>{Math.round((p.value / total) * 100)}%</em></>
          const hover = { onMouseEnter: () => setOn(p.id), onMouseLeave: () => setOn(null) }
          return <li key={p.id}>{onSelect ? <button type="button" onClick={() => onSelect(p.id)} {...hover}>{body}</button> : <div {...hover}>{body}</div>}</li>
        })}
      </ul>
    </div>
  )
}
