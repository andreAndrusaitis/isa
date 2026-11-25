/**
 * Endereço de cada tela, por área. Fonte única para navegação, menu e
 * redirecionamento dos endereços antigos (?v=).
 */
export type Area = 'chamados' | 'solicitacoes' | 'gestao' | 'cadastros' | 'configuracoes' | 'admin'

export interface ScreenRoute {
  /** Identificador da tela usado pelas páginas de hoje (o antigo ?v=). */
  view: string
  path: string
  area: Area
}

export const SCREENS: ScreenRoute[] = [
  // Chamados
  { view: 'queue_my', path: '/chamados', area: 'chamados' },
  { view: 'queue', path: '/chamados/filas/todas', area: 'chamados' },
  // Minhas solicitações (cliente e equipe)
  { view: 'new_ticket', path: '/solicitacoes', area: 'solicitacoes' },
  { view: 'my_requests', path: '/solicitacoes/todas', area: 'solicitacoes' },
  // Telas iniciais por cargo
  { view: 'home_shift', path: '/gestao/turno', area: 'gestao' },
  { view: 'home_portfolio', path: '/gestao/carteira', area: 'gestao' },
  { view: 'home_health', path: '/admin/saude', area: 'admin' },
  // Gestão
  { view: 'dash_main', path: '/gestao/dashboard', area: 'gestao' },
  { view: 'survey_dashboard', path: '/gestao/pesquisas', area: 'gestao' },
  { view: 'agents', path: '/gestao/equipe', area: 'gestao' },
  { view: 'organograma', path: '/gestao/organograma', area: 'gestao' },
  { view: 'admin_audit', path: '/gestao/auditoria', area: 'gestao' },
  // Cadastros
  { view: 'admin_orgs', path: '/cadastros/empresas', area: 'cadastros' },
  { view: 'admin_users', path: '/cadastros/usuarios', area: 'cadastros' },
  // Configurações
  { view: 'admin_queues', path: '/configuracoes/filas', area: 'configuracoes' },
  { view: 'admin_categories', path: '/configuracoes/categorias', area: 'configuracoes' },
  { view: 'admin_macros', path: '/configuracoes/respostas-prontas', area: 'configuracoes' },
  { view: 'admin_sla', path: '/configuracoes/sla', area: 'configuracoes' },
  { view: 'admin_packages', path: '/configuracoes/pacotes', area: 'configuracoes' },
  { view: 'admin_business_hours', path: '/configuracoes/expediente', area: 'configuracoes' },
  { view: 'admin_routing', path: '/configuracoes/roteamento', area: 'configuracoes' },
  { view: 'admin_escalation', path: '/configuracoes/escalonamento', area: 'configuracoes' },
  { view: 'admin_inactivity', path: '/configuracoes/inatividade', area: 'configuracoes' },
  { view: 'admin_reopen_sla', path: '/configuracoes/reabertura', area: 'configuracoes' },
  { view: 'admin_auto_close', path: '/configuracoes/fechamento-automatico', area: 'configuracoes' },
  { view: 'admin_ticket_types', path: '/configuracoes/tipos', area: 'configuracoes' },
  { view: 'admin_survey', path: '/configuracoes/pesquisa', area: 'configuracoes' },
  // Sistema
  { view: 'admin_webhooks', path: '/admin/integracoes', area: 'admin' },
  { view: 'admin_email_logs', path: '/admin/emails', area: 'admin' },
  { view: 'admin_appearance', path: '/admin/aparencia', area: 'admin' },
  { view: 'admin_sso', path: '/admin/login-microsoft', area: 'admin' },
  { view: 'admin_ai_provider', path: '/admin/provedor-ia', area: 'admin' },
  { view: 'admin_ai', path: '/admin/ia', area: 'admin' },
  { view: 'admin_intake', path: '/admin/ia/checklist', area: 'admin' },
  { view: 'admin_knowledge', path: '/admin/ia/conhecimento', area: 'admin' },
  { view: 'admin_trash', path: '/admin/lixeira', area: 'admin' },
]

/** Telas antigas sem endereço próprio: caem na equivalente. */
const VIEW_ALIASES: Record<string, string> = {
  queue_all: 'queue',
  dashboard: 'dash_main', // painel antigo do supervisor, fora do menu
}

const QUEUE_PREFIX = '/chamados/filas/'
const byView = new Map(SCREENS.map(s => [s.view, s]))
const byPath = new Map(SCREENS.map(s => [s.path, s]))

/** Endereço de uma tela (inclui as filas: queue_<id> → /chamados/filas/<id>). */
export function pathForView(view: string): string | null {
  const v = VIEW_ALIASES[view] ?? view
  const screen = byView.get(v)
  if (screen) return screen.path
  if (v.startsWith('queue_')) return QUEUE_PREFIX + encodeURIComponent(v.slice('queue_'.length))
  return null
}

/** Tela de um endereço; null quando o endereço é só a raiz da área. */
export function viewForPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  const screen = byPath.get(path)
  if (screen) return screen.view
  if (path.startsWith(QUEUE_PREFIX)) return `queue_${decodeURIComponent(path.slice(QUEUE_PREFIX.length))}`
  return null
}

/** Raízes de área que montam a página do cargo (rotas do App). */
export const AREA_ROOTS: Area[] = ['chamados', 'solicitacoes', 'gestao', 'cadastros', 'configuracoes', 'admin']
