import type { DocTreeNode } from '@/types/docs'

export interface TreeItem extends DocTreeNode { children: TreeItem[] }

export function buildTree(nodes: DocTreeNode[]): TreeItem[] {
  const map = new Map<string, TreeItem>(nodes.map(n => [n.id, { ...n, children: [] }]))
  const roots: TreeItem[] = []
  for (const n of map.values()) {
    const parent = n.parentId ? map.get(n.parentId) : undefined
    ;(parent ? parent.children : roots).push(n)
  }
  const sort = (list: TreeItem[]) => { list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)); list.forEach(i => sort(i.children)) }
  sort(roots)
  return roots
}

/** A página e tudo o que está dentro dela (destinos proibidos ao mover). */
export function subtreeIds(nodes: DocTreeNode[], id: string): Set<string> {
  const out = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const n of nodes) if (n.parentId && out.has(n.parentId) && !out.has(n.id)) { out.add(n.id); grew = true }
  }
  return out
}

/** Posição para ficar logo antes de `beforeId` (ou no fim) entre os irmãos. */
export function positionFor(nodes: DocTreeNode[], parentId: string | null, beforeId: string | null, movingId?: string): number {
  const siblings = nodes.filter(n => n.parentId === parentId && n.id !== movingId).sort((a, b) => a.position - b.position)
  const at = beforeId ? siblings.findIndex(n => n.id === beforeId) : -1
  if (at < 0) return (siblings[siblings.length - 1]?.position ?? 0) + 1024
  const next = siblings[at].position
  const prev = at > 0 ? siblings[at - 1].position : next - 2048
  return (prev + next) / 2
}

export function pathTo(nodes: DocTreeNode[], id: string): string[] {
  const by = new Map(nodes.map(n => [n.id, n]))
  const out: string[] = []
  for (let n = by.get(id); n?.parentId && out.length < 50; n = by.get(n.parentId)) out.push(n.parentId)
  return out
}
