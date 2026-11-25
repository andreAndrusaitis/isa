import { describe, expect, it, vi } from 'vitest'
import { filterSlash, slashItems } from './slash'

describe('menu /', () => {
  const items = slashItems({ pickImage: vi.fn(), pickPage: vi.fn() })
  it('acha sem acento e por apelido', () => {
    expect(filterSlash(items, 'titulo').map(i => i.title)).toEqual(['Título 1', 'Título 2', 'Título 3'])
    expect(filterSlash(items, 'CODIGO')[0].title).toBe('Código')
    expect(filterSlash(items, 'todo')[0].title).toBe('Tarefas')
    expect(filterSlash(items, 'xyz')).toEqual([])
    expect(filterSlash(items, '')).toHaveLength(items.length)
  })
})
