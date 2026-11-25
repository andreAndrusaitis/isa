import { useMemo, useState } from 'react'
import { ChartTooltip, TipTitle, visuallyHidden } from './ChartTooltip'
import { longDay } from './chartUtils'
import { useElementWidth } from './useElementWidth'
import './charts.css'

const DAY = 86_400_000
const WEEKDAY_LABELS = ['', 'Seg', '', 'Qua', '', 'Sex', '']

/**
 * Mapa de calor: um quadrado por dia nas últimas `weeks` semanas, cinco
 * tons (quartis). O tamanho do quadrado acompanha a largura (cabe no celular).
 */
export function CalendarHeatmap({ days, weeks = 53, unit = 'atividade', unitPlural = 'atividades', color = 'var(--accent)', ariaLabel }: {
  days: Array<{ date: string; count: number }>
  weeks?: number
  unit?: string
  unitPlural?: string
  color?: string
  ariaLabel: string
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ key: string; count: number; x: number; y: number } | null>(null)
  const labelW = 28
  const cell = Math.max(6, Math.min(16, Math.floor((width - labelW) / weeks) - 1))
  const gap = 1
  const height = 20 + 7 * (cell + gap)

  const grid = useMemo(() => {
    const counts = new Map(days.map((d) => [d.date, d.count]))
    const today = new Date()
    const todayKey = today.toLocaleDateString('en-CA')
    const end = new Date(`${todayKey}T12:00:00Z`)
    const start = new Date(end.getTime() - ((weeks - 1) * 7 + end.getUTCDay()) * DAY) // domingo de `weeks` semanas atrás
    const cells: Array<{ key: string; count: number; col: number; row: number }> = []
    for (let t = start.getTime(), i = 0; t <= end.getTime(); t += DAY, i++) {
      const key = new Date(t).toISOString().slice(0, 10)
      cells.push({ key, count: counts.get(key) ?? 0, col: Math.floor(i / 7), row: i % 7 })
    }
    const nonzero = cells.map((c) => c.count).filter(Boolean).sort((a, b) => a - b)
    const q = (p: number) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] ?? 1
    const cuts = [q(0.25), q(0.5), q(0.75)]
    const level = (n: number) => (n === 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4)
    const months = cells.filter((c) => c.row === 0 && Number(c.key.slice(8)) <= 7).map((c) => ({ col: c.col, label: new Date(`${c.key}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '') }))
    const total = cells.reduce((n, c) => n + c.count, 0)
    return { cells: cells.map((c) => ({ ...c, level: level(c.count) })), months, total }
  }, [days, weeks])

  const opacity = [0, 0.25, 0.45, 0.7, 1]
  const xOf = (col: number) => labelW + col * (cell + gap)
  const yOf = (row: number) => 18 + row * (cell + gap)

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} role="img" aria-label={`${ariaLabel}: ${grid.total} ${unitPlural} no período`} style={{ display: 'block' }}>
        {grid.months.map((m) => <text key={m.col} x={xOf(m.col)} y={10} fontSize={11.5} fill="var(--text-3)">{m.label}</text>)}
        {WEEKDAY_LABELS.map((l, r) => l && <text key={r} x={0} y={yOf(r) + cell - 1} fontSize={11} fill="var(--text-3)">{l}</text>)}
        {grid.cells.map((c) => (
          <rect key={c.key} x={xOf(c.col)} y={yOf(c.row)} width={cell} height={cell}
            fill={c.level === 0 ? 'var(--tint)' : color} fillOpacity={c.level === 0 ? 1 : opacity[c.level]}
            stroke={hover?.key === c.key ? 'var(--text-1)' : 'none'} strokeWidth={1.5}
            onPointerEnter={() => setHover({ key: c.key, count: c.count, x: xOf(c.col) + cell / 2, y: yOf(c.row) })}
            onPointerLeave={() => setHover(null)} />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: 'var(--text-3)' }}>
        <span>{grid.total.toLocaleString('pt-BR')} {grid.total === 1 ? unit : unitPlural} em {weeks} semanas</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }} aria-hidden="true">
          Menos
          {opacity.map((o, i) => <span key={i} style={{ width: 14, height: 10, background: i === 0 ? 'var(--border)' : color, opacity: i === 0 ? 0.55 : o }} />)}
          Mais
        </span>
      </div>
      <ChartTooltip anchor={hover ? { x: hover.x, y: hover.y } : null} box={{ w: width, h: height }}>
        {hover && (<><TipTitle>{longDay(hover.key)}</TipTitle><div>{hover.count} {hover.count === 1 ? unit : unitPlural}</div></>)}
      </ChartTooltip>
      <div style={visuallyHidden}>{days.filter((d) => d.count).map((d) => `${d.date}: ${d.count}`).join('; ')}</div>
    </div>
  )
}
