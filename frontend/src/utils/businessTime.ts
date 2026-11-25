// Espelho de getBusinessMinutesBetween (backend/src/utils/businessHours.ts):
// o relógio do SLA só anda dentro do horário comercial cadastrado.
export interface BusinessHours {
  business_hours_start: string // "HH:MM"
  business_hours_end: string // "HH:MM"
  working_days: number[] // ISO: 1=seg … 7=dom
  timezone: string
  holidays: string[] // 'yyyy-mm-dd' no fuso acima
}

const MIN = 60000
const DAY = 24 * 60 * MIN
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const formats = new Map<string, Intl.DateTimeFormat>()

function localParts(t: number, timeZone: string) {
  let f = formats.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23',
    })
    formats.set(timeZone, f)
  }
  const p = Object.fromEntries(f.formatToParts(t).map(x => [x.type, x.value]))
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday) + 1,
    msOfDay: ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + (t % 1000),
  }
}

const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return (h * 60 + m) * MIN
}

/** Milissegundos úteis entre `from` e `to` (0 se `to` <= `from`). */
export function businessMsBetween(from: number, to: number, cfg: BusinessHours): number {
  const open = hm(cfg.business_hours_start)
  const close = hm(cfg.business_hours_end)
  const holidays = new Set(cfg.holidays)
  let total = 0
  // Avança dia a dia assumindo dias de 24h (BR sem horário de verão
  // desde 2019); com DST a janela do dia da troca desloca 1h.
  for (let t = from, i = 0; t < to && i < 2000; i++) {
    const p = localParts(t, cfg.timezone)
    const dayStart = t - p.msOfDay
    if (cfg.working_days.includes(p.weekday) && !holidays.has(p.ymd)) {
      const a = Math.max(t, dayStart + open)
      const b = Math.min(to, dayStart + close)
      if (b > a) total += b - a
    }
    t = dayStart + DAY
  }
  return total
}
