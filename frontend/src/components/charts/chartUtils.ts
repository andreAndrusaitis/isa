/** Utilitários puros do kit de gráficos (sem React): escala, linha, eixos e tooltip. */

export type Point = { x: number; y: number }

/** Escala linear [d0,d1] → [r0,r1]. */
export const linear = (d0: number, d1: number, r0: number, r1: number) =>
  (v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0))

/** Máximo "redondo" para o eixo Y (1, 2, 2.5, 5 × 10^n) e as marcas até ele. */
export function niceTicks(max: number, count = 4) {
  if (max <= 0) return { max: 1, ticks: [0, 1] }
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
  const top = Math.ceil(max / step) * step
  return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100) }
}

/** Linha reta ponto a ponto. */
export const linePath = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('')

/** Índice do ponto mais próximo de `px` em xs (ordenado). */
export function nearestIndex(xs: number[], px: number) {
  let best = 0
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i
  return best
}

/**
 * Posição do tooltip DENTRO do contêiner: à direita do cursor; perto da borda direita
 * vira para a esquerda; nunca sai por cima/baixo.
 */
export function placeTooltip(anchor: Point, size: { w: number; h: number }, box: { w: number; h: number }, gap = 12) {
  let left = anchor.x + gap
  if (left + size.w > box.w) left = anchor.x - gap - size.w
  left = Math.max(0, Math.min(left, box.w - size.w))
  const top = Math.max(0, Math.min(anchor.y - size.h / 2, box.h - size.h))
  return { left, top }
}

/** Rótulo curto de dia ("08 out") a partir de YYYY-MM-DD, sem efeito de fuso. */
export const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '')
/** Rótulo longo ("qui, 08 de out.") para o tooltip. */
export const longDay = (key: string) => {
  const s = new Date(`${key}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1) // "Qui., 08 de out." — só a 1ª letra
}

/** Paleta dos gráficos: sai da cor da organização (tokens --c1 a --c6). */
export const CHART_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c6)', 'color-mix(in srgb, var(--c1) 45%, var(--bg-card))', 'color-mix(in srgb, var(--c2) 45%, var(--bg-card))']

export const chartTone = (color: string | undefined, i = 0) => color ?? CHART_COLORS[i % CHART_COLORS.length]

/** Largura da barra deixando espaço para o valor escrito depois dela. */
export const barWidth = (ratio: number) => `calc((100% - 5.5em) * ${Math.max(0, Math.min(1, ratio))})`
