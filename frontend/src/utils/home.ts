import type { AuthUser } from '@/store/auth'

// Telas iniciais de antes dos endereços por área: sessão guardada com uma
// delas recalcula (senão /supervisor → / → /supervisor viraria um laço).
const LEGACY_HOMES = new Set(['/portal', '/agent', '/supervisor', '/admin', '/gestao/dashboard'])

/**
 * Tela inicial pela regra do servidor (backend/src/access/session.ts), para a
 * sessão guardada antes de a sessão trazer `home`.
 */
export function legacyHomeOf(user: Pick<AuthUser, 'role' | 'modules' | 'capabilities'>): string {
  if (user.role === 'user') return '/solicitacoes'
  if (user.modules?.tickets === false) return user.modules?.projects ? '/projetos/semana' : user.modules?.documents ? '/documentos' : '/solicitacoes'
  if (user.role === 'agent') return '/chamados'
  if (user.role === 'admin') return '/gestao/dashboard'
  if (user.capabilities && !user.capabilities.includes('dashboard.view')) return '/chamados'
  return user.role === 'manager' ? '/gestao/carteira' : '/gestao/turno'
}

/**
 * Tela inicial da pessoa. Vem calculada pelo servidor na sessão; login, SSO,
 * o clique no logo e a raiz usam esta mesma função.
 */
export function homeOf(user: Pick<AuthUser, 'role' | 'modules' | 'home' | 'capabilities'>): string {
  if (user.home && !LEGACY_HOMES.has(user.home)) return user.home
  return legacyHomeOf(user)
}
