import { useMemo, useState } from 'react'
import { ChartTooltip, TipRow, TipTitle, visuallyHidden } from './ChartTooltip'
import { useElementWidth } from './useElementWidth'
import './charts.css'

/**
 * Matriz linhas × colunas (ex.: dia da semana × hora) em círculos que crescem com o valor. Hover
 * ou foco realça a linha e a coluna nos rótulos e abre o tooltip; o pico muda de cor. A grade ocupa a largura toda.
 */
export function HeatmapGrid({ rows, cols, values, color = 'var(--accent)', unit = 'chamado', unitPlural = 'chamados', colLabelEvery = 3, tooltipTitle, ariaLabel }: {
  rows: string[]
  cols: string[]
  values: number[][]
  color?: string
  unit?: string
  unitPlural?: string
  colLabelEvery?: number
  tooltipTitle?: (row: number, col: number) => string
  ariaLabel: string
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  const LABEL_W = 40, TOP = 22, CELL_H = 30
  const cellW = Math.max(8, (width - LABEL_W) / cols.length)
  const height = TOP + rows.length * CELL_H
  const dot = Math.min(cellW, CELL_H) / 2 - 1

  const { max, peak } = useMemo(() => {
    let max = 0, peak = { r: -1, c: -1 }
    values.forEach((row, r) => row.forEach((v, c) => { if (v > max) { max = v; peak = { r, c } } }))
    return { max, peak }
  }, [values])
  const level = (v: number) => (v === 0 || !max ? 0 : Math.min(4, Math.ceil((v / max) * 4)))
  const xOf = (c: number) => LABEL_W + c * cellW
  const yOf = (r: number) => TOP + r * CELL_H
  const fmt = (v: number) => `${v.toLocaleString('pt-BR')} ${v === 1 ? unit : unitPlural}`

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        {cols.map((c, i) => (i % colLabelEvery === 0 || hover?.c === i) && (
          <text key={c} x={xOf(i) + cellW / 2} y={12} textAnchor="middle" fontSize={11.5} fontWeight={hover?.c === i ? 600 : 400} fill={hover?.c === i ? 'var(--text-1)' : 'var(--text-3)'}>{c}</text>
        ))}
        {rows.map((r, i) => (
          <text key={r} x={0} y={yOf(i) + CELL_H / 2} dy="0.32em" fontSize={12} fontWeight={hover?.r === i ? 600 : 400} fill={hover?.r === i ? 'var(--text-1)' : 'var(--text-3)'}>{r}</text>
        ))}
        {values.map((row, r) => row.map((v, c) => {
          const lv = level(v)
          const active = hover?.r === r && hover?.c === c
          const isPeak = peak.r === r && peak.c === c && max > 0
          return (
            <circle key={`${r}-${c}`} cx={xOf(c) + cellW / 2} cy={yOf(r) + CELL_H / 2} r={lv ? (0.36 + 0.64 * Math.sqrt(v / max)) * dot : 2.5}
              fill={isPeak ? 'var(--text-1)' : lv ? color : 'var(--border-strong)'} fillOpacity={isPeak ? 1 : lv ? 0.45 + 0.55 * (v / max) : 1}
              stroke={active ? 'var(--text-1)' : 'none'} strokeWidth={2}
              opacity={hover && hover.r !== r && hover.c !== c ? 0.55 : 1}
              tabIndex={c === 0 ? 0 : -1} className="isa-chart-focus"
              onMouseEnter={() => setHover({ r, c })} onFocus={() => setHover({ r, c })}
              onKeyDown={(e) => {
                const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key]
                if (!d) return
                e.preventDefault()
                const nr = Math.max(0, Math.min(rows.length - 1, r + d[0])), nc = Math.max(0, Math.min(cols.length - 1, c + d[1]))
                ;((e.currentTarget.parentNode as SVGElement).querySelector(`[data-cell="${nr}-${nc}"]`) as SVGCircleElement | null)?.focus()
              }}
              data-cell={`${r}-${c}`}
              style={{ transition: 'opacity .12s, fill-opacity .3s', outline: 'none' }}
            />
          )
        }))}
      </svg>
      <div aria-hidden style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
        <span style={{ marginRight: 4 }}>menos</span>
        {[5, 8, 11, 14].map((s) => <span key={s} style={{ width: s, height: s, borderRadius: '50%', background: color }} />)}
        <span style={{ marginLeft: 4 }}>mais</span>
      </div>
      <ChartTooltip anchor={hover ? { x: xOf(hover.c) + cellW, y: yOf(hover.r) + CELL_H / 2 } : null} box={{ w: width, h: height }}>
        {hover && (
          <>
            <TipTitle>{tooltipTitle ? tooltipTitle(hover.r, hover.c) : `${rows[hover.r]} · ${cols[hover.c]}`}</TipTitle>
            <TipRow color={color} label="Total" value={fmt(values[hover.r][hover.c])} />
            {max > 0 && <TipRow color="var(--text-3)" label="do pico" value={`${Math.round((values[hover.r][hover.c] / max) * 100)}%`} />}
          </>
        )}
      </ChartTooltip>
      <div style={visuallyHidden}><table>
        <caption>{ariaLabel}</caption>
        <thead><tr><th />{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r}><th>{r}</th>{values[i].map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  )
}
