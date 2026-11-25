import { describe, it, expect } from 'vitest'
import { multi } from './multiFilter'

describe('multi (filtros multivalorados)', () => {
  it('ignora vazio/all, mantém valor único e vira `in` com vários', () => {
    expect(multi(undefined)).toBeUndefined()
    expect(multi('')).toBeUndefined()
    expect(multi('all')).toBeUndefined()
    expect(multi('high')).toBe('high')
    expect(multi('high,low')).toEqual({ in: ['high', 'low'] })
  })
})
