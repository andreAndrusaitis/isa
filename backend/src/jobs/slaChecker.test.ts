import { describe, it, expect } from 'vitest'
import { getEscalationMinutes, isPastEscalationThreshold } from './slaChecker'

const bh = {
  business_hours_start: '08:00',
  business_hours_end: '18:00',
  working_days: [1, 2, 3, 4, 5],
  timezone: 'America/Sao_Paulo',
}

describe('slaChecker escalation threshold', () => {
  it('usa escalation_minutes configurado no plano', () => {
    expect(getEscalationMinutes({ escalation_minutes: 15 })).toBe(15)
  })

  it('cai para 30min quando o plano não configurou', () => {
    expect(getEscalationMinutes(null)).toBe(30)
    expect(getEscalationMinutes({ escalation_minutes: null })).toBe(30)
  })

  // ter 2026-06-09 09:00 BRT = 12:00Z
  const tue9 = new Date('2026-06-09T12:00:00Z')

  it('escalona quando o deadline está dentro do limiar', () => {
    const deadline = new Date(tue9.getTime() + 10 * 60 * 1000)
    expect(isPastEscalationThreshold(deadline, 15, tue9, bh, [])).toBe(true)
  })

  it('não escalona quando o deadline está fora do limiar', () => {
    const deadline = new Date(tue9.getTime() + 45 * 60 * 1000)
    expect(isPastEscalationThreshold(deadline, 15, tue9, bh, [])).toBe(false)
  })

  it('não escalona ticket sem deadline', () => {
    expect(isPastEscalationThreshold(null, 30, tue9, bh, [])).toBe(false)
  })

  it('conta o limiar em minutos úteis atravessando o fim de semana', () => {
    // sex 2026-06-12 17:45 BRT; prazo seg 08:10 BRT => faltam 15+10 = 25min úteis
    const fri = new Date('2026-06-12T20:45:00Z')
    expect(isPastEscalationThreshold(new Date('2026-06-15T11:10:00Z'), 30, fri, bh, [])).toBe(true)
    // prazo seg 09:00 BRT => 15+60 = 75min úteis, ainda longe do limiar
    expect(isPastEscalationThreshold(new Date('2026-06-15T12:00:00Z'), 30, fri, bh, [])).toBe(false)
  })
})
