import { useState } from 'react'

export type SortValue = string | number | Date | null | undefined
export type SortDir = 1 | -1

// Ordenação por coluna clicável: ↑ → ↓ → volta à ordem original.
// `apply` é função pura — pode ser chamada depois de early returns.
export function useTableSort<K extends string>(initial: { key: K; dir: SortDir } | null = null) {
  const [sort, setSort] = useState(initial)

  const toggle = (key: K) => setSort(cur =>
    cur?.key !== key ? { key, dir: 1 } : cur.dir === 1 ? { key, dir: -1 } : null)

  function apply<T>(rows: T[], getters: Partial<Record<K, (row: T) => SortValue>>): T[] {
    const get = sort && getters[sort.key]
    if (!sort || !get) return rows
    return [...rows].sort((a, b) => compareSortValues(get(a), get(b), sort.dir))
  }

  const header = (key: K) => ({ dir: sort?.key === key ? sort.dir : null, onClick: () => toggle(key) })

  return { sort, toggle, apply, header }
}

// Vazios sempre no fim; números/datas numericamente; textos em pt-BR com números naturais.
export function compareSortValues(x: SortValue, y: SortValue, dir: SortDir): number {
  const ex = x == null || x === '' || (typeof x === 'number' && isNaN(x))
  const ey = y == null || y === '' || (typeof y === 'number' && isNaN(y))
  if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1
  const nx = x instanceof Date ? x.getTime() : x
  const ny = y instanceof Date ? y.getTime() : y
  const c = typeof nx === 'number' && typeof ny === 'number'
    ? nx - ny
    : String(nx).localeCompare(String(ny), 'pt-BR', { numeric: true, sensitivity: 'base' })
  return c * dir
}

// Ranks comuns para colunas de chamados
export const STATUS_RANK: Record<string, number> = { open: 0, in_progress: 1, pending: 2, resolved: 3, closed: 4 }
export const PRIORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }
// "REQ-11004" → 11004 (ordena pelo número, ignorando o prefixo do tipo)
export const ticketNumber = (t: { displayNumber?: string | number | null; display_number?: string | number | null; number?: number | null }) =>
  Number(String(t.displayNumber ?? t.display_number ?? t.number ?? '').match(/(\d+)$/)?.[1]) || null
