import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/** Parâmetros da URL com a task aberta sobre a tela atual (fora da página de tasks do projeto). */
export const TASK_PARAM = 'task'
export const TASK_PROJECT_PARAM = 'taskProject'

/** Página de tasks do projeto, com a task aberta: destino do atalho "ir ao projeto". */
export const taskPageUrl = (projectId: string, taskId: string) =>
  `/projetos/${encodeURIComponent(projectId)}/tasks?task=${encodeURIComponent(taskId)}`

export interface TaskDrawerApi {
  open: (projectId: string, taskId: string) => void
  /** Avisa quando o drawer fecha (botão, Esc ou voltar do navegador). Devolve o cancelamento. */
  subscribe: (onClosed: () => void) => () => void
}

export const TaskDrawerContext = createContext<TaskDrawerApi | null>(null)

/**
 * Abre a task num drawer sobre a tela atual, sem trocar de página.
 * `onClosed` serve para a tela recarregar o que mostra depois das edições.
 * Fora do TaskDrawerHost, cai na página de tasks do projeto.
 */
export function useTaskDrawer(onClosed?: () => void) {
  const ctx = useContext(TaskDrawerContext)
  const navigate = useNavigate()
  const latest = useRef(onClosed)
  useEffect(() => { latest.current = onClosed })
  useEffect(() => ctx?.subscribe(() => latest.current?.()), [ctx])

  const openTask = useCallback((projectId: string, taskId: string) => {
    if (ctx) ctx.open(projectId, taskId)
    else navigate(taskPageUrl(projectId, taskId))
  }, [ctx, navigate])

  return { openTask }
}
