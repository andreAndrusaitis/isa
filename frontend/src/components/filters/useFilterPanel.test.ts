import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilterPanel } from './useFilterPanel'

beforeEach(() => localStorage.clear())

describe('useFilterPanel', () => {
  const defaults = { status: 'all', priority: 'all', dateFrom: '', dateTo: '' }

  it('conta filtros ativos, salva, aplica um salvo e limpa', () => {
    const { result } = renderHook(() => useFilterPanel('teste', defaults))
    act(() => result.current.set('priority', 'high,critical'))
    act(() => result.current.dropdownProps.onDateFromChange('2026-10-01'))
    expect(result.current.activeCount).toBe(2)
    act(() => result.current.dropdownProps.onSaveNew('Urgentes'))
    expect(result.current.dropdownProps.savedFilters.map((f) => f.name)).toEqual(['Urgentes'])

    act(() => result.current.clear())
    expect(result.current.activeCount).toBe(0)
    act(() => result.current.dropdownProps.onSelectSaved(result.current.dropdownProps.savedFilters[0]))
    expect(result.current.values).toMatchObject({ priority: 'high,critical', dateFrom: '2026-10-01' })
    expect(result.current.buttonProps.activeSavedFilter?.name).toBe('Urgentes')
  })

  it('outra chave (outro projeto) volta aos padrões e tem seus próprios salvos', () => {
    const { result, rerender } = renderHook(({ key }) => useFilterPanel(key, defaults), { initialProps: { key: 'p1' } })
    act(() => result.current.set('status', 's1'))
    act(() => result.current.dropdownProps.onSaveNew('Meu'))
    rerender({ key: 'p2' })
    expect(result.current.values.status).toBe('all')
    expect(result.current.dropdownProps.savedFilters).toEqual([])
  })
})
