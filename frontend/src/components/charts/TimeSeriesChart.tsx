import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { linear, linePath, nearestIndex, niceTicks, shortDay, longDay } from './chartUtils'
import { ChartTooltip, TipRow, TipTitle, visuallyHidden } from './ChartTooltip'
import { useElementWidth } from './useElementWidth'
import './charts.css'

export type Series = {
  key: string
  label: string
  color: string
  /** Linha ou barra. Em gráfico `stacked`, as séries 'area' se empilham com preenchimento chapado. */
  type?: 'area' | 'line' | 'bar'
  dashed?: boolean
  /** Só no tooltip (unidade diferente do eixo, ex.: contagem num gráfico de horas). */
  tooltipOnly?: boolean
}
export type Datum = { x: string } & Record<string, number | string | null>
export type ChartEvent = { x: string; label: string; detail?: string }

/**
 * Série temporal: linhas retas sem preenchimento, cruz que segue o cursor,
 * rótulo do dia no eixo, tooltip que nunca sai do gráfico, faixa de referência
 * (ex.: burndown ideal), marcadores de evento (marcos) e barras. Teclado: ← → Home End.
 */
export function TimeSeriesChart({
  data, series, height = 240, stacked = false, band, events = [], points = false,
  xLabel = shortDay, tooltipTitle = longDay, format = (v) => v.toLocaleString('pt-BR'), ariaLabel, emptyText = 'Sem dados no período.',
  onSelect, selected, selectHint,
}: {
  data: Datum[]
  series: Series[]
  height?: number
  stacked?: boolean
  band?: { lowerKey: string; upperKey: string; label: string }
  events?: ChartEvent[]
  points?: boolean
  xLabel?: (x: string) => string
  tooltipTitle?: (x: string) => string
  format?: (v: number, key: string) => string
  ariaLabel: string
  emptyText?: string
  /** Clique (ou Enter) num ponto: drill-down, ex.: listar os chamados do dia. */
  onSelect?: (index: number) => void
  /** `x` do ponto selecionado: fica marcado com uma linha na cor de destaque. */
  selected?: string
  /** Texto no rodapé do tooltip quando há `onSelect` (ex.: "Clique para ver os chamados"). */
  selectHint?: string
}) {
  const uid = useId().replace(/:/g, '')
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const M = { top: events.length ? 22 : 12, right: 12, bottom: 30, left: 40 }
  const innerW = Math.max(10, width - M.left - M.right)
  const innerH = height - M.top - M.bottom
  const n = data.length
  const num = (d: Datum, k: string) => (typeof d[k] === 'number' ? (d[k] as number) : null)

  const geo = useMemo(() => {
    const step = n ? innerW / n : innerW
    const xs = data.map((_, i) => M.left + step * (i + 0.5))
    // Pilha das áreas: cada uma começa onde a anterior terminou.
    const stackKeys = stacked ? series.filter((s) => (s.type ?? 'area') === 'area').map((s) => s.key) : []
    const base = data.map(() => 0)
    const stack = new Map<string, Array<[number, number]>>()
    for (const k of stackKeys) {
      stack.set(k, data.map((d, i) => { const y0 = base[i]; base[i] += num(d, k) ?? 0; return [y0, base[i]] }))
    }
    let max = 0
    for (const d of data) {
      for (const s of series) if (!stackKeys.includes(s.key) && !s.tooltipOnly) max = Math.max(max, num(d, s.key) ?? 0)
      if (band) max = Math.max(max, num(d, band.upperKey) ?? 0)
    }
    max = Math.max(max, ...base)
    const { max: top, ticks } = niceTicks(max)
    const y = linear(0, top, M.top + innerH, M.top)
    return { step, xs, stack, y, ticks }
  }, [data, series, stacked, band, innerW, innerH, n, M.top, M.left])

  const empty = n === 0 || data.every((d) => series.every((s) => !num(d, s.key)))
  const eventsAt = (x: string) => events.filter((e) => e.x === x)

  function onMove(e: PointerEvent<SVGRectElement>) {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
    setActive(nearestIndex(geo.xs, e.clientX - rect.left))
  }
  function onKey(e: KeyboardEvent) {
    if (!n) return
    const k = e.key
    if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'Home' || k === 'End') {
      e.preventDefault()
      setActive((cur) => k === 'Home' ? 0 : k === 'End' ? n - 1 : Math.min(n - 1, Math.max(0, (cur ?? (k === 'ArrowRight' ? -1 : n)) + (k === 'ArrowRight' ? 1 : -1))))
    } else if (k === 'Escape') setActive(null)
    else if (k === 'Enter' && active !== null && onSelect) onSelect(active)
  }

  // Marcas do eixo X: ~6 rótulos distribuídos.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 90))))
  const tickIdx = data.map((_, i) => i).filter((i) => i % every === 0)

  const linePts = (key: string) => data.flatMap((d, i) => { const v = num(d, key); return v === null ? [] : [{ x: geo.xs[i], y: geo.y(v) }] })
  const ax = active !== null ? geo.xs[active] : null

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {empty ? (
        <p className="chart-empty">{emptyText}</p>
      ) : (
        <>
          <svg width={width} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onBlur={() => setActive(null)}
            className="isa-chart-focus" style={{ display: 'block', overflow: 'visible', touchAction: 'pan-y' }}>
            <defs>
              <pattern id={`hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-3)" strokeWidth="1.2" strokeOpacity="0.45" />
              </pattern>
              <linearGradient id={`fade-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={series.find((s) => s.type === 'area')?.color} stopOpacity="0.28" />
                <stop offset="1" stopColor={series.find((s) => s.type === 'area')?.color} stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* grade horizontal + eixo Y */}
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + innerW} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--border)" />
                <text x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" fontSize={11.5} fill="var(--text-3)">{t.toLocaleString('pt-BR')}</text>
              </g>
            ))}

            {/* faixa de referência (ex.: ideal do burndown) */}
            {band && (() => {
              const up = linePts(band.upperKey), lo = linePts(band.lowerKey)
              if (up.length < 2 || lo.length < 2) return null
              const rev = [...lo].reverse()
              const d = `${linePath(up)}${linePath(rev).replace('M', 'L')}Z`
              return (
                <g className="isa-chart-fade">
                  <path d={d} fill={`url(#hatch-${uid})`} />
                  <path d={linePath(up)} fill="none" stroke="var(--text-3)" strokeDasharray="4 4" />
                  <path d={linePath(lo)} fill="none" stroke="var(--text-3)" strokeDasharray="4 4" />
                </g>
              )
            })()}

            {/* eventos (marcos): linha vertical tracejada + marcador no topo */}
            {events.map((ev, i) => {
              const idx = data.findIndex((d) => d.x === ev.x)
              if (idx < 0) return null
              return (
                <g key={`${ev.x}-${i}`} className="isa-chart-fade">
                  <line x1={geo.xs[idx]} x2={geo.xs[idx]} y1={M.top - 8} y2={M.top + innerH} stroke="var(--text-3)" strokeDasharray="3 4" strokeOpacity={0.6} />
                  <rect x={geo.xs[idx] - 4} y={M.top - 14} width={8} height={8} fill="var(--text-1)" />
                </g>
              )
            })}

            {/* barras */}
            {series.filter((s) => s.type === 'bar' && !s.tooltipOnly).map((s) => (
              <g key={s.key}>
                {data.map((d, i) => {
                  const v = num(d, s.key)
                  if (!v) return null
                  const bw = Math.max(2, Math.min(30, geo.step * 0.55))
                  return (
                    <rect key={i} className="isa-chart-grow" x={geo.xs[i] - bw / 2} y={geo.y(v)} width={bw} height={M.top + innerH - geo.y(v)} rx={Math.min(6, bw / 2)}
                      fill={s.color} opacity={active === null || active === i ? 1 : 0.4} style={{ animationDelay: `${Math.min(i * 12, 500)}ms`, transition: 'opacity .15s' }} />
                  )
                })}
              </g>
            ))}

            {/* linhas (e faixas empilhadas) */}
            {series.filter((s) => s.type !== 'bar' && !s.tooltipOnly).map((s) => {
              const st = geo.stack.get(s.key)
              const top = st ? data.map((_, i) => ({ x: geo.xs[i], y: geo.y(st[i][1]) })) : linePts(s.key)
              if (top.length === 0) return null
              // Área solta: preenchimento suave até a base.
              const fill = !st && s.type === 'area' && top.length > 1 ? `${linePath(top)}L${top[top.length - 1].x},${M.top + innerH}L${top[0].x},${M.top + innerH}Z` : null
              const bottom = st && data.map((_, i) => ({ x: geo.xs[i], y: geo.y(st[i][0]) })).reverse()
              return (
                <g key={s.key}>
                  {fill && <path className="isa-chart-fade" d={fill} fill={`url(#fade-${uid})`} style={{ color: s.color }} />}
                  {bottom && <path className="isa-chart-fade" d={`${linePath(top)}${linePath(bottom).replace('M', 'L')}Z`} fill={s.color} fillOpacity={0.18} />}
                  <path className="isa-chart-draw" pathLength={s.dashed ? undefined : 1} d={linePath(top)} fill="none" stroke={s.color} strokeWidth={2.5}
                    strokeDasharray={s.dashed ? '5 5' : undefined} style={s.dashed ? { animation: 'none', strokeDashoffset: 0 } : undefined} strokeLinejoin="round" strokeLinecap="round" />
                  {points && top.map((p, i) => <circle key={i} className="isa-chart-fade" cx={p.x} cy={p.y} r={4} fill={s.color} />)}
                </g>
              )
            })}

            {/* ponto selecionado (drill-down aberto) */}
            {selected !== undefined && (() => {
              const si = data.findIndex((d) => d.x === selected)
              return si < 0 ? null : <line x1={geo.xs[si]} x2={geo.xs[si]} y1={M.top} y2={M.top + innerH} stroke="var(--accent)" strokeWidth={2} opacity={0.7} pointerEvents="none" />
            })()}

            {/* cruz + pontos ativos */}
            {ax !== null && active !== null && (
              <g pointerEvents="none">
                <line x1={ax} x2={ax} y1={M.top} y2={M.top + innerH} stroke="var(--text-2)" strokeWidth={1} />
                {series.filter((s) => s.type !== 'bar' && !s.tooltipOnly).map((s) => {
                  const st = geo.stack.get(s.key)
                  const v = st ? st[active][1] : num(data[active], s.key)
                  if (v === null) return null
                  return <circle key={s.key} cx={ax} cy={geo.y(v)} r={5} fill={s.color} stroke="var(--bg-card)" strokeWidth={2} />
                })}
              </g>
            )}

            {/* eixo X */}
            {tickIdx.map((i) => (
              <text key={i} x={geo.xs[i]} y={height - 8} textAnchor="middle" fontSize={11.5} fill="var(--text-3)" opacity={active === null ? 1 : Math.abs(i - active) * geo.step < 46 ? 0 : 1} style={{ transition: 'opacity .12s' }}>
                {xLabel(String(data[i].x))}
              </text>
            ))}

            {/* captura do ponteiro (mouse e toque) */}
            <rect x={M.left} y={0} width={innerW} height={height - M.bottom + 4} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setActive(null)}
              onClick={onSelect ? () => { if (active !== null) onSelect(active) } : undefined} style={{ cursor: onSelect ? 'pointer' : undefined }} />
          </svg>

          {/* rótulo do dia sobre o eixo X */}
          {ax !== null && active !== null && (
            <div className="isa-chart-tip" style={{
              position: 'absolute', top: height - 24, left: Math.max(0, Math.min(width - 80, ax - 40)), width: 80, textAlign: 'center',
              padding: '3px 0', fontSize: 12, fontWeight: 600, background: 'var(--text-1)', color: 'var(--bg-card)',
            }}>{xLabel(String(data[active].x))}</div>
          )}

          <ChartTooltip anchor={ax !== null ? { x: ax, y: M.top + innerH / 2 } : null} box={{ w: width, h: height - M.bottom }}>
            {active !== null && (
              <>
                <TipTitle>{tooltipTitle(String(data[active].x))}</TipTitle>
                {series.map((s) => {
                  const v = num(data[active], s.key)
                  return v === null ? null : <TipRow key={s.key} color={s.color} label={s.label} value={format(v, s.key)} />
                })}
                {band && num(data[active], band.lowerKey) !== null && (
                  <TipRow color="var(--text-3)" label={band.label} value={`${format(num(data[active], band.lowerKey)!, band.lowerKey)}–${format(num(data[active], band.upperKey)!, band.upperKey)}`} />
                )}
                {onSelect && selectHint && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-3)' }}>{selectHint}</div>}
                {eventsAt(String(data[active].x)).map((ev, i) => (
                  <div key={i} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600 }}>{ev.label}</div>
                    {ev.detail && <div style={{ color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ev.detail}</div>}
                  </div>
                ))}
              </>
            )}
          </ChartTooltip>

          {/* mesma informação em tabela para leitor de tela */}
          <div style={visuallyHidden}><table>
            <caption>{ariaLabel}</caption>
            <thead><tr><th>Data</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
            <tbody>{data.map((d) => <tr key={String(d.x)}><td>{tooltipTitle(String(d.x))}</td>{series.map((s) => <td key={s.key}>{num(d, s.key) ?? '—'}</td>)}</tr>)}</tbody>
          </table></div>
        </>
      )}
    </div>
  )
}
