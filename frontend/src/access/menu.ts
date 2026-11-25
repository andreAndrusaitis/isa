/**
 * Menu único. A primeira entrada é a tela do cargo (Turno ou Carteira);
 * depois vêm as áreas, e cada pessoa vê só o que pode usar. A tela de destino também confere a permissão (AccessDeniedView)
 * e o servidor é a autoridade final.
 */
import {
  Activity, BarChart3, BriefcaseBusiness, Building2, ChevronRight, FileText, Inbox, LayoutGrid, Network, ShieldAlert, ShieldCheck, Smile, Ticket, User, Users,
} from 'lucide-react'
import type { AuthUser } from '@/store/auth'
import { hasAreaPermission } from '@/utils/permissions'
import { settingsOf } from './settings'

export type NavEntry = { section: string } | { icon?: any; label: string; view: string; count?: number; indent?: boolean; /** Grupo dentro da área (Configurar). */ group?: string }
type Item = Extract<NavEntry, { view: string }>

interface MenuInput {
  queues: { id: string; name: string }[]
  counts: Record<string, number>
}

const STAFF = ['agent', 'supervisor', 'manager']

export function buildMenu(user: Pick<AuthUser, 'role' | 'permissions' | 'modules' | 'queues'>, { queues, counts }: MenuInput): NavEntry[] {
  const isAdmin = user.role === 'admin'
  const isMgmt = user.role === 'supervisor' || user.role === 'manager'
  const ticketsOn = isAdmin || user.modules?.tickets !== false
  const can = (area: string) => hasAreaPermission(user, area)
  const when = (ok: boolean, item: Item): Item[] => (ok ? [item] : [])
  const section = (label: string, items: Item[]): NavEntry[] => (items.length ? [{ section: label }, ...items] : [])

  // Filas: o admin vê o todo pela lista geral; a equipe vê as filas dela.
  const myQueues = isAdmin ? [] : queues.filter(q => (user.queues || []).includes(q.id))

  const homeView = isAdmin ? 'dash_main' : user.role === 'manager' ? 'home_portfolio' : 'home_shift'
  const seesResults = ticketsOn && can('dash_main')

  return [
    ...when(user.role === 'supervisor' && seesResults, { icon: Activity, label: 'Turno', view: 'home_shift' }),
    ...when(user.role === 'manager' && seesResults, { icon: BriefcaseBusiness, label: 'Carteira', view: 'home_portfolio' }),
    ...when(STAFF.includes(user.role), { icon: Inbox, label: 'Minhas solicitações', view: 'new_ticket' }),
    ...when(isAdmin || !!user.modules?.projects, { icon: LayoutGrid, label: 'Projetos', view: 'projetos' }),
    ...when(isAdmin || !!user.modules?.documents, { icon: FileText, label: 'Documentos', view: 'documentos' }),

    ...section('Chamados', ticketsOn ? [
      ...when(!isAdmin, { icon: User, label: 'Meus chamados', view: 'queue_my', count: counts.my || 0 }),
      { icon: Ticket, label: 'Todos os chamados', view: 'queue', count: counts.total || 0 },
      ...myQueues.map(q => ({ icon: ChevronRight, label: q.name, view: `queue_${q.id}`, count: counts[q.id] || 0, indent: true })),
    ] : []),

    ...section('Gestão', [
      ...when(seesResults, { icon: BarChart3, label: 'Painel', view: 'dash_main' }),
      ...when(seesResults && user.role !== 'agent' && homeView !== 'home_shift', { icon: Activity, label: 'Turno', view: 'home_shift' }),
      ...when(seesResults && user.role !== 'agent' && homeView !== 'home_portfolio', { icon: BriefcaseBusiness, label: 'Carteira', view: 'home_portfolio' }),
      ...when(ticketsOn && can('survey_dashboard'), { icon: Smile, label: 'Satisfação', view: 'survey_dashboard' }),
      ...when(isMgmt, { icon: Users, label: 'Equipe', view: 'agents' }),
      ...when(can('organograma'), { icon: Network, label: 'Organograma', view: 'organograma' }),
      ...when(can('audit'), { icon: ShieldAlert, label: 'Auditoria', view: 'admin_audit' }),
    ]),

    ...section('Cadastros', [
      ...when(can('orgs'), { icon: Building2, label: 'Empresas', view: 'admin_orgs' }),
      ...when(can('users'), { icon: Users, label: 'Usuários', view: 'admin_users' }),
    ]),

    ...section('Configurações', [
      ...when(isAdmin, { icon: ShieldCheck, label: 'Saúde do sistema', view: 'home_health' }),
      ...settingsOf({ isAdmin, can }),
    ]),
  ]
}
