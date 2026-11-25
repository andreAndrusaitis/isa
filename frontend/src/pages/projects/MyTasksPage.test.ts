import { describe, it, expect } from 'vitest'
import { mergeColumnPrefs } from './MyTasksPage'

describe('mergeColumnPrefs', () => {
  it('mantém a ordem salva, descarta chaves extintas e anexa colunas novas ocultas', () => {
    const merged = mergeColumnPrefs([
      { key: 'seq', visible: true },
      { key: 'project', visible: true },
      { key: 'title', visible: false },
    ])
    expect(merged.slice(0, 2)).toEqual([{ key: 'project', visible: true }, { key: 'title', visible: false }])
    expect(merged.some((c) => (c.key as string) === 'seq')).toBe(false)
    expect(merged.find((c) => c.key === 'sprint')).toEqual({ key: 'sprint', visible: false })
    expect(new Set(merged.map((c) => c.key)).size).toBe(merged.length)
  })
})
