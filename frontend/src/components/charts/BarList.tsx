import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { visuallyHidden } from './ChartTooltip'
import { barWidth, chartTone } from './chartUtils'
import './charts.css'

export type BarItem = { id: string; label: string; value: number; color?: string; hint?: string; group?: string; icon?: ReactNode; /** false: com `onSelect`, esta linha não vira botão. */ selectable?: boolean }

/**
 * Barras horizontais rotuladas (ranking/distribuição). Com `onSelect` cada linha
 * vira botão (filtrar a lista, abrir o projeto…). `group` desenha um subtítulo antes da linha.
 */
export function BarList({ items, format = (v) => v.toLocaleString('pt-BR'), onSelect, showShare = false, max, ariaLabel, emptyText = 'Sem dados no período.', labelWidth = 120, extra, colorful = false }: {
  items: BarItem[]
  format?: (v: number) => string
  onSelect?: (item: BarItem) => void
  /** Mostra o % de cada linha sobre o total (distribuições). */
  showShare?: boolean
  /** Escala fixa (ex.: 100 para percentuais); padrão: maior valor. */
  max?: number
  ariaLabel: string
  emptyText?: string
  labelWidth?: number
  /** Uma cor por linha (categorias sem ordem). */
  colorful?: boolean
  /** Conteúdo extra à direita do valor (ex.: selo "Sobrecarga"). */
  extra?: (item: BarItem) => ReactNode
}) {
  if (!items.length) return <p className="chart-empty">{emptyText}</p>
  const top = max ?? Math.max(1, ...items.map((i) => i.value))
  const total = items.reduce((a, i) => a + i.value, 0)

  return (
    <div className="chart">
      <div role="list" aria-label={ariaLabel} className="chart-rows" style={{ '--label-w': `${labelWidth}px` } as CSSProperties}>
        {items.map((it, i) => {
          const clickable = !!onSelect && it.selectable !== false
          const Row = clickable ? 'button' : 'div'
          return (
            <Fragment key={it.id}>
              {it.group && it.group !== items[i - 1]?.group && <div className="chart-group">{it.group}</div>}
              <div role="listitem">
                <Row type={clickable ? 'button' : undefined} onClick={clickable ? () => onSelect(it) : undefined} tabIndex={clickable ? undefined : 0} title={it.hint} className="chart-row isa-chart-focus">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>{it.icon}<span className="chart-label">{it.label}</span></span>
                  <span className="chart-track">
                    <i aria-hidden style={{ width: barWidth(it.value / top), background: chartTone(it.color, colorful ? i : 0) }} />
                    <b>{format(it.value)}</b>
                  </span>
                  {(showShare || extra) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {showShare && <span className="chart-share">{total ? Math.round((it.value / total) * 100) : 0}%</span>}
                    {extra?.(it)}
                  </span>}
                </Row>
              </div>
            </Fragment>
          )
        })}
      </div>
      <div style={visuallyHidden}><table>
        <caption>{ariaLabel}</caption>
        <tbody>{items.map((it) => <tr key={it.id}><th>{it.label}</th><td>{format(it.value)}</td></tr>)}</tbody>
      </table></div>
    </div>
  )
}
