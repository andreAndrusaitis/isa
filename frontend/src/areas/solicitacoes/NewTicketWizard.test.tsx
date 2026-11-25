import { describe, expect, it } from 'vitest'
import { openingSecondsSince, updateSpecialSelectionValue, validateSpecialData } from './NewTicketWizard'

describe('special select values', () => {
  it('stores one value for single selection', () => {
    expect(updateSpecialSelectionValue(undefined, false, 'production')).toBe('production')
    expect(updateSpecialSelectionValue('production', false, 'homologation')).toBe('homologation')
  })

  it('toggles values for multiple selection', () => {
    expect(updateSpecialSelectionValue([], true, 'production')).toEqual(['production'])
    expect(updateSpecialSelectionValue(['production'], true, 'homologation')).toEqual(['production', 'homologation'])
    expect(updateSpecialSelectionValue(['production', 'homologation'], true, 'production')).toEqual(['homologation'])
  })

  it('rejects required empty selections', () => {
    expect(validateSpecialData(
      [{ key: 'ambientes', label: 'Ambientes', type: 'select', required: true, multiple: true }],
      { ambientes: [] },
    )).toMatch(/Ambientes/)
    expect(validateSpecialData(
      [{ key: 'ambiente', label: 'Ambiente', type: 'select', required: true }],
      { ambiente: 'production' },
    )).toBeNull()
  })
})

describe('tempo de abertura', () => {
  it('conta segundos inteiros desde que o formulário abriu', () => {
    expect(openingSecondsSince(1_000, 96_400)).toBe(95)
    expect(openingSecondsSince(1_000, 1_400)).toBe(0)
  })

  it('fica entre 0 e 1 dia (aba esquecida aberta não distorce a média)', () => {
    expect(openingSecondsSince(5_000, 1_000)).toBe(0)
    expect(openingSecondsSince(0, 3 * 86_400_000)).toBe(86_400)
  })
})
