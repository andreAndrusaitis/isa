import { DateTime } from 'luxon'
import Holidays from 'date-holidays'

export interface BusinessHoursLike {
  business_hours_start: string // "HH:MM"
  business_hours_end: string // "HH:MM"
  working_days: number[] // ISO: 1=seg … 7=dom
  timezone: string
}

// ── Feriados nacionais BR ───────────────────────────────────────────────────
// Cache por ano para evitar recomputar (inclui móveis: Carnaval, Páscoa, etc).
const holidayCache = new Map<number, string[]>()

/** Datas (yyyy-mm-dd) dos feriados nacionais brasileiros do ano informado. */
export function nationalHolidays(year: number): string[] {
  if (!holidayCache.has(year)) {
    const hd = new Holidays('BR')
    const set = new Set<string>()
    for (const h of hd.getHolidays(year)) {
      if (h.type === 'public') set.add(h.date.slice(0, 10))
    }
    holidayCache.set(year, [...set])
  }
  return holidayCache.get(year)!
}

/** Feriados nacionais cobrindo o ano de `start` + os 2 anos seguintes. */
export function holidaysAround(start: Date): string[] {
  const y = start.getUTCFullYear()
  return [...nationalHolidays(y), ...nationalHolidays(y + 1), ...nationalHolidays(y + 2)]
}

function hm(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

/**
 * Avança `hours` horas ÚTEIS a partir de `start`, contando apenas dentro da
 * janela comercial `[start, end)`, em dias presentes em `working_days` (ISO 1..7)
 * e fora dos feriados informados. `holidays` = lista de 'yyyy-mm-dd' (datas
 * locais ao `timezone`). Retorna o instante (UTC) do vencimento.
 */
export function addBusinessHours(
  start: Date,
  hours: number,
  cfg: BusinessHoursLike,
  holidays: string[],
): Date {
  const holidaySet = new Set(holidays)
  const startMin = hm(cfg.business_hours_start)
  const endMin = hm(cfg.business_hours_end)
  const startH = Math.floor(startMin / 60)
  const startM = startMin % 60

  let remaining = Math.max(0, Math.round(hours * 60)) // minutos úteis restantes
  let cur: DateTime<boolean> = DateTime.fromJSDate(start, { zone: cfg.timezone })

  const isWorkingDay = (d: DateTime<boolean>) =>
    cfg.working_days.includes(d.weekday) && !holidaySet.has(d.toFormat('yyyy-MM-dd'))

  const dayStart = (d: DateTime<boolean>) => d.set({ hour: startH, minute: startM, second: 0, millisecond: 0 })

  // Posiciona o cursor no próximo instante comercial válido (>= startMin, < endMin, dia útil).
  const advanceToOpen = (d: DateTime<boolean>): DateTime<boolean> => {
    let x = d
    for (let i = 0; i < 4000; i++) {
      if (!isWorkingDay(x)) {
        x = dayStart(x.plus({ days: 1 }))
        continue
      }
      const minutes = x.hour * 60 + x.minute
      if (minutes < startMin) return dayStart(x)
      if (minutes >= endMin) {
        x = dayStart(x.plus({ days: 1 }))
        continue
      }
      return x
    }
    return x
  }

  cur = advanceToOpen(cur)
  while (remaining > 0) {
    const minutes = cur.hour * 60 + cur.minute
    const minutesLeftToday = endMin - minutes
    if (remaining <= minutesLeftToday) {
      cur = cur.plus({ minutes: remaining })
      remaining = 0
    } else {
      remaining -= minutesLeftToday
      cur = advanceToOpen(dayStart(cur.plus({ days: 1 })))
    }
  }
  return cur.toUTC().toJSDate()
}

/**
 * Calculates the number of business minutes elapsed between start and end dates,
 * considering the business hours, working days, and holidays.
 */
export function getBusinessMinutesBetween(
  start: Date,
  end: Date,
  cfg: BusinessHoursLike,
  holidays: string[]
): number {
  if (start >= end) return 0

  const holidaySet = new Set(holidays)
  const startMin = hm(cfg.business_hours_start)
  const endMin = hm(cfg.business_hours_end)
  const startH = Math.floor(startMin / 60)
  const startM = startMin % 60

  let cur: DateTime<boolean> = DateTime.fromJSDate(start, { zone: cfg.timezone })
  const limit = DateTime.fromJSDate(end, { zone: cfg.timezone })

  const isWorkingDay = (d: DateTime<boolean>) =>
    cfg.working_days.includes(d.weekday) && !holidaySet.has(d.toFormat('yyyy-MM-dd'))

  const dayStart = (d: DateTime<boolean>) => d.set({ hour: startH, minute: startM, second: 0, millisecond: 0 })

  let totalMinutes = 0

  // 1. If start and end are on the same day, check if it's a working day
  if (cur.toFormat('yyyy-MM-dd') === limit.toFormat('yyyy-MM-dd')) {
    if (!isWorkingDay(cur)) return 0
    const curMin = cur.hour * 60 + cur.minute
    const limitMin = limit.hour * 60 + limit.minute
    const activeStart = Math.max(startMin, Math.min(endMin, curMin))
    const activeEnd = Math.max(startMin, Math.min(endMin, limitMin))
    return Math.max(0, activeEnd - activeStart)
  }

  // 2. Different days
  // First day partial
  if (isWorkingDay(cur)) {
    const curMin = cur.hour * 60 + cur.minute
    if (curMin < endMin) {
      const activeStart = Math.max(startMin, curMin)
      totalMinutes += (endMin - activeStart)
    }
  }

  // Move to start of next day
  cur = dayStart(cur.plus({ days: 1 }))

  // Whole days in between — por conta, não dia a dia: intervalos de meses (tempo de
  // task) faziam milhões de operações de data. Semanas cheias × dias úteis + resto
  // (≤ 6 dias) − feriados que caem em dia útil dentro do intervalo.
  const firstDay = cur.startOf('day')
  const lastDay = limit.startOf('day') // exclusivo
  const days = Math.max(0, Math.round(lastDay.diff(firstDay, 'days').days))
  if (days > 0) {
    const weeks = Math.floor(days / 7)
    let workingDays = weeks * cfg.working_days.length
    for (let i = weeks * 7; i < days; i++) {
      if (cfg.working_days.includes(firstDay.plus({ days: i }).weekday)) workingDays++
    }
    const fromIso = firstDay.toISODate()!
    const toIso = lastDay.toISODate()!
    for (const h of holidaySet) {
      if (h >= fromIso && h < toIso && cfg.working_days.includes(DateTime.fromISO(h, { zone: cfg.timezone }).weekday)) workingDays--
    }
    totalMinutes += workingDays * (endMin - startMin)
  }

  // Last day partial
  if (isWorkingDay(limit)) {
    const limitMin = limit.hour * 60 + limit.minute
    if (limitMin > startMin) {
      const activeEnd = Math.min(endMin, limitMin)
      totalMinutes += (activeEnd - startMin)
    }
  }

  return totalMinutes
}


/** `date` cai no horário comercial (dia útil, fora de feriado nacional, dentro da janela)? */
export function isBusinessTime(date: Date, cfg: BusinessHoursLike): boolean {
  const d = DateTime.fromJSDate(date, { zone: cfg.timezone })
  const min = d.hour * 60 + d.minute
  return cfg.working_days.includes(d.weekday) &&
    !nationalHolidays(d.year).includes(d.toFormat('yyyy-MM-dd')) &&
    min >= hm(cfg.business_hours_start) && min < hm(cfg.business_hours_end)
}
