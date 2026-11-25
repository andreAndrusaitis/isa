import { useEffect, useState } from 'react'
import { adminService } from '@/services/adminService'
import type { BusinessHours } from '@/utils/businessTime'

// Um fetch por sessão, compartilhado por todos os contadores de SLA da tela.
// Mudança de horário pelo admin só reflete após recarregar a página.
let cached: Promise<BusinessHours | null> | null = null

/** Horário comercial + feriados; null enquanto carrega (ou se falhar). */
export function useBusinessHours() {
  const [cfg, setCfg] = useState<BusinessHours | null>(null)
  useEffect(() => {
    cached ??= adminService.getBusinessHours().catch(() => { cached = null; return null })
    let alive = true
    cached.then(c => { if (alive) setCfg(c) })
    return () => { alive = false }
  }, [])
  return cfg
}
