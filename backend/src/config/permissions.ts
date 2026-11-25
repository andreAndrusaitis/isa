export const SYSTEM_PERMISSIONS = [
  // Configurações
  'webhooks',
  'sla',
  'packages',
  'business_hours',
  'routing',
  'escalation',
  'inactivity',
  'reopen_sla',
  'auto_close',
  'ticket_types',
  'survey',
  'categories',
  'queues',
  // Operações & Gestão
  'dash_main',
  'survey_dashboard',
  'organograma',
  'audit',
  'macros',
  'orgs',
  'users',
  // Editar/apagar mensagens de outras pessoas nos chamados: opção por pessoa.
  'edit_messages',
  // Lixeira de chamados: nenhum perfil recebe por padrão (admin sempre pode).
  'trash',
  // E-mails enviados pelo sistema: só o admin libera (área de plataforma).
  'email_logs',
  // Projetos: liberações do módulo, separadas das áreas de chamados.
  'projects_reports',
  'projects_integrations',
  'projects_sprints',
] as const

export type SystemPermission = (typeof SYSTEM_PERMISSIONS)[number]

// Não é área: nenhum perfil recebe por padrão (admin sempre pode). Só o admin concede.
export const DELETE_TICKETS_PERMISSION = 'delete_tickets'

export const DEFAULT_ROLE_PERMISSIONS: Record<string, SystemPermission[]> = {
  admin: [...SYSTEM_PERMISSIONS],
  manager: ['dash_main', 'survey_dashboard', 'organograma', 'categories', 'queues', 'macros', 'audit', 'orgs', 'users', 'projects_reports', 'projects_integrations', 'projects_sprints'],
  supervisor: ['dash_main', 'survey_dashboard', 'organograma', 'categories', 'queues', 'macros', 'audit', 'orgs', 'users', 'edit_messages', 'projects_reports'],
  agent: ['orgs', 'users'],
  user: [],
}

/**
 * Só o que o admin concedeu (array customizado), sem o padrão do perfil. O
 * padrão (ex.: `orgs`/`users` de todo staff) liga menus; liberar uma AÇÃO de
 * área exige concessão explícita — senão analista ganharia criar/excluir empresa.
 */
export function userHasExplicitPermission(
  user: { role: string; permissions?: string[] | null } | null | undefined,
  permission: string
): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'user') return false
  return Array.isArray(user.permissions) && user.permissions.includes(permission)
}

// Regras de concessão (quem libera o quê para quem): access/grants.ts.

export function userHasPermission(
  user: { role: string; permissions?: string[] | null } | null | undefined,
  permission: string
): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'user') return false

  // Permissão explicitamente concedida quando o array foi customizado
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions.includes(permission)
  }

  // Permissão padrão do perfil (fallback se permissions for vazio ou não customizado)
  const defaultPerms = DEFAULT_ROLE_PERMISSIONS[user.role]
  if (defaultPerms && defaultPerms.includes(permission as SystemPermission)) {
    return true
  }

  return false
}
