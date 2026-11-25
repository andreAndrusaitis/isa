import { AppError } from '../middlewares/errorHandler'

// Rótulos de negócio exibidos ao usuário (espelham frontend/src/utils/permissions.ts).
export const ROLE_LABEL: Record<string, string> = {
  user: 'Usuário final',
  agent: 'Analista',
  supervisor: 'Ticket Manager',
  manager: 'Gerente',
  admin: 'Admin',
}

export const AREA_LABEL: Record<string, string> = {
  webhooks: 'Webhooks',
  projects_reports: 'Relatórios de Projetos',
  projects_integrations: 'Integrações de Projetos',
  projects_sprints: 'Calendário de sprints e pastas',
  sla: 'Planos & SLA',
  packages: 'Pacotes Adicionais',
  business_hours: 'Horário Comercial',
  routing: 'Filas & Roteamento',
  escalation: 'Escalonamento',
  inactivity: 'Redirecionamento por Inatividade',
  reopen_sla: 'SLA de Reabertura',
  auto_close: 'Fechamento Automático',
  ticket_types: 'Tipos de Chamado',
  survey: 'Modelos de Pesquisa',
  categories: 'Categorias & Subcategorias',
  queues: 'Filas de Atendimento',
  dash_main: 'Dashboard Gerencial',
  survey_dashboard: 'Pesquisa de Satisfação',
  organograma: 'Organograma',
  audit: 'Auditoria',
  macros: 'Macros de Atendimento',
  orgs: 'Empresas / Organizações',
  users: 'Gestão de Usuários',
  delete_tickets: 'Excluir chamados',
  trash: 'Lixeira',
}

export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role

export function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

// Toda negação responde: o que foi bloqueado, por quê e a quem pedir.
export function forbidden(code: string, message: string) {
  return new AppError(403, message, code)
}

export function roleDenied(allowed: string[], userRole: string, action = 'Esta ação') {
  const names = allowed.filter(r => r !== 'admin').map(roleLabel)
  const who = names.length ? joinPt(names) : 'Admin'
  return forbidden('ROLE_NOT_ALLOWED', `${action} é permitida apenas para ${who}. Seu perfil é ${roleLabel(userRole)}.`)
}

export function areaDenied(area: string, userRole: string) {
  return forbidden(
    'PERMISSION_REQUIRED',
    `Esta ação exige a permissão "${AREA_LABEL[area] ?? area}", que não está habilitada no seu perfil (${roleLabel(userRole)}). Peça ao administrador para concedê-la em Usuários › Permissões.`,
  )
}

export const ADMIN_READ_ONLY_MESSAGE =
  'Administradores têm acesso somente leitura aos chamados: podem consultar, mas não alterar, responder, reabrir ou escalonar. Para atuar, use uma conta de Analista, Ticket Manager ou Gerente.'

export const adminReadOnly = () => forbidden('ADMIN_READ_ONLY', ADMIN_READ_ONLY_MESSAGE)

export const TICKET_DENIAL = {
  SCOPE_NOT_CONFIGURED: () =>
    'Você ainda não tem empresas na sua carteira, então não pode ver nem atender chamados. Peça ao administrador ou ao seu gerente para configurar as empresas que você atende.',
  ORG_OUT_OF_SCOPE: (org: string | null | undefined) =>
    `Este chamado é da empresa ${org ?? '(sem empresa definida)'}, que não está na sua carteira. Peça ao administrador para incluí-la na sua carteira (ou na do seu gerente).`,
  NO_QUEUES: () =>
    'Você não está vinculado a nenhuma fila de atendimento, então não pode ver nem atender chamados. Peça ao seu gestor para incluir você em uma fila.',
  QUEUE_NOT_ASSIGNED: (queue: string | null | undefined) =>
    `Este chamado está na fila ${queue ?? '(sem fila)'}, à qual você não está vinculado. Peça ao seu gestor para incluir você na fila ou para escalonar o chamado para você.`,
  NOT_OWN_TICKET: () =>
    'Este chamado foi aberto por outra pessoa. Você só pode ver os chamados que você abriu.',
} as const
