import { describe, it, expect } from 'vitest'
import { businessMsBetween } from './businessTime'

const cfg = {
  business_hours_start: '08:00',
  business_hours_end: '18:00',
  working_days: [1, 2, 3, 4, 5],
  timezone: 'America/Sao_Paulo',
  holidays: ['2026-06-11'],
}
const t = (iso: string) => new Date(iso).getTime()
const H = 3600000

describe('businessMsBetween', () => {
  it('dentro do expediente conta tempo corrido', () => {
    // ter 09:00 → 13:00 BRT
    expect(businessMsBetween(t('2026-06-09T12:00:00Z'), t('2026-06-09T16:00:00Z'), cfg)).toBe(4 * H)
  })

  it('não conta a noite', () => {
    // ter 17:00 BRT → qua 09:00 BRT = 1h + 1h
    expect(businessMsBetween(t('2026-06-09T20:00:00Z'), t('2026-06-10T12:00:00Z'), cfg)).toBe(2 * H)
  })

  it('não conta fim de semana nem feriado', () => {
    // qua 17:00 BRT → seg 09:00 BRT; qui 11/06 é feriado => qua 1h + sex 10h + seg 1h
    expect(businessMsBetween(t('2026-06-10T20:00:00Z'), t('2026-06-15T12:00:00Z'), cfg)).toBe(12 * H)
  })

  it('fora do expediente o restante fica congelado', () => {
    const deadline = t('2026-06-15T12:00:00Z') // seg 09:00 BRT
    const sat = businessMsBetween(t('2026-06-13T15:00:00Z'), deadline, cfg)
    const sun = businessMsBetween(t('2026-06-14T23:00:00Z'), deadline, cfg)
    expect(sat).toBe(1 * H)
    expect(sun).toBe(sat)
  })

  it('intervalo invertido ou vazio é zero', () => {
    expect(businessMsBetween(t('2026-06-09T16:00:00Z'), t('2026-06-09T12:00:00Z'), cfg)).toBe(0)
  })
})
