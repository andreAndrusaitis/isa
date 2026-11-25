import { createContext, useContext } from 'react'
import type { DrillTaskQuery } from '@/services/drillService'
import type { ProjectHealth } from '@/components/projects/projectHealth'

export type DrillProjectItem = {
  id: string; name: string; color?: string | null; progress?: number; openTasks?: number; overdueTasks?: number; health?: ProjectHealth
}

/** O que o modal mostra. `title` vem de quem abre: o cabeçalho aparece antes dos dados. */
export type DrillView =
  | { kind: 'project'; projectId: string; title: string }
  | { kind: 'person'; userId: string; title: string; projectId?: string }
  | { kind: 'task'; projectId: string; taskId: string; title: string }
  | { kind: 'tasks'; title: string; subtitle?: string; query: DrillTaskQuery }
  | { kind: 'projects'; title: string; subtitle?: string; items: DrillProjectItem[] }

/** Sem provider (telas isoladas em teste), abrir não faz nada. */
export const DrillContext = createContext<{ open: (view: DrillView) => void }>({ open: () => {} })

export const useDrill = () => useContext(DrillContext)

export function drillKey(v: DrillView) {
  switch (v.kind) {
    case 'project': return `project:${v.projectId}`
    case 'person': return `person:${v.userId}:${v.projectId ?? ''}`
    case 'task': return `task:${v.taskId}`
    case 'tasks': return `tasks:${JSON.stringify(v.query)}`
    case 'projects': return `projects:${v.title}`
  }
}
