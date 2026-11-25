import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getProject } from '@/services/projectsService'
import type { Project } from '@/types/projects'
import { TaskDrawer } from './TaskDrawer'
import { ProjectRoleProvider } from './projectRole'
import { TASK_PARAM, TASK_PROJECT_PARAM, TaskDrawerContext, taskPageUrl, type TaskDrawerApi } from './taskDrawerContext'

// A página de tasks do projeto tem o próprio drawer (?task=); lá o host não abre.
const PROJECT_TASKS_PAGE = /^\/projetos\/([^/]+)\/tasks\/?$/

/** Marca a entrada de histórico criada ao abrir: fechar volta para ela (o voltar do navegador também). */
const OPENED_HERE = { taskDrawer: true }

type LoadedProject = { id: string; project: Pick<Project, 'name' | 'myRole'> | null }

/**
 * Abre o TaskDrawer sobre qualquer tela de Projetos (Minha área, Minhas tarefas,
 * painéis, sino), sem sair dela. A task aberta fica na URL da própria tela
 * (?task=&taskProject=), então o link é compartilhável e o voltar fecha o drawer.
 * O papel no projeto vem do GET /projects/:id, porque cada task pode ser de um projeto.
 */
export function TaskDrawerHost({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const taskId = params.get(TASK_PARAM)
  const projectId = params.get(TASK_PROJECT_PARAM)
  const active = !!taskId && !!projectId && !PROJECT_TASKS_PAGE.test(location.pathname)

  const listeners = useRef(new Set<() => void>())
  const current = useRef(location)
  useEffect(() => { current.current = location })

  const withTask = useCallback((search: string, next: { projectId: string; taskId: string } | null) => {
    const p = new URLSearchParams(search)
    if (next) { p.set(TASK_PARAM, next.taskId); p.set(TASK_PROJECT_PARAM, next.projectId) }
    else { p.delete(TASK_PARAM); p.delete(TASK_PROJECT_PARAM) }
    const s = p.toString()
    return s ? `?${s}` : ''
  }, [])

  const open = useCallback((pid: string, tid: string) => {
    const loc = current.current
    const onTasksPage = PROJECT_TASKS_PAGE.exec(loc.pathname)
    if (onTasksPage) {
      // Já na página de tasks (ex.: sino): do mesmo projeto, só põe ?task=; de outro, vai até ele.
      if (decodeURIComponent(onTasksPage[1]) !== pid) { navigate(taskPageUrl(pid, tid)); return }
      const p = new URLSearchParams(loc.search)
      p.set(TASK_PARAM, tid)
      navigate({ pathname: loc.pathname, search: `?${p.toString()}` })
      return
    }
    const alreadyOpen = new URLSearchParams(loc.search).has(TASK_PROJECT_PARAM)
    // Trocar de task com o drawer aberto (subtarefa <-> mãe) não empilha histórico.
    navigate(
      { pathname: loc.pathname, search: withTask(loc.search, { projectId: pid, taskId: tid }), hash: loc.hash },
      alreadyOpen ? { replace: true, state: loc.state } : { state: OPENED_HERE },
    )
  }, [navigate, withTask])

  const close = useCallback(() => {
    const loc = current.current
    if ((loc.state as typeof OPENED_HERE | null)?.taskDrawer) { navigate(-1); return }
    // Veio por link direto: só tira a task da URL.
    navigate({ pathname: loc.pathname, search: withTask(loc.search, null), hash: loc.hash }, { replace: true })
  }, [navigate, withTask])

  const subscribe = useCallback((fn: () => void) => {
    listeners.current.add(fn)
    return () => { listeners.current.delete(fn) }
  }, [])

  // Fechou (por qualquer caminho): a tela de trás recarrega o que mostra.
  const wasActive = useRef(active)
  useEffect(() => {
    if (wasActive.current && !active) listeners.current.forEach((fn) => fn())
    wasActive.current = active
  }, [active])

  const [loaded, setLoaded] = useState<LoadedProject | null>(null)
  useEffect(() => {
    if (!active || !projectId || loaded?.id === projectId) return
    let alive = true
    getProject(projectId)
      .then((p) => { if (alive) setLoaded({ id: projectId, project: p }) })
      .catch(() => { if (alive) setLoaded({ id: projectId, project: null }) }) // o backend decide o que pode
    return () => { alive = false }
  }, [active, projectId, loaded?.id])

  const api = useMemo<TaskDrawerApi>(() => ({ open, subscribe }), [open, subscribe])
  const ready = active && loaded?.id === projectId

  return (
    <TaskDrawerContext.Provider value={api}>
      {children}
      {ready && taskId && projectId && (
        <ProjectRoleProvider value={loaded?.project?.myRole}>
          <TaskDrawer
            projectId={projectId}
            taskId={taskId}
            onClose={close}
            onOpenTask={(id) => open(projectId, id)}
            projectName={loaded?.project?.name}
            onOpenProject={() => navigate(taskPageUrl(projectId, taskId))}
          />
        </ProjectRoleProvider>
      )}
    </TaskDrawerContext.Provider>
  )
}
