import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTableSort, compareSortValues, ticketNumber } from './useTableSort'

describe('useTableSort', () => {
  const rows = [{ n: 'REQ-10' }, { n: '' }, { n: 'INC-9' }, { n: 'REQ-100' }]
  const getters = { id: (r: { n: string }) => ticketNumber({ displayNumber: r.n }) }

  it('cicla ↑ → ↓ → ordem original, com vazios sempre no fim', () => {
    const { result } = renderHook(() => useTableSort<'id'>())
    expect(result.current.apply(rows, getters)).toBe(rows)

    act(() => result.current.toggle('id'))
    expect(result.current.apply(rows, getters).map(r => r.n)).toEqual(['INC-9', 'REQ-10', 'REQ-100', ''])

    act(() => result.current.toggle('id'))
    expect(result.current.apply(rows, getters).map(r => r.n)).toEqual(['REQ-100', 'REQ-10', 'INC-9', ''])

    act(() => result.current.toggle('id'))
    expect(result.current.sort).toBeNull()
  })

  it('compara texto em pt-BR com números naturais', () => {
    expect(compareSortValues('Fila 2', 'Fila 10', 1)).toBeLessThan(0)
    expect(compareSortValues('ágil', 'Beta', 1)).toBeLessThan(0)
  })
})
