import { useEffect, useState } from 'react'
import { adminService } from '@/services/adminService'
import type { UserScope } from '@/types'

/** Escopo efetivo de um usuário (ex.: o chefe de quem está sendo editado). null = sem usuário ou sem acesso. */
export function useUserScope(userId: string | null | undefined) {
  const [scope, setScope] = useState<UserScope | null>(null)
  useEffect(() => {
    if (!userId) { setScope(null); return }
    let alive = true
    adminService.getUserScope(userId)
      .then(s => { if (alive) setScope(s) })
      .catch(() => { if (alive) setScope(null) })
    return () => { alive = false }
  }, [userId])
  return scope
}
