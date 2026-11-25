import { useState, useEffect, CSSProperties, ReactNode } from 'react'
import { useBusinessHours } from '@/hooks/useBusinessHours'
import { businessMsBetween } from '@/utils/businessTime'
import { SKADI_NAME } from '@/utils/skadi'

export type BadgeVariant = 'default' | 'blue' | 'red' | 'orange' | 'amber' | 'green' | 'purple' | 'navy' | 'dark'

const BADGE_TONE: Record<BadgeVariant, string | undefined> = {
  default: undefined, dark: undefined,
  blue: 'var(--c1)', navy: 'var(--c1)', red: 'var(--c5)', orange: 'var(--c4)', amber: 'var(--c4)', green: 'var(--c2)', purple: 'var(--c3)',
}
const toneStyle = (tone?: string, style: CSSProperties = {}) => (tone ? { '--tone': tone, ...style } : style) as CSSProperties

export function Badge({ children, variant = 'default', compact = false, style = {}, title }: {
  children: ReactNode
  variant?: BadgeVariant
  compact?: boolean
  style?: CSSProperties
  title?: string
}) {
  return <span className="tag" data-compact={compact || undefined} title={title} style={toneStyle(BADGE_TONE[variant], style)}>{children}</span>
}

const STATUS_TONE: Record<string, string> = {
  open: 'var(--c1)', in_progress: 'var(--c3)', pending: 'var(--c4)', resolved: 'var(--c2)', closed: 'var(--text-3)', reopened: 'var(--c5)', cancelled: 'var(--text-3)',
}
/** Situação: disco na cor da etapa com um símbolo dentro (a cor nunca vem sozinha). */
export function StatusGlyph({ status, size = 18 }: { status: string; size?: number }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.open
  const ink = { fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      <circle cx="10" cy="10" r="10" fill={tone} />
      {status === 'in_progress' ? <path d="M8 6.2v7.6l6-3.8z" fill="#fff" />
        : status === 'pending' ? <path d="M7.6 6.5v7M12.4 6.5v7" {...ink} />
        : status === 'resolved' ? <path d="m6 10.4 2.7 2.7L14 7.6" {...ink} />
        : status === 'closed' ? <path d="M6.4 10h7.2" {...ink} />
        : status === 'cancelled' ? <path d="m7 7 6 6m0-6-6 6" {...ink} />
        : status === 'reopened' ? <path d="M13.5 8.2A4 4 0 1 0 14 11M13.8 5.6v2.9h-2.9" {...ink} />
        : <circle cx="10" cy="10" r="3.6" fill="#fff" />}
    </svg>
  )
}

export function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const m: Record<string, { label: string; labelCompact?: string }> = {
    open:        { label: 'Aberto' },
    reopened:    { label: 'Reaberto' },
    in_progress: { label: 'Em atendimento', labelCompact: 'Em atend.' },
    pending:     { label: 'Pendente' },
    resolved:    { label: 'Resolvido' },
    closed:      { label: 'Fechado' },
    cancelled:   { label: 'Cancelado' },
  }
  const s = m[status] ?? m.open
  const displayLabel = compact && s.labelCompact ? s.labelCompact : s.label
  return (
    <span className="tag" data-compact={compact || undefined} style={toneStyle(STATUS_TONE[m[status] ? status : 'open'])}><i aria-hidden />{displayLabel}</span>
  )
}

/** Valor em texto; a cor só aparece quando pede atenção. */
function PlainTag({ children, tone = 'var(--text-2)', strong = false, compact = false, title, style }: { children: ReactNode; tone?: string; strong?: boolean; compact?: boolean; title?: string; style?: CSSProperties }) {
  return <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: tone, fontSize: compact ? 12 : 13, fontWeight: strong ? 600 : 400, whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', ...style }}>{children}</span>
}

const PRIORITY: Record<string, { label: string; tone: string }> = {
  low: { label: 'Baixa', tone: 'var(--text-3)' },
  medium: { label: 'Média', tone: 'var(--c4)' },
  high: { label: 'Alta', tone: 'var(--c5)' },
}
export function PriorityBadge({ priority }: { priority: string }) {
  const p = PRIORITY[priority] ?? PRIORITY.low
  return <span className="tag" style={toneStyle(p.tone)}><PriorityDot priority={priority} />{p.label}</span>
}

/** Prioridade em degraus: um, dois ou três, cada nível com a sua cor. */
export function PriorityDot({ priority }: { priority: string }) {
  const level = priority === 'high' || priority === 'critical' ? 3 : priority === 'medium' || priority === 'normal' ? 2 : 1
  const ink = level === 3 ? 'var(--c5)' : level === 2 ? 'var(--c4)' : 'var(--text-3)'
  return (
    <svg width="14" height="13" viewBox="0 0 11 10" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      {[0, 1, 2].map(i => <rect key={i} x={i * 4} y={6 - i * 3} width="3" height={4 + i * 3} rx="1" fill={i < level ? ink : 'var(--border-strong)'} />)}
    </svg>
  )
}

// Identidade de cor de uma entidade (fila, status, nível) — substitui a borda colorida numa aresta só.
export function ColorDot({ color, size = 9, title }: { color: string; size?: number; title?: string }) {
  return <span aria-hidden={title ? undefined : true} title={title} style={{ width: size, height: size, borderRadius: 3, background: color, display: 'inline-block', flexShrink: 0 }} />
}

export function TypeBadge({ type, compact }: { type: string; compact?: boolean }) {
  const m: Record<string, string> = { incident: 'Incidente', request: 'Requisição', problem: 'Problema', change: 'Mudança' }
  return <PlainTag tone="var(--text-3)" compact={compact}>{m[type] ?? m.incident}</PlainTag>
}

export function TierBadge({ tier }: { tier: string }) {
  const tone: Record<string, string> = { gold: 'var(--c4)', platinum: 'var(--c3)', silver: 'var(--text-3)', bronze: 'color-mix(in oklch, var(--c4), var(--c5) 45%)' }
  return <span className="tag" data-compact style={toneStyle(tone[tier.toLowerCase()] ?? 'var(--c1)')}>{tier.charAt(0).toUpperCase() + tier.slice(1)}</span>
}

export function QueueBadge({ queue, name, color }: { queue: string | null | undefined; name?: string; color?: string | null }) {
  const m: Record<string, string> = { geral: 'Geral', vip: 'VIP', especializada: 'Especializada', sistemas: 'Sistemas' }
  // Sem fila (não bateu regra de roteamento nem tem fila padrão configurada)
  // deve aparecer como tal, nunca cair silenciosamente em "Geral".
  if (!queue) return <PlainTag tone="var(--text-3)">Sem fila</PlainTag>
  // Fila não resolvida (ex: desativada e não carregada na lista) nunca deve
  // vazar o UUID cru — mostra um rótulo genérico em vez disso.
  // O nome vem do cadastro (resolvido pelo chamador). Sem nome = id fora do
  // cadastro: antes "geral" virava "Geral" mesmo sem existir fila com esse id.
  const fallbackLabel = name ?? 'Fila desconhecida'
  const wrapStyle: CSSProperties = { maxWidth: '100%', minWidth: 0, display: 'inline-flex', overflow: 'hidden' }
  const badgeStyle: CSSProperties = { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }
  // Prioriza a cor real cadastrada na fila (resolvida pelo chamador) — cobre
  // tanto filas fora do catálogo seed quanto o admin recolorindo uma seed.
  if (color) {
    return (
      <span data-tooltip={fallbackLabel} title={fallbackLabel} style={wrapStyle}>
        <PlainTag style={badgeStyle}><ColorDot color={color} /> {fallbackLabel}</PlainTag>
      </span>
    )
  }
  const label = m[queue] ?? fallbackLabel
  return <span data-tooltip={fallbackLabel} title={fallbackLabel} style={wrapStyle}><PlainTag tone="var(--text-1)" style={badgeStyle}>{label}</PlainTag></span>
}

function fmtDiff(ms: number, showDays: boolean = false): string {
  const abs = Math.abs(ms)
  const hTotal = Math.floor(abs / 3600000)
  const m = Math.floor((abs % 3600000) / 60000)
  
  if (showDays && hTotal >= 24) {
    const d = Math.floor(abs / 86400000)
    const h = Math.floor((abs % 86400000) / 3600000)
    return `${d}d ${h}h ${m}min`
  }
  return hTotal > 0 ? `${hTotal}h ${m}min` : `${m}min`
}

/** Resolvido pela Skadi e ainda fora da fila: não houve atendimento, então não há SLA a mostrar. */
export const isAiResolved = (ticket: { aiResolved?: boolean; status: string }) =>
  !!ticket.aiResolved && ['resolved', 'closed'].includes(ticket.status)

export function AiResolvedBadge() {
  return <PlainTag tone="var(--text-1)"><StatusGlyph status="resolved" /> Resolvido pela {SKADI_NAME}</PlainTag>
}

const SLA_TONE: Partial<Record<BadgeVariant, string>> = { red: 'var(--danger)', orange: 'var(--warning)', green: 'var(--text-1)' }

// forecastOverdue: chamado em projeto cuja previsão (prazo da task) venceu — SLA pausado, mas é risco.
export function SLABadge({ deadline, compact = false, status, resolvedAt, showDays = false, forecastOverdue = false }: { deadline: string; compact?: boolean; status?: string; resolvedAt?: string | null; showDays?: boolean; forecastOverdue?: boolean }) {
  const [info, setInfo] = useState({ text: '', variant: 'green' as BadgeVariant, title: undefined as string | undefined })
  const isDone = !!status && ['resolved', 'closed'].includes(status)
  const isPending = !!status && status === 'pending'
  const bh = useBusinessHours()
  // Tempo de SLA entre dois instantes: só conta horário comercial (sem config
  // carregada ainda, cai no tempo corrido). O sinal vem de quem chama.
  const span = (a: number, b: number) =>
    bh ? businessMsBetween(Math.min(a, b), Math.max(a, b), bh) : Math.abs(b - a)

  useEffect(() => {
    if (isDone || isPending) return
    const calc = () => {
      const now = Date.now()
      const end = new Date(deadline).getTime()
      const ms = span(now, end)
      const title = bh && businessMsBetween(now, now + 60000, bh) === 0
        ? 'Fora do horário comercial: contagem do SLA parada' : undefined
      if (end < now) {
        setInfo({ text: `${fmtDiff(ms, showDays)} vencido`, variant: 'red', title })
      } else {
        setInfo({ text: fmtDiff(ms, showDays), variant: ms < 3600000 ? 'red' : ms < 3 * 3600000 ? 'orange' : 'green', title })
      }
    }
    calc()
    const i = setInterval(calc, 30000)
    return () => clearInterval(i)
  }, [deadline, isDone, isPending, showDays, bh])

  if (isPending && forecastOverdue) {
    return <Badge variant="red" compact={compact} title="SLA pausado pelo projeto, mas a previsão da task venceu: o cliente segue esperando">{compact ? 'Previsão vencida' : 'Previsão do projeto vencida'}</Badge>
  }
  if (isPending) {
    return <PlainTag tone="var(--text-3)" compact={compact}>{compact ? 'Pausado' : 'SLA: Pausado'}</PlainTag>
  }

  if (isDone) {
    if (resolvedAt) {
      const end = new Date(deadline).getTime()
      const at = new Date(resolvedAt).getTime()
      const diff = end >= at ? span(at, end) : -span(end, at)
      if (diff >= 0) return <PlainTag compact={compact}>{compact ? `+${fmtDiff(diff, showDays)}` : `SLA: ${fmtDiff(diff, showDays)} restante`}</PlainTag>
      return <PlainTag tone="var(--danger)" strong compact={compact}>{compact ? `-${fmtDiff(diff, showDays)}` : `SLA: ${fmtDiff(diff, showDays)} vencido`}</PlainTag>
    }
    return <PlainTag compact={compact}>{compact ? 'OK' : 'SLA: Resolvido'}</PlainTag>
  }
  return <PlainTag tone={SLA_TONE[info.variant] ?? 'var(--text-1)'} strong={info.variant !== 'green'} compact={compact} title={info.title}>{compact ? info.text : `SLA: ${info.text}`}</PlainTag>
}

