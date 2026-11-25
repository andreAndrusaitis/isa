import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { placeTooltip } from './chartUtils'
import './charts.css'

/**
 * Tooltip dos gráficos: posicionado dentro do contêiner do gráfico (vira de lado perto
 * da borda), mede o próprio tamanho e desliza entre pontos. O contêiner precisa ser
 * position: relative.
 */
export function ChartTooltip({ anchor, box, children }: { anchor: { x: number; y: number } | null; box: { w: number; h: number }; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 160, h: 60 })
  useLayoutEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) setSize({ w: r.width, h: r.height })
  })
  const pos = anchor ? placeTooltip(anchor, size, box) : { left: 0, top: 0 }
  return (
    <div ref={ref} role="status" aria-live="polite" className="isa-chart-tip"
      style={{ ...tipStyle, left: pos.left, top: pos.top, opacity: anchor ? 1 : 0, visibility: anchor ? 'visible' : 'hidden' }}>
      {children}
    </div>
  )
}

const tipStyle: CSSProperties = {
  position: 'absolute', zIndex: 5, minWidth: 140, maxWidth: 260,
  padding: '10px 12px', fontSize: 12.5,
  background: 'var(--bg-card)', color: 'var(--text-1)',
  border: '1px solid var(--border-strong)', boxShadow: 'var(--pop-shadow)',
}

export function TipTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-1)' }}>{children}</div>
}

export function TipRow({ color, label, value }: { color: string; label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.8 }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, background: color, flexShrink: 0 }} />
      <span style={{ color: 'var(--text-2)', flex: 1 }}>{label}</span>
      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </div>
  )
}

/** Texto só para leitor de tela (o projeto não tem classe sr-only). Em tabela, use num <div> em volta: <table> ignora a altura de 1px e cria rolagem. */
export const visuallyHidden: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }
