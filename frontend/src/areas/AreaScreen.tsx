/**
 * Telas das áreas Gestão, Cadastros, Configurações e Sistema, num lugar só.
 * Antes cada página de cargo (AgentPage, SupervisorPage, AdminPage) repetia a
 * mesma lista de 20+ telas com pequenas diferenças. A página continua dona dos
 * chamados (lista e detalhe) e passa aqui o que a tela precisa.
 */
import { AppearancePanel } from '@/areas/admin/AppearancePanel'
import { SsoPanel } from '@/areas/admin/SsoPanel'
import { AiProviderPanel } from '@/areas/admin/AiProviderPanel'
import type { AuthUser } from '@/store/auth'
import { SYSTEM_AREAS, hasAreaPermission } from '@/utils/permissions'
import { AccessDeniedView } from '@/components/ui/AccessDeniedView'
import { ShiftPage } from './inicio/ShiftPage'
import { PortfolioPage } from './inicio/PortfolioPage'
import { HealthPage } from './inicio/HealthPage'
import { DashboardPage } from './gestao/dashboard/DashboardPage'
import { SurveyDashboardPanel } from './gestao/SurveyDashboardPanel'
import { AgentsPanel } from './gestao/AgentsPanel'
import { Organograma } from './gestao/Organograma'
import { AuditPanel } from './gestao/AuditPanel'
import { OrgsPanel } from './cadastros/OrgsPanel'
import { UsersPanel } from './cadastros/UsersPanel'
import { QueuesPanel } from './configuracoes/QueuesPanel'
import { CategoriesPanel } from './configuracoes/CategoriesPanel'
import { MacrosPanel } from './configuracoes/MacrosPanel'
import { SLAPanel } from './configuracoes/SLAPanel'
import { PackagesPanel } from './configuracoes/PackagesPanel'
import { BusinessHoursPanel } from './configuracoes/BusinessHoursPanel'
import { RoutingPanel } from './configuracoes/RoutingPanel'
import { EscalationPanel } from './configuracoes/EscalationPanel'
import { InactivityRedirectPanel } from './configuracoes/InactivityRedirectPanel'
import { ReopenSLAPanel } from './configuracoes/ReopenSLAPanel'
import { AutoClosePanel } from './configuracoes/AutoClosePanel'
import { TicketTypesPanel } from './configuracoes/TicketTypesPanel'
import { SurveyConfigPanel } from './configuracoes/SurveyConfigPanel'
import { WebhooksPanel } from './admin/WebhooksPanel'
import { EmailAdminPanel } from './admin/EmailAdminPanel'
import { AiEnginePanel } from './admin/AiEnginePanel'
import { IntakeChecklistPanel } from './admin/IntakeChecklistPanel'
import { KnowledgeBasePanel } from './admin/KnowledgeBasePanel'
import { TrashPanel } from './admin/TrashPanel'

export interface ScreenContext {
  user: AuthUser
  users: any[]
  queues: any[]
  orgs: any[]
  /** Clique num número do painel: cada página filtra a sua lista de chamados. */
  onDashboardNavigate: (action: { view: string; filters?: any }) => void
  /** Abre um chamado vindo de uma tela (e-mails enviados, motor de IA). */
  onOpenTicket: (ticketId: string) => void
  /** Volta da tela de acesso negado. */
  onBack: () => void
  /** Vai a outra tela (busca de ajustes). */
  onGo: (view: string) => void
}

const SCREENS: Record<string, (ctx: ScreenContext) => JSX.Element> = {
  home_shift: ctx => <ShiftPage user={ctx.user} onOpenTicket={ctx.onOpenTicket} onNavigate={ctx.onDashboardNavigate} />,
  home_portfolio: ctx => <PortfolioPage onNavigate={ctx.onDashboardNavigate} />,
  home_health: ctx => <HealthPage user={ctx.user} onGo={ctx.onGo} />,
  dash_main: ctx => (
    <DashboardPage
      agents={ctx.users.filter((u: any) => ['agent', 'supervisor'].includes(u.role))}
      queues={ctx.queues}
      orgs={ctx.orgs}
      onNavigate={ctx.onDashboardNavigate}
    />
  ),
  survey_dashboard: () => <SurveyDashboardPanel />,
  agents: ctx => <AgentsPanel supervisorId={ctx.user.id} userRole={ctx.user.role} />,
  organograma: () => <Organograma />,
  admin_audit: () => <AuditPanel />,
  admin_orgs: () => <OrgsPanel />,
  admin_users: ctx => <UsersPanel currentUserId={ctx.user.id} />,
  admin_queues: () => <QueuesPanel />,
  admin_categories: () => <CategoriesPanel />,
  admin_macros: () => <MacrosPanel />,
  admin_sla: () => <SLAPanel />,
  admin_packages: () => <PackagesPanel />,
  admin_business_hours: () => <BusinessHoursPanel />,
  admin_routing: () => <RoutingPanel />,
  admin_escalation: () => <EscalationPanel />,
  admin_inactivity: () => <InactivityRedirectPanel />,
  admin_reopen_sla: () => <ReopenSLAPanel />,
  admin_auto_close: () => <AutoClosePanel />,
  admin_ticket_types: () => <TicketTypesPanel />,
  admin_survey: () => <SurveyConfigPanel />,
  admin_webhooks: () => <WebhooksPanel />,
  admin_email_logs: ctx => <EmailAdminPanel onOpenTicket={ctx.onOpenTicket} />,
  admin_appearance: () => <AppearancePanel />,
  admin_sso: () => <SsoPanel />,
  admin_ai_provider: () => <AiProviderPanel />,
  admin_ai: ctx => <AiEnginePanel onOpenTicket={ctx.onOpenTicket} />,
  admin_intake: () => <IntakeChecklistPanel />,
  admin_knowledge: () => <KnowledgeBasePanel />,
  admin_trash: () => <TrashPanel />,
}

// Telas sem área liberável: o servidor só atende o admin (ou a gestão).
const ADMIN_ONLY = new Set(['home_health', 'admin_appearance', 'admin_sso', 'admin_ai_provider', 'admin_ai', 'admin_intake', 'admin_knowledge'])
const MGMT_ONLY = new Set(['agents'])
// Mesma liberação do Painel (o servidor usa a mesma capacidade).
const DASH = new Set(['home_shift', 'home_portfolio'])

export const isAreaScreen = (view: string) => view in SCREENS

/** A pessoa não pode abrir esta tela (a página mostra a negação antes de tudo). */
export function screenDenied(view: string, user: Pick<AuthUser, 'role' | 'permissions'>): boolean {
  if (!isAreaScreen(view)) return false
  const area = SYSTEM_AREAS.find(a => a.view === view || a.id === view)
  return !!(area && !hasAreaPermission(user, view))
    || (DASH.has(view) && (user.role === 'agent' || !hasAreaPermission(user, 'dash_main')))
    || (ADMIN_ONLY.has(view) && user.role !== 'admin')
    || (MGMT_ONLY.has(view) && user.role !== 'supervisor' && user.role !== 'manager')
}

export function AreaScreen({ view, ctx }: { view: string; ctx: ScreenContext }) {
  const render = SCREENS[view]
  if (!render) return null
  if (screenDenied(view, ctx.user)) {
    const area = SYSTEM_AREAS.find(a => a.view === view || a.id === view)
    return <AccessDeniedView areaName={area?.name || 'esta área'} onBack={ctx.onBack} />
  }
  return render(ctx)
}
