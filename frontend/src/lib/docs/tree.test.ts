import { describe, expect, it } from 'vitest'
import { buildTree, pathTo, positionFor, subtreeIds } from './tree'
import type { DocTreeNode } from '@/types/docs'

const n = (id: string, parentId: string | null, position: number): DocTreeNode => ({ id, parentId, position, title: id, icon: null, updatedAt: '' })
const nodes = [n('a', null, 1000), n('b', null, 2000), n('a1', 'a', 10), n('a2', 'a', 20), n('a1x', 'a1', 1), n('orfa', 'sumiu', 5)]

describe('árvore de páginas', () => {
  it('monta na ordem e leva órfãs para a raiz', () => {
    const t = buildTree(nodes)
    expect(t.map(i => i.id)).toEqual(['orfa', 'a', 'b'])
    expect(t[1].children.map(i => i.id)).toEqual(['a1', 'a2'])
  })
  it('subárvore e caminho', () => {
    expect([...subtreeIds(nodes, 'a')].sort()).toEqual(['a', 'a1', 'a1x', 'a2'])
    expect(pathTo(nodes, 'a1x')).toEqual(['a1', 'a'])
  })
  it('posição antes, no começo e no fim', () => {
    expect(positionFor(nodes, 'a', 'a2')).toBe(15)
    expect(positionFor(nodes, 'a', 'a1')).toBeLessThan(10)
    expect(positionFor(nodes, 'a', null)).toBeGreaterThan(20)
    expect(positionFor(nodes, 'a1x', null)).toBe(1024)
    expect(positionFor(nodes, 'a', 'a2', 'a1')).toBeLessThan(20)
  })
})
