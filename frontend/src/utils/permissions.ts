import { AuthUser } from '@/store/auth'
import { Role } from '@/types'

export interface SystemArea {
  id: string
  name: string
  description: string
  category: 'config' | 'management' | 'operations' | 'projects'
  view: string
  defaultRoles: Role[]
}

export const SYSTEM_AREAS: SystemArea[] = [
  // ── Configurações Globais / Administrativas ──
  {
    id: 'webhooks',
    name: 'Webhooks',
    description: 'Gerenciamento de endpoints e entregas de webhooks externos',
    category: 'config',
    view: 'admin_webhooks',
    defaultRoles: ['admin'],
  },
  {
    id: 'sla',
    name: 'Planos & SLA',
    description: 'Configuração de metas e tempos de resposta e resolução por tier',
    category: 'config',
    view: 'admin_sla',
    defaultRoles: ['admin'],
  },
  {
    id: 'packages',
    name: 'Pacotes',
    description: 'Catálogo de complementos e pacotes alocáveis aos planos de SLA',
    category: 'config',
    view: 'admin_packages',
    defaultRoles: ['admin'],
  },
  {
    id: 'business_hours',
    name: 'Expediente',
    description: 'Definição de jornada útil e feriados para contagem de SLA',
    category: 'config',
    view: 'admin_business_hours',
    defaultRoles: ['admin'],
  },
  {
    id: 'routing',
    name: 'Roteamento',
    description: 'Regras de direcionamento e distribuição automática de chamados',
    category: 'config',
    view: 'admin_routing',
    defaultRoles: ['admin'],
  },
  {
    id: 'escalation',
    name: 'Escalonamento',
    description: 'Políticas de escalonamento automático e reatribuição para fila N2',
    category: 'config',
    view: 'admin_escalation',
    defaultRoles: ['admin'],
  },
  {
    id: 'inactivity',
    name: 'Inatividade',
    description: 'Parâmetros de detecção e redirecionamento de analistas ociosos',
    category: 'config',
    view: 'admin_inactivity',
    defaultRoles: ['admin'],
  },
  {
    id: 'reopen_sla',
    name: 'SLA de Reabertura',
    description: 'Prazos e parâmetros de atendimento para chamados reabertos',
    category: 'config',
    view: 'admin_reopen_sla',
    defaultRoles: ['admin'],
  },
  {
    id: 'auto_close',
    name: 'Fechamento automático',
    description: 'Prazo para chamados Resolvidos passarem a Fechado e histórico dos fechamentos',
    category: 'config',
    view: 'admin_auto_close',
    defaultRoles: ['admin'],
  },
  {
    id: 'ticket_types',
    name: 'Tipos de chamado',
    description: 'Habilitação e classificação de chamados (Incidente, Requisição, etc.)',
    category: 'config',
    view: 'admin_ticket_types',
    defaultRoles: ['admin'],
  },
  {
    id: 'survey',
    name: 'Pesquisas',
    description: 'Criação e edição de modelos e perguntas de satisfação',
    category: 'config',
    view: 'admin_survey',
    defaultRoles: ['admin'],
  },
  {
    id: 'categories',
    name: 'Categorias & Subcategorias',
    description: 'Gestão de categorias, subcategorias e formulários dinâmicos',
    category: 'config',
    view: 'admin_categories',
    defaultRoles: ['admin', 'manager', 'supervisor'],
  },
  {
    id: 'queues',
    name: 'Filas de atendimento',
    description: 'Criação, ativação e configuração de filas de atendimento',
    category: 'config',
    view: 'admin_queues',
    defaultRoles: ['admin', 'manager', 'supervisor'],
  },

  // ── Operações & Gestão ──
  {
    id: 'dash_main',
    name: 'Painel',
    description: 'Métricas analíticas, conformidade de SLA e produtividade',
    category: 'management',
    view: 'dash_main',
    defaultRoles: ['admin', 'manager', 'supervisor'],
  },
  {
    id: 'survey_dashboard',
    name: 'Pesquisa de satisfação',
    description: 'Dashboard de avaliações, métricas CSAT e respostas de clientes',
    category: 'management',
    view: 'survey_dashboard',
    defaultRoles: ['admin', 'manager', 'supervisor'],
  },
  {
    id: 'organograma',
    name: 'Organograma',
    description: 'Estrutura hierárquica e subordinação de analistas e supervisores',
    category: 'management',
    view: 'organograma',
    defaultRoles: ['admin', 'manager', 'supervisor'],
  },
  {
    id: 'audit',
    name: 'Auditoria',
    description: 'Histórico de eventos de segurança, transições e alterações',
    category: 'management',
    view: 'admin_audit',
    defaultRoles: ['admin', 'manager', 'supervisor'],
  },
  {
    id: 'email_logs',
    name: 'Logs de e-mail',
    description: 'E-mails enviados pelo sistema e situação da entrega',
    category: 'config',
    view: 'admin_email_logs',
    defaultRoles: ['admin'],
  },
  {
    // Opção por pessoa; TM vem com ela ligada. Sem tela própria (vale dentro do chamado).
    id: 'edit_messages',
    name: 'Editar mensagens de outras pessoas',
    description: 'Corrigir ou apagar mensagens enviadas por outras pessoas nos chamados',
    category: 'operations',
    view: 'ticket_messages_moderation',
    defaultRoles: ['supervisor'],
  },
  {
    id: 'trash',
    name: 'Lixeira',
    description: 'Chamados excluídos: restaurar ou excluir definitivamente',
    category: 'management',
    view: 'admin_trash',
    defaultRoles: ['admin'],
  },
  {
    id: 'macros',
    name: 'Respostas prontas',
    description: 'Modelos de respostas rápidas pré-definidas para o atendimento',
    category: 'operations',
    view: 'admin_macros',
    defaultRoles: ['admin', 'manager', 'supervisor'],
  },
  {
    id: 'orgs',
    name: 'Empresas / organizações',
    description: 'Visualização e gestão de empresas cadastradas e carteiras',
    category: 'operations',
    view: 'admin_orgs',
    defaultRoles: ['admin', 'manager', 'supervisor', 'agent'],
  },
  {
    id: 'users',
    name: 'Gestão de usuários',
    description: 'Administração de contas, perfis e controle de permissões',
    category: 'operations',
    view: 'admin_users',
    defaultRoles: ['admin', 'manager', 'supervisor', 'agent'],
  },

  // ── Projetos (liberações do módulo, separadas das áreas de chamados) ──
  // Mesmas regras do servidor (capacidades projects.*): o cargo dá; a ficha libera para os demais.
  {
    id: 'projects_reports',
    name: 'Relatórios de projetos',
    description: 'Dashboards do portfólio, carga da equipe, horas, chamados vinculados e dossiê',
    category: 'projects',
    view: 'projetos_dashboards',
    defaultRoles: ['admin', 'manager', 'supervisor'],
  },
  {
    id: 'projects_integrations',
    name: 'Integrações de projetos',
    description: 'Webhooks e chaves da API pública de Projetos',
    category: 'projects',
    view: 'projetos_webhooks',
    defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'projects_sprints',
    name: 'Calendário de sprints e pastas',
    description: 'Gerenciar o calendário de sprints e organizar as pastas da navegação de Projetos',
    category: 'projects',
    view: 'projetos_sprints',
    defaultRoles: ['admin', 'manager'],
  },
]

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: SYSTEM_AREAS.map(a => a.id),
  manager: ['dash_main', 'survey_dashboard', 'organograma', 'categories', 'queues', 'macros', 'audit', 'orgs', 'users', 'projects_reports', 'projects_integrations', 'projects_sprints'],
  supervisor: ['dash_main', 'survey_dashboard', 'organograma', 'categories', 'queues', 'macros', 'audit', 'orgs', 'users', 'edit_messages', 'projects_reports'],
  agent: ['orgs', 'users'],
  user: [],
}

/**
 * Retorna se o usuário possui acesso à área especificada (por ID de área ou por view param).
 */
export function hasAreaPermission(
  user: Pick<AuthUser, 'role' | 'permissions'> | null | undefined,
  areaOrView: string
): boolean {
  if (!user) return false
  if (user.role === 'admin') return true

  // Normaliza o view param para buscar a área
  const area = SYSTEM_AREAS.find(a => a.id === areaOrView || a.view === areaOrView)
  if (!area) {
    // Se não é uma área administrativa cadastrada (ex: fila normal, meus chamados, novo chamado),
    // o acesso é livre dentro do perfil do usuário.
    return true
  }

  // Usuário final não possui acesso a áreas administrativas
  if (user.role === 'user') return false

  // 1. Verifica permissão concedida explicitamente no array permissions do usuário
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions.includes(area.id)
  }

  // 2. Se permissions não foi customizado ainda (array vazio/undefined), recorre ao padrão do perfil
  const defaultPerms = DEFAULT_ROLE_PERMISSIONS[user.role] || []
  return defaultPerms.includes(area.id)
}

/**
 * Retorna todas as permissões ativas para um usuário (incluindo as concedidas ou as do perfil padrão).
 */
export function getEffectivePermissions(
  user: Pick<AuthUser, 'role' | 'permissions'> | null | undefined
): string[] {
  if (!user) return []
  if (user.role === 'admin') return SYSTEM_AREAS.map(a => a.id)

  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions
  }

  return DEFAULT_ROLE_PERMISSIONS[user.role] || []
}

// Não é área: desabilitada por padrão para todos, concedida individualmente pelo admin.
export const DELETE_TICKETS_PERMISSION = 'delete_tickets'

export function canDeleteTickets(user: Pick<AuthUser, 'role' | 'permissions'> | null | undefined): boolean {
  if (!user) return false
  return user.role === 'admin' || !!user.permissions?.includes(DELETE_TICKETS_PERMISSION)
}

/**
 * Editar/apagar mensagens de outras pessoas no chamado. Mesma regra do servidor
 * (capacidade tickets.messages.moderate): opção da ficha, TM por padrão, nunca o admin.
 */
export function canModerateMessages(user: Pick<AuthUser, 'role' | 'permissions'>): boolean {
  if (user.role === 'admin' || user.role === 'user') return false
  return hasAreaPermission(user, 'edit_messages')
}
