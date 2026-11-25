import { describe, it, expect } from 'vitest'
import { specialFormFieldSchema } from './categories'

describe('Special form select fields', () => {
  const base = { key: 'ambientes', label: 'Ambientes', type: 'select' as const, required: true }

  it('accepts configured options and defaults to single selection', () => {
    const field = specialFormFieldSchema.parse({
      ...base,
      options: [{ value: 'production', label: 'Produção' }],
    })

    expect(field.multiple).toBe(false)
  })

  it('accepts multiple selection when enabled', () => {
    const field = specialFormFieldSchema.parse({
      ...base,
      multiple: true,
      options: [
        { value: 'production', label: 'Produção' },
        { value: 'homologation', label: 'Homologação' },
      ],
    })

    expect(field.multiple).toBe(true)
  })

  it.each([
    ['without options', { ...base }],
    ['with duplicate option values', { ...base, options: [{ value: 'prod', label: 'Produção' }, { value: 'prod', label: 'Produção 2' }] }],
  ])('rejects select %s', (_label, input) => {
    expect(() => specialFormFieldSchema.parse(input)).toThrow()
  })
})
