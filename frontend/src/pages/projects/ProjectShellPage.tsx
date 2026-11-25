import { Fragment, useEffect, useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { useParams, useLocation, useNavigate, useSearchParams, Routes, Route, Navigate } from 'react-router-dom'
import { PageHeader, EmptyState, Btn } from '@/components/ui'
import { getProject, listFolders, listLists } from '@/services/projectsService'
import { Project, ProjectFolder, ProjectListEntity } from '@/types/projects'
import ProjectTasksPage from './ProjectTasksPage'
import ProjectDocsPage from './ProjectDocsPage'
import ProjectAutomationsPage from './ProjectAutomationsPage'
import ProjectMembersPage from './ProjectMembersPage'
import ProjectSettingsPage from './ProjectSettingsPage'
import ProjectOverviewPage from './ProjectOverviewPage'
import ProjectTimePage from './ProjectTimePage'
import { ProjectRoleProvider } from '@/components/projects/projectRole'
import { ExportDossierModal } from '@/components/projects/ExportDossierModal'
import { PROJECT_UPDATED_EVENT, projectAccentStyle } from '@/components/projects/ProjectColorPicker'
import { apiErrorMessage } from '@/services/api'
import '@/components/projects/insights/projects.css'

// Board, Lista, Calendário, Gantt e Timeline não são rotas: são modos de exibição
// das mesmas tasks, escolhidos por querystring dentro de "tasks".
const TABS = [
  { path: 'overview', label: 'Visão geral' },
  { path: 'tasks', label: 'Tasks' },
  { path: 'docs', label: 'Arquivos' },
  { path: 'time', label: 'Tempo' },
  { path: 'automations', label: 'Automações' },
  { path: 'members', label: 'Membros' },
  { path: 'settings', label: 'Configurações' },
]

export default function ProjectShellPage() {
  // Dossiê é relatório: só com a liberação Relatórios de projetos.
  const canExport = useAuthStore(s => !!s.user?.capabilities?.includes('projects.reports'))
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [folders, setFolders] = useState<ProjectFolder[]>([])
  const [lists, setLists] = useState<ProjectListEntity[]>([])
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [searchParams] = useSearchParams()
  const activeListId = location.pathname.endsWith('/tasks') ? searchParams.get('list') : null
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    // Troca de projeto: sem isso o anterior fica na tela (título e papel errados) até o GET voltar.
    setProject(null)
    setNotFound(false)
    setLoadError(null)
    getProject(projectId)
      .then((p) => { if (!cancelled) setProject(p) })
      .catch((err) => {
        if (cancelled) return
        // 404 = projeto não existe ou a pessoa não é membro (inclusive admin: sem bypass).
        // Outros erros (rede, 500) não são "não encontrado": oferece tentar de novo.
        if (err?.response?.status === 404) setNotFound(true)
        else setLoadError(apiErrorMessage(err, 'Não foi possível carregar o projeto.'))
      })
    listFolders(projectId).then((f) => { if (!cancelled) setFolders(f) }).catch(() => { if (!cancelled) setFolders([]) })
    listLists(projectId).then((l) => { if (!cancelled) setLists(l) }).catch(() => { if (!cancelled) setLists([]) })
    return () => { cancelled = true }
  }, [projectId, reloadKey])

  // Cor trocada em Configurações vale na hora para as abas e destaques.
  useEffect(() => {
    function onUpdated(e: Event) {
      const updated = (e as CustomEvent<Project>).detail
      if (updated.id === projectId) setProject(prev => (prev ? { ...prev, ...updated } : prev))
    }
    window.addEventListener(PROJECT_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(PROJECT_UPDATED_EVENT, onUpdated)
  }, [projectId])

  if (!projectId) return null
  if (notFound) {
    return (
      <EmptyState
        title="Projeto não encontrado"
        desc="Ele não existe mais ou você não é membro deste projeto. Peça a um dono ou gerente do projeto para adicionar você."
        action={<Btn variant="primary" size="sm" onClick={() => navigate('/projetos')}>Ver meus projetos</Btn>}
      />
    )
  }
  if (loadError) {
    return (
      <EmptyState
        title="Não foi possível carregar o projeto"
        desc={loadError}
        action={<Btn variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>Tentar novamente</Btn>}
      />
    )
  }

  // Painel "Listas": filtra as tasks pela lista (?list=); clicar na ativa limpa o filtro.
  function openList(listId: string) {
    navigate(activeListId === listId ? `/projetos/${projectId}/tasks` : `/projetos/${projectId}/tasks?list=${encodeURIComponent(listId)}`)
  }
  const listButton = (list: ProjectListEntity) => (
    <button key={list.id} type="button" onClick={() => openList(list.id)} aria-pressed={activeListId === list.id}>{list.name}</button>
  )

  return (
    // A cor do projeto vira o --accent de tudo que está dentro dele (abas, botões, seleção).
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', ...projectAccentStyle(project?.color) }}>
      <PageHeader title={project?.name ?? 'Projeto'} subtitle={project?.description ?? undefined}
        actions={project && canExport ? <Btn variant="secondary" size="sm" onClick={() => setExportOpen(true)}>Exportar dossiê</Btn> : undefined} />
      {project && <ExportDossierModal isOpen={exportOpen} onClose={() => setExportOpen(false)} projects={[project]} initialProjectIds={[project.id]} />}
      <nav className="subtabs prj-tabs" aria-label="Telas do projeto">
        {TABS.map(tab => (
          <button key={tab.path} type="button" aria-current={location.pathname.endsWith(`/${tab.path}`) ? 'page' : undefined}
            onClick={() => navigate(`/projetos/${projectId}/${tab.path}`)}>
            {tab.label}
          </button>
        ))}
      </nav>
      {(folders.length > 0 || lists.length > 0) && (
        <aside className="prj-lists" aria-label="Listas">
          <span>Listas</span>
          <div className="subtabs">{lists.filter(l => !l.folderId).map(listButton)}</div>
          {folders.map(folder => (
            <Fragment key={folder.id}>
              <span>{folder.name}</span>
              <div className="subtabs">{lists.filter(l => l.folderId === folder.id).map(listButton)}</div>
            </Fragment>
          ))}
        </aside>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <ProjectRoleProvider value={project?.myRole}>
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<ProjectOverviewPage />} />
          <Route path="tasks" element={<ProjectTasksPage />} />
          {/* Rotas antigas redirecionadas para a view equivalente
              em /tasks — preserva links/favoritos já salvos por quem usava
              o módulo antes desta unificação. */}
          <Route path="board" element={<LegacyView view="board" />} />
          <Route path="list" element={<LegacyView view="list" />} />
          <Route path="calendar" element={<LegacyView view="calendar" />} />
          <Route path="gantt" element={<LegacyView view="gantt" />} />
          <Route path="timeline" element={<LegacyView view="timeline" />} />
          {/* Webhooks deixaram de pertencer a um projeto específico — cada
              webhook agora seleciona a lista de projetos aos quais se
              aplica, então a página vive fora do shell do projeto. */}
          <Route path="webhooks" element={<Navigate to="/projetos/webhooks" replace />} />
          <Route path="docs" element={<ProjectDocsPage />} />
          <Route path="time" element={<ProjectTimePage />} />
          {/* Docs e Arquivos eram a mesma lista (GET /files): uma aba só, em /docs. */}
          <Route path="files" element={<Navigate to="../docs" replace />} />
          <Route path="automations" element={<ProjectAutomationsPage />} />
          <Route path="members" element={<ProjectMembersPage />} />
          <Route path="settings" element={<ProjectSettingsPage />} />
        </Routes>
        </ProjectRoleProvider>
      </div>
    </div>
  )
}

// Rotas antigas (/board, /list...) → /tasks?view=…, preservando os outros
// parâmetros (ex.: ?task=… de links salvos, que abre o drawer).
function LegacyView({ view }: { view: string }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  params.set('view', view)
  return <Navigate to={`../tasks?${params.toString()}`} replace />
}
