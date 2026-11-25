import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { addBusinessHours, nationalHolidays, getBusinessMinutesBetween, holidaysAround } from './businessHours'

const cfg = {
  business_hours_start: '08:00',
  business_hours_end: '18:00',
  working_days: [1, 2, 3, 4, 5],
  timezone: 'America/Sao_Paulo',
}

describe('addBusinessHours', () => {
  it('soma horas dentro do mesmo dia útil', () => {
    // ter 2026-06-09 09:00 BRT (=12:00Z) + 4h => 13:00 BRT (=16:00Z)
    const start = new Date('2026-06-09T12:00:00Z')
    const out = addBusinessHours(start, 4, cfg, [])
    expect(out.toISOString()).toBe('2026-06-09T16:00:00.000Z')
  })

  it('transborda para o próximo dia útil ao fim do expediente', () => {
    // ter 2026-06-09 16:00 BRT (=19:00Z) + 4h: 2h até 18:00, +2h no dia seguinte => qua 10:00 BRT
    const start = new Date('2026-06-09T19:00:00Z')
    const out = addBusinessHours(start, 4, cfg, [])
    expect(out.toISOString()).toBe('2026-06-10T13:00:00.000Z')
  })

  it('pula fim de semana', () => {
    // sex 2026-06-12 16:00 BRT + 4h => seg 2026-06-15 10:00 BRT
    const start = new Date('2026-06-12T19:00:00Z')
    const out = addBusinessHours(start, 4, cfg, ['2030-01-01'])
    expect(out.toISOString()).toBe('2026-06-15T13:00:00.000Z')
  })

  it('pula feriado nacional informado (yyyy-mm-dd)', () => {
    // qui 2026-06-11 16:00 BRT + feriado sex 2026-06-12 => transborda p/ seg 10:00 BRT
    const start = new Date('2026-06-11T19:00:00Z')
    const out = addBusinessHours(start, 4, cfg, ['2026-06-12'])
    expect(out.toISOString()).toBe('2026-06-15T13:00:00.000Z')
  })

  it('inicia fora do expediente cai no próximo dia útil', () => {
    // sáb 2026-06-13 12:00 BRT + 2h => seg 2026-06-15 10:00 BRT
    const start = new Date('2026-06-13T15:00:00Z')
    const out = addBusinessHours(start, 2, cfg, [])
    expect(out.toISOString()).toBe('2026-06-15T13:00:00.000Z')
  })
})

describe('nationalHolidays', () => {
  it('inclui Natal (25/12) como feriado nacional', () => {
    expect(nationalHolidays(2026)).toContain('2026-12-25')
  })
})

describe('getBusinessMinutesBetween', () => {
  const customCfg = {
    business_hours_start: '09:00',
    business_hours_end: '18:00',
    working_days: [1, 2, 3, 4, 5],
    timezone: 'America/Sao_Paulo',
  }

  it('retorna 0 se start >= end', () => {
    const start = new Date('2026-06-09T12:00:00Z')
    const end = new Date('2026-06-09T11:00:00Z')
    expect(getBusinessMinutesBetween(start, end, customCfg, [])).toBe(0)
  })

  it('calcula minutos no mesmo dia útil', () => {
    // 2026-06-09 10:00 BRT (=13:00Z) a 12:00 BRT (=15:00Z) => 2 horas = 120 minutos
    const start = new Date('2026-06-09T13:00:00Z')
    const end = new Date('2026-06-09T15:00:00Z')
    expect(getBusinessMinutesBetween(start, end, customCfg, [])).toBe(120)
  })

  it('limita minutos ao horário de expediente no mesmo dia', () => {
    // 2026-06-09 07:00 BRT (=10:00Z) a 20:00 BRT (=23:00Z) => 9:00 a 18:00 = 9 horas = 540 minutos
    const start = new Date('2026-06-09T10:00:00Z')
    const end = new Date('2026-06-09T23:00:00Z')
    expect(getBusinessMinutesBetween(start, end, customCfg, [])).toBe(540)
  })

  it('retorna 0 para datas no fim de semana (mesmo dia ou período completo de final de semana)', () => {
    // sábado 2026-06-13 10:00 BRT (=13:00Z) a 14:00 BRT (=17:00Z)
    const start = new Date('2026-06-13T13:00:00Z')
    const end = new Date('2026-06-13T17:00:00Z')
    expect(getBusinessMinutesBetween(start, end, customCfg, [])).toBe(0)
  })

  it('calcula minutos atravessando fim de semana', () => {
    // sexta 2026-06-12 17:00 BRT (=20:00Z) a segunda 2026-06-15 10:00 BRT (=13:00Z)
    // sexta: 17:00 a 18:00 = 60 min
    // segunda: 09:00 a 10:00 = 60 min
    // total = 120 min
    const start = new Date('2026-06-12T20:00:00Z')
    const end = new Date('2026-06-15T13:00:00Z')
    expect(getBusinessMinutesBetween(start, end, customCfg, [])).toBe(120)
  })

  it('pula feriado nacional', () => {
    // qui 2026-06-11 17:00 BRT (=20:00Z) a seg 2026-06-15 10:00 BRT (=13:00Z) com feriado na sexta 2026-06-12
    // qui: 17:00 a 18:00 = 60 min
    // sex: feriado = 0 min
    // sáb/dom: fds = 0 min
    // seg: 09:00 a 10:00 = 60 min
    // total = 120 min
    const start = new Date('2026-06-11T20:00:00Z')
    const end = new Date('2026-06-15T13:00:00Z')
    expect(getBusinessMinutesBetween(start, end, customCfg, ['2026-06-12'])).toBe(120)
  })
})


describe('getBusinessMinutesBetween — dias inteiros por conta', () => {
  // Referência: o laço dia a dia de antes da otimização (mesma regra, lento em meses).
  function reference(start: Date, end: Date, cfg: any, holidays: string[]) {
    if (start >= end) return 0
    const hs = new Set(holidays)
    const hmToMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
    const sMin = hmToMin(cfg.business_hours_start), eMin = hmToMin(cfg.business_hours_end)
    let cur = DateTime.fromJSDate(start, { zone: cfg.timezone })
    const limit = DateTime.fromJSDate(end, { zone: cfg.timezone })
    const work = (d: DateTime) => cfg.working_days.includes(d.weekday) && !hs.has(d.toFormat('yyyy-MM-dd'))
    if (cur.toFormat('yyyy-MM-dd') === limit.toFormat('yyyy-MM-dd')) {
      if (!work(cur)) return 0
      const a = Math.max(sMin, Math.min(eMin, cur.hour * 60 + cur.minute))
      const b = Math.max(sMin, Math.min(eMin, limit.hour * 60 + limit.minute))
      return Math.max(0, b - a)
    }
    let total = 0
    if (work(cur) && cur.hour * 60 + cur.minute < eMin) total += eMin - Math.max(sMin, cur.hour * 60 + cur.minute)
    cur = cur.plus({ days: 1 }).set({ hour: Math.floor(sMin / 60), minute: sMin % 60, second: 0, millisecond: 0 })
    while (cur.toFormat('yyyy-MM-dd') < limit.toFormat('yyyy-MM-dd')) { if (work(cur)) total += eMin - sMin; cur = cur.plus({ days: 1 }) }
    if (work(limit) && limit.hour * 60 + limit.minute > sMin) total += Math.min(eMin, limit.hour * 60 + limit.minute) - sMin
    return total
  }

  it('dá o mesmo resultado do laço dia a dia em 3000 intervalos (até 400 dias, com feriados)', () => {
    const cfg = { business_hours_start: '08:00', business_hours_end: '18:00', working_days: [1, 2, 3, 4, 5], timezone: 'America/Sao_Paulo' }
    const holidays = holidaysAround(new Date('2025-01-01T12:00:00Z'))
    let seed = 42
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    const base = new Date('2025-01-01T00:00:00Z').getTime()
    for (let i = 0; i < 3000; i++) {
      const a = new Date(base + rnd() * 600 * 86_400_000)
      const b = new Date(a.getTime() + rnd() * 400 * 86_400_000)
      expect(getBusinessMinutesBetween(a, b, cfg, holidays)).toBe(reference(a, b, cfg, holidays))
    }
  })
})
