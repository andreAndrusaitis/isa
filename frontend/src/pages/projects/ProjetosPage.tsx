import { lazy, Suspense, useEffect, useState } from 'react'
import { AppHeader } from '@/components/AppHeader'
import { PanelLeft } from 'lucide-react'
import { useNavigate, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuthStore } from '@/store/auth'
import { NavItem, NavSection, Btn, Modal, ConfirmModal, Field, Inp, Sel, Loading } from '@/components/ui'
import { ProjectNotificationBell } from '@/components/projects/ProjectNotificationBell'
import { listProjects, listFavorites, listNavFolders, createNavFolder, updateNavFolder, deleteNavFolder, moveProjectToNavFolder } from '@/services/projectsService'
import { Project, ProjectNavFolder } from '@/types/projects'
import { ProjectNavTree, MoveTarget, descendantIds } from '@/components/projects/ProjectNavTree'
import { toast } from '@/store/toastStore'
import MyTasksPage from './MyTasksPage'
import MyAreaPage from './MyAreaPage'
import MyWeekPage from './MyWeekPage'
import ProjectCatalogPage from './ProjectCatalogPage'
import ProjectShellPage from './ProjectShellPage'
import { PROJECTS_CHANGED_EVENT } from './ProjectSettingsPage'
import TeamPage from './TeamPage'
import DashboardGlobalPage from './DashboardGlobalPage'
import ProjectIntegrationsPage from './ProjectIntegrationsPage'
import ProjectMcpTokensPage from './ProjectMcpTokensPage'
import { CreateProjectModal } from '@/components/projects/CreateProjectModal'
import { DrillProvider } from '@/components/projects/drill/DrillProvider'
import { TaskDrawerHost } from '@/components/projects/TaskDrawerHost'
import { ProjectFolderNavItem } from '@/components/projects/ProjectFolderNavItem'
import { PROJECT_UPDATED_EVENT } from '@/components/projects/ProjectColorPicker'
import { useStaticDataStore } from '@/store/staticData'

const CLOSED_SECTIONS_KEY = 'projetos.sidebar.closedSections'
const OPEN_FOLDERS_KEY = 'projetos.sidebar.openFolders'

export default function ProjetosPage() {
  const user = useAuthStore(s => s.user)!
  const navigate = useNavigate()
  const location = useLocation()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  // Celular: a sidebar vira gaveta (antes ocupava ~60% da tela fixa).
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useEffect(() => { setSidebarOpen(false) }, [location.pathname])
  // Seções recolhíveis da sidebar; começam abertas e a escolha fica no navegador.
  const [closedSections, setClosedSections] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(CLOSED_SECTIONS_KEY) || '[]')) } catch { return new Set() }
  })

  function toggleSection(label: string) {
    setClosedSections(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      try { localStorage.setItem(CLOSED_SECTIONS_KEY, JSON.stringify([...next])) } catch { /* sem storage: só não persiste */ }
      return next
    })
  }
  // Liberações de Projetos (capacidades do servidor): o cargo dá; a ficha libera para os demais.
  const can = (capability: string) => !!user.capabilities?.includes(capability)
  const canReports = can('projects.reports')
  const canIntegrations = can('projects.integrations')
  // Pastas compartilhadas da sidebar: quem gerencia sprints e pastas organiza; abertas/fechadas é preferência do navegador.
  const canOrganize = can('projects.global.manage')
  const [navFolders, setNavFolders] = useState<ProjectNavFolder[]>([])
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) || '[]')) } catch { return new Set() }
  })
  const [folderForm, setFolderForm] = useState<{ id?: string; parentId: string | null; name: string } | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<ProjectNavFolder | null>(null)
  const [moving, setMoving] = useState<MoveTarget | null>(null)
  const [moveDest, setMoveDest] = useState('')

  function setOpenFolders(update: (prev: Set<string>) => Set<string>) {
    setOpenFolderIds(prev => {
      const next = update(prev)
      try { localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify([...next])) } catch { /* sem storage: só não persiste */ }
      return next
    })
  }
  const toggleFolder = (id: string) => setOpenFolders(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const reloadTree = () => Promise.all([listProjects().then(setProjects), listNavFolders().then(setNavFolders)]).catch(() => {})

  async function moveTo(target: MoveTarget, folderId: string | null) {
    // Otimista: a árvore muda na hora; se o servidor recusar, recarrega o estado real.
    if (target.kind === 'project') setProjects(prev => prev.map(p => (p.id === target.id ? { ...p, navFolderId: folderId } : p)))
    else setNavFolders(prev => prev.map(f => (f.id === target.id ? { ...f, parentId: folderId } : f)))
    if (folderId) setOpenFolders(prev => new Set(prev).add(folderId))
    try {
      if (target.kind === 'project') await moveProjectToNavFolder(target.id, folderId)
      else await updateNavFolder(target.id, { parentId: folderId })
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Não foi possível mover.')
      reloadTree()
    }
  }

  async function saveFolderForm() {
    if (!folderForm?.name.trim()) return
    try {
      if (folderForm.id) {
        const updated = await updateNavFolder(folderForm.id, { name: folderForm.name.trim() })
        setNavFolders(prev => prev.map(f => (f.id === updated.id ? updated : f)))
      } else {
        const created = await createNavFolder({ name: folderForm.name.trim(), parentId: folderForm.parentId })
        setNavFolders(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
        if (folderForm.parentId) setOpenFolders(prev => new Set(prev).add(folderForm.parentId!))
      }
      setFolderForm(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Não foi possível salvar a pasta.')
    }
  }

  async function confirmDeleteFolder() {
    if (!deletingFolder) return
    try {
      await deleteNavFolder(deletingFolder.id)
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Não foi possível excluir a pasta.')
    }
    setDeletingFolder(null)
    reloadTree()
  }

  /** Destinos do "Mover para…" com recuo por nível; uma pasta não vai para dentro de si mesma. */
  function moveOptions(): Array<{ id: string; label: string }> {
    const blocked = moving?.kind === 'folder' ? descendantIds(navFolders, moving.id) : new Set<string>()
    const out: Array<{ id: string; label: string }> = []
    const walk = (parentId: string | null, depth: number) => {
      for (const f of navFolders.filter(x => x.parentId === parentId)) {
        if (blocked.has(f.id)) continue
        out.push({ id: f.id, label: `${'\u00a0\u00a0\u00a0'.repeat(depth)}${f.name}` })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }

  const sectionProps = (label: string) => ({ label, open: !closedSections.has(label), onToggle: () => toggleSection(label) })

  const loadProjects = () => {
    setProjectsLoading(true)
    setProjectsError(null)
    return listProjects()
      .then(setProjects)
      .catch(() => setProjectsError('Não foi possível carregar os projetos.'))
      .finally(() => setProjectsLoading(false))
  }

  // Projeto arquivado nas Configurações sai da sidebar e do catálogo na hora.
  useEffect(() => {
    const onChanged = () => { void loadProjects() }
    window.addEventListener(PROJECTS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onChanged)
  }, [])

  useEffect(() => {
    void loadProjects()
    listNavFolders().then(setNavFolders).catch(() => { /* sem pastas: árvore plana */ })
    listFavorites()
      .then(favs => setFavoriteIds(new Set(favs.filter(f => f.entityType === 'project').map(f => f.entityId))))
      .catch(() => { /* favoritos são acessórios: a sidebar funciona sem eles */ })
  }, [])

  // Nome/cor alterados em Configurações refletem na árvore na hora.
  useEffect(() => {
    function onUpdated(e: Event) {
      const updated = (e as CustomEvent<Project>).detail
      setProjects(prev => prev.map(p => (p.id === updated.id ? { ...p, ...updated } : p)))
    }
    window.addEventListener(PROJECT_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(PROJECT_UPDATED_EVENT, onUpdated)
  }, [])

  // Entrar num projeto não abre as views dele na sidebar: isso é só pela seta.
  // As pastas acima dele abrem, senão o projeto ativo fica escondido numa pasta fechada.
  useEffect(() => {
    const projectId = location.pathname.match(/^\/projetos\/([^/]+)/)?.[1]
    const parentOf = new Map(navFolders.map(f => [f.id, f.parentId]))
    const ancestors: string[] = []
    for (let id = projects.find(p => p.id === projectId)?.navFolderId ?? null; id; id = parentOf.get(id) ?? null) ancestors.push(id)
    if (ancestors.some(id => !openFolderIds.has(id))) setOpenFolders(prev => new Set([...prev, ...ancestors]))
  }, [location.pathname, projects, navFolders])

  // Favoritos primeiro, o resto na ordem que veio do backend.
  const sortedProjects = [...projects].sort((a, b) => {
    const aFav = favoriteIds.has(a.id) ? 0 : 1
    const bFav = favoriteIds.has(b.id) ? 0 : 1
    return aFav - bFav
  })

  function handleCreated(project: Project) {
    setProjects(prev => [project, ...prev])
    setCreateOpen(false)
    setExpandedIds(prev => new Set(prev).add(project.id))
    navigate(`/projetos/${project.id}/overview`)
  }

  function toggleExpanded(projectId: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  return (
    // Task clicada fora da página do projeto abre num drawer sobre a tela atual.
    <TaskDrawerHost>
    <div className="app-shell">
      <AppHeader right={<ProjectNotificationBell />} panelToggle={<button type="button" className="icon-btn panel-toggle" aria-label="Painel de projetos" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(o => !o)}><PanelLeft size={18} /></button>} />
      <div className="app-body">
      {/* Campos em fieldset desabilitado (papel sem permissão) parecem desabilitados. */}
      <style>{'fieldset:disabled :is(input, select, textarea, button) { opacity: .6 !important; cursor: not-allowed !important; }'}</style>
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} aria-hidden style={{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--navy-900) 45%, transparent)', zIndex: 49 }} />
      )}
      <aside
        id="projetos-sidebar"
        aria-label="Navegação de Projetos"
        className="nav-panel"
        style={isMobile ? {
          position: 'fixed', inset: '0 auto 0 0', zIndex: 50, maxWidth: '86vw',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.2s ease',
          visibility: sidebarOpen ? 'visible' : 'hidden',
        } : undefined}
      >
        <nav>
          <NavSection {...sectionProps('Pessoal')} />
          {!closedSections.has('Pessoal') && (<>
          <NavItem label="Minha semana" active={location.pathname === '/projetos/semana'} onClick={() => navigate('/projetos/semana')} />
          <NavItem label="Minha área" active={location.pathname === '/projetos/my-area'} onClick={() => navigate('/projetos/my-area')} />
          <NavItem label="Minhas tarefas" active={location.pathname === '/projetos/my-tasks'} onClick={() => navigate('/projetos/my-tasks')} />
          </>)}
          <NavSection {...sectionProps('Projetos')} />
          {!closedSections.has('Projetos') && (
            <ProjectNavTree
              folders={navFolders}
              projects={sortedProjects}
              canOrganize={canOrganize}
              openFolderIds={openFolderIds}
              onToggleFolder={toggleFolder}
              onMove={moveTo}
              onCreateFolder={(parentId) => setFolderForm({ parentId, name: '' })}
              onRenameFolder={(f) => setFolderForm({ id: f.id, parentId: f.parentId, name: f.name })}
              onDeleteFolder={setDeletingFolder}
              onMoveRequest={(t) => { setMoving(t); setMoveDest('') }}
              renderProject={(p, depth) => (
                <ProjectFolderNavItem
                  id={p.id}
                  name={p.name}
                  color={p.color}
                  depth={depth}
                  expanded={expandedIds.has(p.id)}
                  active={location.pathname.startsWith(`/projetos/${p.id}`)}
                  isFavorite={favoriteIds.has(p.id)}
                  currentPath={location.pathname}
                  onToggle={() => toggleExpanded(p.id)}
                  onNavigate={(path) => navigate(`/projetos/${p.id}/${path}`)}
                />
              )}
            />
          )}
          {!closedSections.has('Projetos') && (<>
          <NavItem label="Ver todos os projetos" active={location.pathname === '/projetos'} onClick={() => navigate('/projetos')} />
          <NavItem label="Novo projeto" active={false} onClick={() => setCreateOpen(true)} />
          </>)}
          <NavSection {...sectionProps('Equipe')} />
          {!closedSections.has('Equipe') && (<>
          {/* Equipe e Dashboards são relatórios (Gerente/TM ou liberação "Relatórios de projetos") */}
          {canReports && (
            <NavItem label="Equipe" active={location.pathname === '/projetos/team'} onClick={() => navigate('/projetos/team')} />
          )}
          <NavItem label="Sprints" active={location.pathname === '/projetos/sprints'} onClick={() => navigate('/projetos/sprints')} />
          {canReports && (
            <NavItem label="Painel" active={location.pathname === '/projetos/dashboards'} onClick={() => navigate('/projetos/dashboards')} />
          )}
          {canIntegrations && (
            <NavItem label="Integrações" active={location.pathname === '/projetos/webhooks'} onClick={() => navigate('/projetos/webhooks')} />
          )}
          <NavItem label="MCP" active={location.pathname === '/projetos/mcp-tokens'} onClick={() => navigate('/projetos/mcp-tokens')} />
          </>)}
        </nav>
      </aside>
      <div className="app-main">
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <DrillProvider>
          <Routes>
            <Route index element={<ProjectCatalogPage projects={projects} loading={projectsLoading} error={projectsError} onRetry={() => { void loadProjects() }} onOpenCreate={() => setCreateOpen(true)} onImported={() => { void loadProjects() }} />} />
            <Route path="semana" element={<MyWeekPage />} />
            <Route path="my-area" element={<MyAreaPage />} />
            <Route path="solicitacoes" element={<MyRequests />} />
            <Route path="my-tasks" element={<MyTasksPage />} />
            {/* Sem a liberação, link direto volta ao catálogo (o servidor nega os dados de qualquer jeito). */}
            <Route path="team" element={canReports ? <TeamPage /> : <Navigate to="/projetos" replace />} />
            <Route path="dashboards" element={canReports ? <DashboardGlobalPage /> : <Navigate to="/projetos" replace />} />
            <Route path="sprints" element={<Suspense fallback={<Loading label="Carregando sprints…" />}><SprintsPanelPage /></Suspense>} />
            {/* Mesma tela da área de chamados: Saída (webhooks) e API externa numa página só. */}
            <Route path="webhooks" element={canIntegrations ? <ProjectIntegrationsPage /> : <Navigate to="/projetos" replace />} />
            <Route path="api" element={<Navigate to={canIntegrations ? '/projetos/webhooks?tab=keys' : '/projetos'} replace />} />
            <Route path="mcp-tokens" element={<ProjectMcpTokensPage />} />
            <Route path=":projectId/*" element={<ProjectShellPage />} />
          </Routes>
          </DrillProvider>
        </div>
      </div>
      </div>
      <CreateProjectModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
      <Modal isOpen={!!folderForm} onClose={() => setFolderForm(null)} title={folderForm?.id ? 'Renomear pasta' : 'Nova pasta'} width={360}>
        {folderForm && (
          <form onSubmit={e => { e.preventDefault(); saveFolderForm() }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nome">
              <Inp value={folderForm.name} onChange={(e: any) => setFolderForm({ ...folderForm, name: e.target.value })} placeholder="Ex.: Desenvolvimento" autoFocus maxLength={80} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" type="button" onClick={() => setFolderForm(null)}>Cancelar</Btn>
              <Btn variant="primary" size="sm" type="submit" disabled={!folderForm.name.trim()}>Salvar</Btn>
            </div>
          </form>
        )}
      </Modal>
      <Modal isOpen={!!moving} onClose={() => setMoving(null)} title={`Mover ${moving?.name ?? ''}`} width={360}>
        {moving && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Para a pasta">
              <Sel value={moveDest} onChange={(e: any) => setMoveDest(e.target.value)} autoFocus>
                <option value="">Sem pasta (raiz)</option>
                {moveOptions().map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Sel>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => setMoving(null)}>Cancelar</Btn>
              <Btn variant="primary" size="sm" onClick={() => { moveTo(moving, moveDest || null); setMoving(null) }}>Mover</Btn>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmModal
        isOpen={!!deletingFolder}
        onClose={() => setDeletingFolder(null)}
        onConfirm={confirmDeleteFolder}
        title="Excluir pasta"
        message={`Excluir a pasta "${deletingFolder?.name}"? Os projetos e subpastas dela sobem para a pasta de cima — nada é apagado.`}
        confirmText="Excluir"
        variant="danger"
      />
    </div>
    </TaskDrawerHost>
  )
}

// lazy: painel de sprints (puxa o kit de gráficos) só carrega quando a rota é aberta.
const SprintsPanelPage = lazy(() => import('./SprintsPanelPage'))

// lazy: o portal do solicitante é grande e só carrega quando a rota é aberta.
const UserPortalPage = lazy(() => import('@/areas/solicitacoes/UserPortalPage'))

/** "Minhas solicitações" dentro da área de Projetos: o mesmo portal de chamados embutido. */
function MyRequests() {
  const staticData = useStaticDataStore()
  const [orgs, setOrgs] = useState<any[]>([])
  useEffect(() => { staticData.getOrgs().then(setOrgs).catch(() => setOrgs([])) }, [])
  return (
    <div style={{ padding: 'var(--page-gutter)', overflowY: 'auto', height: '100%' }}>
      <Suspense fallback={<Loading label="Carregando solicitações…" />}>
        <UserPortalPage embedded organizations={orgs} />
      </Suspense>
    </div>
  )
}
