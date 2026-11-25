import { useCallback, useEffect, useRef, useState } from 'react'
import { ticketService, type TicketPageQuery } from '@/services/ticketService'
import { PAGE_SIZES } from '@/components/ui/Pagination'
import type { Ticket } from '@/types'

const PAGE_SIZE_KEY = 'isa-ticket-page-size'

function readPageSize(): number {
  try {
    const v = Number(localStorage.getItem(PAGE_SIZE_KEY))
    return (PAGE_SIZES as readonly number[]).includes(v) ? v : PAGE_SIZES[0]
  } catch {
    return PAGE_SIZES[0]
  }
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** "AAAA-MM-DD" do <input type=date> → ISO no início/fim do dia LOCAL. */
export const dayStartIso = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined)
export const dayEndIso = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined)

/** Contadores da sidebar vindos do servidor (`{ total, my, [queueId]: n }`), com refresh agrupado. */
export function useTicketCounts(filters: Parameters<typeof ticketService.getCounts>[0] = {}) {
  const key = JSON.stringify(filters)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const refresh = useCallback(() => ticketService.getCounts(JSON.parse(key)).then(setCounts).catch(() => {}), [key])
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const scheduleRefresh = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(refresh, 800)
  }, [refresh])
  useEffect(() => { refresh(); return () => clearTimeout(timer.current) }, [refresh])
  return { counts, refresh, scheduleRefresh }
}

/** Colunas clicáveis → ordenação do servidor; sem clique, usa o "Ordenar por". */
export function serverSort<K extends string>(
  col: { key: K; dir: 1 | -1 } | null,
  colMap: Partial<Record<K, NonNullable<TicketPageQuery['sort']>>>,
  fallback: Pick<TicketPageQuery, 'sort' | 'dir'>,
): Pick<TicketPageQuery, 'sort' | 'dir'> {
  const sort = col && colMap[col.key]
  return sort ? { sort, dir: col.dir === 1 ? 'asc' : 'desc' } : fallback
}

/**
 * Uma página de chamados filtrada/ordenada no servidor. Mudar a query volta para a
 * página 1; `scheduleReload` agrupa rajadas de eventos de socket num único fetch.
 */
export function useTicketPage(query: TicketPageQuery, { enabled = true }: { enabled?: boolean } = {}) {
  const key = JSON.stringify(query)
  const [pageState, setPageState] = useState({ key, page: 1 })
  const page = pageState.key === key ? pageState.page : 1
  const [pageSize, setPageSizeState] = useState(readPageSize)
  const [rows, setRows] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const res = await ticketService.getTicketsPage({ ...JSON.parse(key), page, pageSize })
      if (id !== reqId.current) return
      // Página esvaziou (ex.: último item resolvido/excluído) → volta uma
      if (res.data.length === 0 && page > 1 && res.total > 0) {
        setPageState({ key, page: Math.ceil(res.total / pageSize) })
        return
      }
      setRows(res.data)
      setTotal(res.total)
      setError(false)
    } catch {
      if (id === reqId.current) setError(true)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [key, page, pageSize])

  useEffect(() => {
    if (enabled) load()
  }, [load, enabled])

  // Debounce estável (handlers de socket capturam a 1ª versão)
  const loadRef = useRef(load)
  loadRef.current = load
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const scheduleReload = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => loadRef.current(), 800)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const setPage = useCallback((p: number) => setPageState({ key, page: p }), [key])
  const setPageSize = useCallback((s: number) => {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(s)) } catch { /* sem storage: só não lembra */ }
    setPageSizeState(s)
    setPageState({ key, page: 1 })
  }, [key])

  return { rows, setRows, total, page, setPage, pageSize, setPageSize, loading, error, reload: load, scheduleReload }
}
