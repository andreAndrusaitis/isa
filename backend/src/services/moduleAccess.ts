import prisma from '../config/prisma'

export interface EffectiveModules {
  tickets: boolean
  projects: boolean
  documents: boolean
}

const ADMIN_MODULES: EffectiveModules = { tickets: true, projects: true, documents: true }
const DEFAULT_MODULES: EffectiveModules = { tickets: true, projects: false, documents: false }

type ModuleFlags = { module_tickets: boolean | null; module_projects: boolean | null; module_documents: boolean | null }

/**
 * Sobe a hierarquia (manager_id) até o primeiro usuário com role=manager e
 * devolve os botões dele (null = padrão). Null se não houver gerente na cadeia.
 */
async function resolveManagerModules(managerId: string, depth = 0): Promise<ModuleFlags | null> {
  if (depth > 3) return null // proteção contra hierarquia inesperadamente profunda
  const mgr = await prisma.user.findUnique({
    where: { id: managerId },
    select: { role: true, manager_id: true, module_tickets: true, module_projects: true, module_documents: true },
  })
  if (!mgr) return null
  if (mgr.role === 'manager') return mgr
  if (mgr.manager_id) return resolveManagerModules(mgr.manager_id, depth + 1)
  return null
}

/**
 * Calcula o acesso efetivo a módulo (chamados/projetos/documentos) de um usuário.
 * - admin: todos os módulos sempre liberados.
 * - usuário final: padrão (só Chamados).
 * - cada botão é independente: o da própria pessoa, senão o do gerente da
 *   cadeia (sobe manager_id), senão o padrão (Chamados ligado; Projetos e Documentos desligados).
 *   Gravar só um dos botões não congela o outro.
 */
export async function getEffectiveModules(userId: string, role: string): Promise<EffectiveModules> {
  if (role === 'admin') return ADMIN_MODULES
  if (role === 'user') return DEFAULT_MODULES // cliente final nunca usa Projetos nem Documentos, mesmo com a coluna marcada

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { manager_id: true, module_tickets: true, module_projects: true, module_documents: true },
  })
  if (!user) return DEFAULT_MODULES

  const needsInherit = role !== 'manager' && user.manager_id && (user.module_tickets === null || user.module_projects === null || user.module_documents === null)
  const inherited = needsInherit ? await resolveManagerModules(user.manager_id!) : null

  return {
    tickets: user.module_tickets ?? inherited?.module_tickets ?? DEFAULT_MODULES.tickets,
    projects: user.module_projects ?? inherited?.module_projects ?? DEFAULT_MODULES.projects,
    documents: user.module_documents ?? inherited?.module_documents ?? DEFAULT_MODULES.documents,
  }
}

/**
 * Ids de quem tem o módulo Documentos ligado, com a mesma regra acima calculada em
 * memória (uma consulta só): serve à busca de pessoas para compartilhar.
 */
export async function documentsModuleUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { role: { not: 'user' } },
    select: { id: true, role: true, manager_id: true, module_documents: true, active: true, deleted_at: true, is_service_account: true },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  const inherited = (managerId: string | null) => {
    for (let depth = 0, id = managerId; id && depth <= 3; depth++) {
      const mgr = byId.get(id)
      if (!mgr) return null
      if (mgr.role === 'manager') return mgr.module_documents
      id = mgr.manager_id
    }
    return null
  }
  return rows
    .filter(r => r.active && !r.deleted_at && !r.is_service_account)
    .filter(r => r.role === 'admin' || (r.module_documents ?? (r.role === 'manager' ? null : inherited(r.manager_id)) ?? DEFAULT_MODULES.documents))
    .map(r => r.id)
}
