import { Meter } from '@/components/ui'
import { fmtMinutes } from '@/utils/duration'
import { DrillLink } from '@/components/projects/drill/drillUi'

/** Barras horizontais com o valor escrito (a cor nunca é a única informação). */
export function TimeBars({ rows, empty = 'Sem horas registradas.', onSelect }: {
  rows: Array<{ key: string; label: string; minutes: number; muted?: boolean; canOpen?: boolean }>
  empty?: string
  /** Só nas linhas com `canOpen`, o nome vira botão. */
  onSelect?: (row: { key: string; label: string }) => void
}) {
  const max = Math.max(1, ...rows.map((r) => r.minutes))
  if (rows.length === 0 || rows.every((r) => r.minutes === 0)) {
    return <p className="prj-note">{empty}</p>
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((r) => (
        <li key={r.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 32%) 1fr auto', alignItems: 'center', gap: 10, fontSize: 14 }}>
          <span style={{ color: r.muted ? 'var(--text-3)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>
            {onSelect && r.canOpen ? <DrillLink onClick={() => onSelect(r)}>{r.label}</DrillLink> : r.label}
          </span>
          <Meter value={r.minutes} max={max} tone={r.muted ? 'var(--text-3)' : undefined} />
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-1)', minWidth: 64, textAlign: 'right' }}>{fmtMinutes(r.minutes)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Task com o tempo correndo. */
export function RunningTag() {
  return <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent-fg)', whiteSpace: 'nowrap' }}>Contando agora</span>
}
