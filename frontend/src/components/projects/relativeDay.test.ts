import { describe, it, expect } from 'vitest'
import { relativeDay } from './relativeDay'

// Datas de task são gravadas ao meio-dia UTC (o dia não muda em nenhum fuso do Brasil).
const now = new Date(2026, 9, 13, 9, 30) // 13/10/2026 09:30 local
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}T12:00:00.000Z`

describe('relativeDay', () => {
  it('fala hoje, amanhã, ontem e a distância em dias na semana', () => {
    expect(relativeDay(day(13), now)).toBe('Hoje')
    expect(relativeDay(day(14), now)).toBe('Amanhã')
    expect(relativeDay(day(12), now)).toBe('Ontem')
    expect(relativeDay(day(16), now)).toBe('em 3 dias')
    expect(relativeDay(day(10), now)).toBe('há 3 dias')
  })

  it('a partir de uma semana volta a ser a data', () => {
    expect(relativeDay(day(20), now)).toMatch(/20/)
    expect(relativeDay(day(6), now)).toMatch(/06/)
  })
})
