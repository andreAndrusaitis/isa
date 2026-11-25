import { describe, it, expect } from 'vitest'
import { formatDateTime } from './dateTime'

describe('formatDateTime', () => {
  it('mostra dia, mês, ano e hora', () => {
    expect(formatDateTime(new Date(2026, 9, 13, 14, 32))).toBe('13/10/2026 14:32')
  })

  it('aceita ISO e timestamp', () => {
    const d = new Date(2026, 0, 5, 9, 7)
    expect(formatDateTime(d.toISOString())).toBe('05/01/2026 09:07')
    expect(formatDateTime(d.getTime())).toBe('05/01/2026 09:07')
  })

  it('vazio ou inválido vira texto vazio', () => {
    expect(formatDateTime(null)).toBe('')
    expect(formatDateTime(undefined)).toBe('')
    expect(formatDateTime('')).toBe('')
    expect(formatDateTime('não é data')).toBe('')
  })
})
