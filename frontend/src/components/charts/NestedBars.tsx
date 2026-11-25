import { useState } from 'react'
import { visuallyHidden } from './ChartTooltip'
import { barWidth, chartTone } from './chartUtils'
import './charts.css'

export type SunNode = { id: string; label: string; value?: number; color?: string; children?: SunNode[] }

const sum = (n: SunNode): number => (n.children?.length ? n.children.reduce((a, c) => a + sum(c), 0) : n.value ?? 0)
const leaves = (n: SunNode): SunNode[] => (n.children?.length ? n.children.flatMap(leaves) : [n])

/** Partes da barra: as folhas agrupadas por tom (ex.: no prazo, SLA vencido), alerta no fim. */
function parts(n: SunNode): [string, number][] {
  const out: Record<string, number> = {}
  for (const l of leaves(n)) if (l.value) out[chartTone(l.color)] = (out[chartTone(l.color)] ?? 0) + l.value
  return Object.entries(out).sort(([a], [b]) => Number(a !== 'var(--accent)') - Number(b !== 'var(--accent)'))
}

/**
 * Hierarquia em barras (ex.: empresa → fila → SLA): uma linha por nó do nível, com a barra
 * dividida entre normal e alerta. Clicar numa linha com filhos entra nela; a trilha volta.
 */
export function NestedBars({ data, format = (v) => v.toLocaleString('pt-BR'), ariaLabel, rootLabel = 'Total' }: {
  data: SunNode[]
  size?: number
  format?: (v: number) => string
  ariaLabel: string
  rootLabel?: string
}) {
  const [path, setPath] = useState<SunNode[]>([])
  const rows = (path.length ? path[path.length - 1].children ?? [] : data).filter(sum)
  const total = rows.reduce((a, n) => a + sum(n), 0)
  const max = Math.max(1, ...rows.map(sum))
  if (!data.some(sum)) return <p className="chart-empty">Sem dados.</p>

  return (
    <div className="chart" role="group" aria-label={ariaLabel}>
      {path.length > 0 && (
        <div className="chart-crumbs">
          {[{ id: '__root', label: rootLabel } as SunNode, ...path].map((n, i, all) => (
            <span key={n.id}>{i < all.length - 1 ? <><button type="button" onClick={() => setPath(path.slice(0, i))}>{n.label}</button> ›</> : <strong>{n.label}</strong>}</span>
          ))}
        </div>
      )}
      <ul className="chart-rows">
        {rows.map((n) => {
          const v = sum(n)
          const Row = n.children?.length ? 'button' : 'div'
          return (
            <li key={n.id}>
              <Row type={n.children?.length ? 'button' : undefined} aria-label={`${n.label}: ${format(v)}`} tabIndex={0} className="chart-row isa-chart-focus"
                onClick={n.children?.length ? () => setPath([...path, n]) : undefined}>
                <span className="chart-label">{n.label}</span>
                <span className="chart-track">
                  <i aria-hidden style={{ width: barWidth(v / max) }}>{parts(n).map(([tone, value]) => <i key={tone} style={{ flex: value, background: tone }} />)}</i>
                  <b>{format(v)}</b>
                </span>
                <span className="chart-share">{Math.round((v / total) * 100)}%</span>
              </Row>
            </li>
          )
        })}
      </ul>
      <div style={visuallyHidden}><table>
        <caption>{ariaLabel}</caption>
        <tbody>{rows.flatMap((n) => [n, ...(n.children ?? [])].map((c) => <tr key={`${n.id}/${c.id}`}><th>{c === n ? n.label : `${n.label} › ${c.label}`}</th><td>{format(sum(c))}</td></tr>))}</tbody>
      </table></div>
    </div>
  )
}
