/** Minutos → "45 min", "12h", "12h 30min" ("—" para null). */
export function fmtMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 1) return '< 1 min'
  const r = Math.round(m)
  if (r < 60) return `${r} min`
  const h = Math.floor(r / 60), mm = r % 60
  return mm ? `${h}h ${mm}min` : `${h}h`
}
