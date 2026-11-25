import { describe, it, expect, beforeEach } from 'vitest'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters } from './filterStorage'

beforeEach(() => localStorage.clear())

describe('getSavedFilters', () => {
  it('returns empty array when key is missing', () => {
    expect(getSavedFilters('agent')).toEqual([])
  })

  it('returns parsed filters from localStorage', () => {
    const sf = [{ id: '1', name: 'Urgentes', filters: { fStatus: 'open' } }]
    localStorage.setItem('sd-saved-filters-agent', JSON.stringify(sf))
    expect(getSavedFilters('agent')).toEqual(sf)
  })

  it('returns empty array when localStorage has invalid JSON', () => {
    localStorage.setItem('sd-saved-filters-agent', 'INVALID')
    expect(getSavedFilters('agent')).toEqual([])
  })
})

describe('saveFilter', () => {
  it('persists a new filter', () => {
    saveFilter('agent', { id: 'a1', name: 'Teste', filters: { fPriority: 'high' } })
    expect(getSavedFilters('agent')).toHaveLength(1)
    expect(getSavedFilters('agent')[0].name).toBe('Teste')
  })

  it('replaces a filter with the same id', () => {
    saveFilter('agent', { id: 'a1', name: 'V1', filters: {} })
    saveFilter('agent', { id: 'a1', name: 'V2', filters: {} })
    expect(getSavedFilters('agent')).toHaveLength(1)
    expect(getSavedFilters('agent')[0].name).toBe('V2')
  })

  it('uses separate namespace per pageKey', () => {
    saveFilter('agent', { id: '1', name: 'A', filters: {} })
    expect(getSavedFilters('supervisor')).toHaveLength(0)
  })
})

describe('deleteFilter', () => {
  it('removes filter by id', () => {
    saveFilter('agent', { id: 'x', name: 'X', filters: {} })
    saveFilter('agent', { id: 'y', name: 'Y', filters: {} })
    deleteFilter('agent', 'x')
    const result = getSavedFilters('agent')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('y')
  })

  it('does nothing when id does not exist', () => {
    saveFilter('agent', { id: 'z', name: 'Z', filters: {} })
    deleteFilter('agent', 'nonexistent')
    expect(getSavedFilters('agent')).toHaveLength(1)
  })
})

describe('countActiveFilters', () => {
  it('returns 0 when all filters match defaults', () => {
    expect(countActiveFilters({ fStatus: 'all', fPriority: 'all' }, { fStatus: 'all', fPriority: 'all' })).toBe(0)
  })

  it('counts each key that differs from default', () => {
    expect(countActiveFilters({ fStatus: 'open', fPriority: 'high' }, { fStatus: 'all', fPriority: 'all' })).toBe(2)
  })

  it('handles boolean fields', () => {
    expect(countActiveFilters({ fUnassigned: true }, { fUnassigned: false })).toBe(1)
  })
})
