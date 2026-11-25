/** Estado do menu lateral: aberto no celular, recolhido no computador e os números de cada tela. */
import { create } from 'zustand'
import type { ComponentProps } from 'react'
import type { AnalystStats } from '@/components/AnalystStats'

const RAIL_KEY = 'isa-menu-recolhido'
const readRail = () => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } }

interface NavState {
  mobileOpen: boolean
  rail: boolean
  /** Filas e contadores: vêm da página de chamados e ficam até ela mudar. */
  queues: { id: string; name: string }[]
  counts: Record<string, number>
  stats: ComponentProps<typeof AnalystStats>['stats'] | null
  online: string[]
  setMobileOpen: (open: boolean) => void
  toggleRail: () => void
  publish: (data: Partial<Pick<NavState, 'queues' | 'counts' | 'stats' | 'online'>>) => void
}

export const useNavStore = create<NavState>(set => ({
  mobileOpen: false,
  rail: readRail(),
  queues: [],
  counts: {},
  stats: null,
  online: [],
  setMobileOpen: mobileOpen => set({ mobileOpen }),
  toggleRail: () => set(s => {
    try { localStorage.setItem(RAIL_KEY, s.rail ? '0' : '1') } catch { /* sem armazenamento: só não persiste */ }
    return { rail: !s.rail }
  }),
  publish: data => set(data),
}))
