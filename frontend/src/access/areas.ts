/**
 * Áreas do menu recolhido. Saem do mesmo menu (access/menu.ts): uma área só aparece
 * quando a pessoa tem ao menos uma tela dela, e abre na primeira.
 */
import { Activity, BarChart3, BriefcaseBusiness, Building2, FileText, Inbox, LayoutGrid, Settings2, Ticket } from 'lucide-react'
import type { AuthUser } from '@/store/auth'
import { buildMenu, type NavEntry } from './menu'
import { pathForView, viewForPath } from './routes'

export type AreaId = 'inicio' | 'solicitacoes' | 'chamados' | 'projetos' | 'documentos' | 'gestao' | 'cadastros' | 'configuracoes'
export type MenuItem = Extract<NavEntry, { view: string }>
export interface NavArea { id: AreaId; label: string; icon: typeof Ticket; path: string; items: MenuItem[] }

const BY_SECTION: Record<string, { id: AreaId; label: string; icon: typeof Ticket }> = {
  Chamados: { id: 'chamados', label: 'Chamados', icon: Ticket },
  'Gestão': { id: 'gestao', label: 'Gestão', icon: BarChart3 },
  Cadastros: { id: 'cadastros', label: 'Cadastros', icon: Building2 },
  'Configurações': { id: 'configuracoes', label: 'Configurações', icon: Settings2 },
}
const BY_VIEW: Record<string, { id: AreaId; label: string; icon: typeof Ticket; path: string }> = {
  home_shift: { id: 'inicio', label: 'Turno', icon: Activity, path: '/gestao/turno' },
  home_portfolio: { id: 'inicio', label: 'Carteira', icon: BriefcaseBusiness, path: '/gestao/carteira' },
  new_ticket: { id: 'solicitacoes', label: 'Minhas solicitações', icon: Inbox, path: '/solicitacoes' },
  projetos: { id: 'projetos', label: 'Projetos', icon: LayoutGrid, path: '/projetos/semana' },
  documentos: { id: 'documentos', label: 'Documentos', icon: FileText, path: '/documentos' },
}
const ORDER: AreaId[] = ['inicio', 'chamados', 'gestao', 'projetos', 'documentos', 'cadastros', 'configuracoes', 'solicitacoes']

type MenuUser = Parameters<typeof buildMenu>[0] & Pick<AuthUser, 'role'>

export function buildAreas(user: MenuUser, input: Parameters<typeof buildMenu>[1] = { queues: [], counts: {} }): NavArea[] {
  const areas: NavArea[] = []
  let current: NavArea | null = null
  for (const entry of buildMenu(user, input)) {
    if ('section' in entry) {
      const meta = BY_SECTION[entry.section]
      current = { ...meta, path: '/', items: [] }
      areas.push(current)
      continue
    }
    // Turno e Carteira também aparecem como tela de Gestão para quem não abre nelas.
    const own = current ? undefined : BY_VIEW[entry.view]
    if (own) { areas.push({ ...own, items: [entry] }); continue }
    if (!current) continue
    if (!current.items.length) current.path = pathForView(entry.view) ?? '/'
    current.items.push(entry)
  }
  return areas.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
}

/** Área da tela aberta. */
export function areaOfView(areas: NavArea[], view: string): AreaId | null {
  const direct = areas.find(a => a.items.some(i => i.view === view))
  if (direct) return direct.id
  return view.startsWith('queue') ? 'chamados' : null
}

export function areaOfPath(areas: NavArea[], pathname: string): AreaId | null {
  if (pathname.startsWith('/projetos')) return 'projetos'
  if (pathname.startsWith('/documentos')) return 'documentos'
  const view = viewForPath(pathname)
  return view ? areaOfView(areas, view) : null
}
