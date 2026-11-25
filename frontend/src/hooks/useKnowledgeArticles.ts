import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE_SIZES } from '@/components/ui'
import { apiErrorMessage } from '@/services/api'
import { knowledgeService } from '@/services/knowledgeService'
import type { KnowledgeArticleStatus, KnowledgeArticleSummary } from '@/types/knowledge'

export interface KnowledgeFilters {
  status: KnowledgeArticleStatus | ''
  categoryId: string
}

const NO_FILTERS: KnowledgeFilters = { status: '', categoryId: '' }

/** Lista paginada e filtrada dos artigos. Trocar filtro ou tamanho de página volta à primeira página. */
export function useKnowledgeArticles() {
  const [filters, setFilters] = useState(NO_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const [rows, setRows] = useState<KnowledgeArticleSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const request = ++latest.current
    const stale = () => request !== latest.current
    setLoading(true)
    setError(null)
    try {
      const result = await knowledgeService.list({
        page, pageSize, status: filters.status || undefined, categoryId: filters.categoryId || undefined,
      })
      if (stale()) return
      // A última página pode sumir: outro admin excluiu, ou o item excluído aqui era o único dela.
      if (!result.data.length && result.total > 0 && page > 1) {
        setPage(Math.ceil(result.total / pageSize))
        return
      }
      setRows(result.data)
      setTotal(result.total)
    } catch (err) {
      if (stale()) return
      setRows([])
      setTotal(0)
      setError(apiErrorMessage(err, 'Não foi possível carregar os artigos.'))
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [page, pageSize, filters])

  useEffect(() => { void reload() }, [reload])

  const filterBy = useCallback((patch: Partial<KnowledgeFilters>) => {
    setFilters(current => ({ ...current, ...patch }))
    setPage(1)
  }, [])

  const clearFilters = useCallback(() => filterBy(NO_FILTERS), [filterBy])

  const changePageSize = useCallback((size: number) => {
    setPageSize(size)
    setPage(1)
  }, [])

  return {
    rows, total, page, pageSize, filters, loading, error,
    filtered: !!(filters.status || filters.categoryId),
    reload, setPage, changePageSize, filterBy, clearFilters,
  }
}
