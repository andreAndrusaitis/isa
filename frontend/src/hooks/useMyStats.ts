import { useCallback, useEffect, useRef, useState } from 'react'
import { adminService } from '@/services/adminService'

export type MyStats = {
  resolvedToday: number
  resolvedTrend?: 'up' | 'down' | 'flat'
  slaCompliance: number
  avgResolutionMinutes?: number
  dueSoonCount?: number
  reopenedCount?: number
}

/**
 * "Meus indicadores" + equipe online da sidebar. Busca ao montar, a cada evento
 * de chamado (`scheduleRefresh`, agrupando rajadas do socket) e a cada minuto —
 * "vencendo em breve" e "online" mudam só com o passar do tempo.
 */
export function useMyStats(userId: string) {
  const [stats, setStats] = useState<MyStats | null>(null)
  const [onlineTeam, setOnlineTeam] = useState<any[]>([])
  const refresh = useCallback(() => adminService.getMeStats()
    .then((d: any) => {
      const { onlineTeam: team, ...rest } = d ?? {}
      setStats(rest)
      setOnlineTeam(team ?? [])
    })
    .catch(() => { /* indicador é acessório: mantém o último valor */ }), [userId])
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const scheduleRefresh = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(refresh, 1500)
  }, [refresh])
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 60_000)
    return () => { clearInterval(id); clearTimeout(timer.current) }
  }, [refresh])
  return { stats, onlineTeam, refresh, scheduleRefresh }
}
