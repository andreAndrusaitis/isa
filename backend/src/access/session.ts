/**
 * Tela inicial da pessoa, calculada no servidor uma vez por sessão. Usa os
 * endereços por área do frontend (frontend/src/access/routes.ts).
 */
import type { EffectiveModules } from '../services/moduleAccess'

export function homeFor(role: string, modules: EffectiveModules, capabilities: readonly string[] = []): string {
  if (role === 'user') return '/solicitacoes'
  // Equipe sem Chamados: Projetos, depois Documentos, ou só as próprias solicitações.
  if (modules.tickets === false) return modules.projects ? '/projetos/semana' : modules.documents ? '/documentos' : '/solicitacoes'
  if (role === 'agent') return '/chamados'
  // Cada cargo abre na sua pergunta: o turno, a carteira de clientes ou o painel.
  if (!capabilities.includes('dashboard.view')) return '/chamados'
  if (role === 'admin') return '/gestao/dashboard'
  return role === 'manager' ? '/gestao/carteira' : '/gestao/turno'
}
