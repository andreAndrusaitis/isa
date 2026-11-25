import { Meter } from '@/components/ui'
import { visuallyHidden } from './ChartTooltip'
import './charts.css'

export type RadarAxis = { id: string; label: string; value: number | null; hint?: string }

/** Percentuais (0–1) por eixo, uma barra por linha. Eixo sem dado (null) aparece como "—". */
export function AxisBars({ axes, color = 'var(--accent)', label = 'Valor', ariaLabel, format = (v) => `${Math.round(v * 100)}%` }: {
  axes: RadarAxis[]
  color?: string
  label?: string
  ariaLabel: string
  height?: number
  format?: (v: number) => string
}) {
  if (axes.length < 3) return <p className="chart-empty">Dados insuficientes.</p>
  const text = (a: RadarAxis) => (a.value === null ? '—' : format(a.value))

  return (
    <div className="chart" role="group" aria-label={ariaLabel}>
      <ul className="chart-rows">
        {axes.map((a) => (
          <li key={a.id} tabIndex={0} aria-label={`${a.label}: ${text(a)}`} title={label} className="isa-chart-focus">
            <div className="chart-row">
              <span className="chart-label">{a.label}</span>
              <Meter value={a.value ?? 0} max={1} tone={color} />
              <span className="chart-share">{text(a)}</span>
              {a.hint && <small>{a.hint}</small>}
            </div>
          </li>
        ))}
      </ul>
      <div style={visuallyHidden}><table>
        <caption>{ariaLabel}</caption>
        <tbody>{axes.map((a) => <tr key={a.id}><th>{a.label}</th><td>{text(a)}</td></tr>)}</tbody>
      </table></div>
    </div>
  )
}
