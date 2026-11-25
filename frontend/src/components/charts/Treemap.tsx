import { chartTone } from './chartUtils'
import type { Part } from './Ribbon'
import './charts.css'

type Box = Part & { x: number; y: number; w: number; h: number; i: number }

/** Divide a área ao meio pelo valor, alternando pelo lado maior: blocos próximos do quadrado. */
function layout(parts: (Part & { i: number })[], x: number, y: number, w: number, h: number): Box[] {
  if (parts.length === 1) return [{ ...parts[0], x, y, w, h }]
  const total = parts.reduce((a, p) => a + p.value, 0)
  let acc = 0, cut = 0
  while (cut < parts.length - 1 && (cut === 0 || acc + parts[cut].value <= total / 2)) acc += parts[cut++].value
  const r = acc / total
  return w >= h
    ? [...layout(parts.slice(0, cut), x, y, w * r, h), ...layout(parts.slice(cut), x + w * r, y, w * (1 - r), h)]
    : [...layout(parts.slice(0, cut), x, y, w, h * r), ...layout(parts.slice(cut), x, y + h * r, w, h * (1 - r))]
}

/** Mapa de blocos: a área de cada um é o seu peso no total. */
export function Treemap({ parts, ariaLabel, height = 230 }: { parts: Part[]; ariaLabel: string; height?: number }) {
  const items = parts.filter(p => p.value > 0).sort((a, b) => b.value - a.value).map((p, i) => ({ ...p, i }))
  const total = items.reduce((a, p) => a + p.value, 0)
  if (!total) return <p className="chart-empty">Sem dados no período.</p>
  return (
    <div className="treemap" role="list" aria-label={ariaLabel} style={{ height }}>
      {layout(items, 0, 0, 4 * height, height).map(b => (
        <div key={b.id} role="listitem" title={`${b.label}: ${b.value}`} style={{ left: `${(b.x / (4 * height)) * 100}%`, top: b.y, width: `${(b.w / (4 * height)) * 100}%`, height: b.h }}>
          <div style={{ '--tone': chartTone(b.color, b.i) } as React.CSSProperties}>
            <span>{b.label}</span><b>{b.value.toLocaleString('pt-BR')}</b><small>{Math.round((b.value / total) * 100)}%</small>
          </div>
        </div>
      ))}
    </div>
  )
}
