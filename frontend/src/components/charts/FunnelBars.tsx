import { visuallyHidden } from './ChartTooltip'
import { barWidth, chartTone } from './chartUtils'
import './charts.css'

export type FunnelStep = { id: string; label: string; value: number; hint?: string; color?: string }

/** Etapas em barras sobre a 1ª: o valor, o % do início e quantos seguem da etapa anterior. */
export function FunnelBars({ steps, format = (v) => v.toLocaleString('pt-BR'), ariaLabel }: {
  steps: FunnelStep[]
  format?: (v: number) => string
  ariaLabel: string
}) {
  const first = steps[0]?.value || 0
  if (!first) return <p className="chart-empty">Sem dados no período.</p>
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

  return (
    <div className="chart">
      <div className="chart-rows">
        {steps.map((s, i) => (
          <div key={s.id} tabIndex={0} className="chart-row isa-chart-focus" title={s.hint}>
            <span>{s.label}</span>
            <span className="chart-track">
              <i aria-hidden style={{ width: barWidth(s.value / first), background: chartTone(s.color) }} />
              <b>{format(s.value)}</b>
            </span>
            <span className="chart-share">{i === 0 ? 'início' : `${pct(s.value, first)}% do início`}</span>
            {i > 0 && <small>{pct(s.value, steps[i - 1].value)}% seguem da etapa anterior</small>}
          </div>
        ))}
      </div>
      <div style={visuallyHidden}><table>
        <caption>{ariaLabel}</caption>
        <tbody>{steps.map((s) => <tr key={s.id}><th>{s.label}</th><td>{format(s.value)}</td><td>{pct(s.value, first)}% do início</td></tr>)}</tbody>
      </table></div>
    </div>
  )
}
