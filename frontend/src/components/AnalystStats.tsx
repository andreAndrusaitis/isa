function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h${rest}min` : `${hours}h`
}

/** Indicadores do analista em uma linha, ao lado das abas. */
export function AnalystStats({ stats }: { stats: {
  resolvedToday: number
  resolvedTrend?: 'up' | 'down' | 'flat'
  slaCompliance: number
  avgResolutionMinutes?: number
  dueSoonCount?: number
  reopenedCount?: number
  workload: number
} }) {
  const trend = stats.resolvedTrend === 'up' ? ' ↑' : stats.resolvedTrend === 'down' ? ' ↓' : ''
  const dueSoon = stats.dueSoonCount ?? 0
  const rows: { label: string; value: string; tone?: string }[] = [
    { label: 'Resolvidos hoje', value: `${stats.resolvedToday}${trend}` },
    { label: 'SLA cumprido', value: `${stats.slaCompliance}%`, tone: stats.slaCompliance < 90 ? 'var(--warning)' : undefined },
    { label: 'Tempo médio', value: formatMinutes(stats.avgResolutionMinutes ?? 0) },
    ...(dueSoon > 0 ? [{ label: 'Vencendo', value: String(dueSoon), tone: 'var(--warning)' }] : []),
    ...((stats.reopenedCount ?? 0) > 0 ? [{ label: 'Reabertos', value: String(stats.reopenedCount) }] : []),
  ]
  return (
    <>
      {rows.map(r => (
        <span key={r.label}>{r.label} <b style={{ color: r.tone ?? 'var(--text-1)' }}>{r.value}</b></span>
      ))}
    </>
  )
}
