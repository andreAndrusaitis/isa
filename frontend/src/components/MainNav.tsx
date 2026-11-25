/**
 * Menu lateral da equipe: marca, telas por seção e, no pé, os números de quem atende.
 * Recolhe para uma faixa de ícones (por escolha, ou sozinho em Projetos e Documentos,
 * que têm o próprio painel). No celular vira gaveta.
 */
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { Logo, LogoMark } from '@/components/ui'
import { AnalystStats } from '@/components/AnalystStats'
import { useAuthStore } from '@/store/auth'
import { useNavStore } from '@/store/nav'
import { useInTeams } from '@/teams/teamsContext'
import { buildMenu, type NavEntry } from '@/access/menu'
import { pathForView, viewForPath } from '@/access/routes'
import { buildAreas, areaOfPath } from '@/access/areas'
import { homeOf } from '@/utils/home'

type Item = Extract<NavEntry, { view: string }>
const MODULE_PATH: Record<string, string> = { projetos: '/projetos/semana', documentos: '/documentos', new_ticket: '/solicitacoes' }
export const pathOf = (view: string) => MODULE_PATH[view] ?? pathForView(view) ?? '/'

/** Seções longas começam fechadas, a não ser que a tela aberta esteja nelas. */
const CLOSED_BY_DEFAULT = new Set(['Configurações', 'Cadastros'])

function groupMenu(entries: NavEntry[]) {
  const groups: { section: string | null; items: Item[] }[] = [{ section: null, items: [] }]
  for (const e of entries) {
    if ('section' in e) groups.push({ section: e.section, items: [] })
    else groups[groups.length - 1].items.push(e)
  }
  return groups.filter(g => g.items.length)
}

export function MainNav() {
  const user = useAuthStore(s => s.user)!
  const { mobileOpen, setMobileOpen, rail, toggleRail, queues, counts, stats, online } = useNavStore()
  const { pathname } = useLocation()
  const inTeams = useInTeams()
  const ownPanel = pathname.startsWith('/projetos') || pathname.startsWith('/documentos')
  const narrow = (rail || ownPanel) && !mobileOpen
  const view = pathname.startsWith('/projetos') ? 'projetos' : pathname.startsWith('/documentos') ? 'documentos' : viewForPath(pathname)
  const groups = groupMenu(buildMenu(user, { queues, counts }))
  const isActive = (v: string) => view === v || (v === 'queue' && !!view?.startsWith('queue_') && view !== 'queue_my' && !groups.some(g => g.items.some(i => i.view === view)))
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const isOpen = (g: (typeof groups)[number]) => !g.section || (toggled[g.section] ?? (!CLOSED_BY_DEFAULT.has(g.section) || g.items.some(i => isActive(i.view))))

  useEffect(() => {
    document.documentElement.dataset.nav = narrow ? 'rail' : 'full'
    return () => { delete document.documentElement.dataset.nav }
  }, [narrow])
  useEffect(() => { setMobileOpen(false) }, [pathname, setMobileOpen])

  const areas = buildAreas(user, { queues, counts })
  const area = areaOfPath(areas, pathname)

  return (
    <>
      {mobileOpen && <div className="side-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <aside className="side" data-open={mobileOpen || undefined} data-rail={narrow || undefined} aria-label="Menu">
        <div className="side-brand">
          {!inTeams && (
            <Link to={homeOf(user)} aria-label="Ir para o início" title="Ir para o início" className="app-brand">
              {narrow ? <LogoMark size={34} variant="sidebar" /> : <Logo size={34} variant="sidebar" />}
            </Link>
          )}
          {mobileOpen && <button type="button" className="side-tool" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X size={18} /></button>}
        </div>

        <nav className="side-nav" aria-label="Telas">
          {narrow
            ? areas.map(a => <Link key={a.id} to={a.path} className="side-item" aria-current={a.id === area ? 'page' : undefined} title={a.label} aria-label={a.label}><a.icon size={20} aria-hidden /></Link>)
            : groups.map(g => (
              <div key={g.section ?? 'top'} className="side-group">
                {g.section && (
                  <button type="button" className="side-section" aria-expanded={isOpen(g)} onClick={() => setToggled(t => ({ ...t, [g.section!]: !isOpen(g) }))}>
                    {g.section}<ChevronDown size={14} aria-hidden />
                  </button>
                )}
                {isOpen(g) && g.items.map((item, i) => (
                  <div key={item.view}>
                    {item.group && item.group !== g.items[i - 1]?.group && <div className="side-caption">{item.group}</div>}
                    <Link to={pathOf(item.view)} className="side-item" data-indent={item.indent || undefined} aria-current={isActive(item.view) ? 'page' : undefined} title={narrow ? item.label : undefined}>
                      {item.icon && !item.indent && <item.icon size={18} strokeWidth={1.9} aria-hidden />}
                      <span>{item.label}</span>
                      {(item.count ?? 0) > 0 && <b>{item.count}</b>}
                    </Link>
                  </div>
                ))}
              </div>
            ))}
        </nav>

        {!narrow && stats && (user.role === 'agent' || user.role === 'supervisor') && (
          <div className="side-stats">
            <AnalystStats stats={stats} />
            {online.length > 0 && <span title={online.join(', ')}><i />{online.length} online</span>}
          </div>
        )}
        {!ownPanel && !mobileOpen && (
          <button type="button" className="side-collapse" onClick={toggleRail} aria-label={rail ? 'Abrir menu' : 'Recolher menu'} title={rail ? 'Abrir menu' : 'Recolher menu'}>
            {rail ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} /><span>Recolher</span></>}
          </button>
        )}
      </aside>
    </>
  )
}
