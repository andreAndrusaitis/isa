import api from './api'
import type { ReportScope } from './projectsService'

type Person = { id: string; name: string; avatar?: string | null }

export interface DrillTaskRow {
  taskId: string
  projectId: string
  projectName: string
  projectColor: string | null
  key?: string | null
  seq: number
  title: string
  status: { name: string; color: string | null; category: string }
  priority: string
  dueDate: string | null
  assignee: Person | null
  overdue: boolean
  activeMinutes: number
  running: boolean
  startedAt: string | null
  completedAt: string | null
  cycleHours: number | null
}

export type WeekFlow = { weekStart: string; completed: number; created: number }

export interface ProjectDrill {
  project: {
    id: string; name: string; description: string | null; color: string | null; privacy: string
    startDate: string | null; targetDate: string | null
    owner: Person | null
    _count?: { members: number }
    count?: { members: number }
  }
  totals: {
    total: number; open: number; done: number; cancelled: number; overdue: number; upcoming: number; running: number
    pendingApprovals: number; progress: number; activeMinutes: number; linkedTickets: number
    avgCycleHours: number | null; medianCycleHours: number | null
  }
  sprint: { id: string; name: string; startDate: string | null; endDate: string | null; total: number; done: number } | null
  byStatus: Array<{ statusId: string; name: string; color: string; count: number }>
  byPriority: Record<string, number>
  weekly: WeekFlow[]
  people: Array<{ userId: string; name: string; avatar: string | null; open: number; overdue: number; running: number; done: number }>
  overdue: DrillTaskRow[]
  upcoming: DrillTaskRow[]
  running: DrillTaskRow[]
  milestones: Array<{ id: string; seq: number; key?: string | null; title: string; dueDate: string | null; status: { name: string; color: string; category: string } }>
  recentActivity: Array<{ id: string; type: string; createdAt: string; actor: Person; task: { id: string; seq: number; key?: string | null; title: string } }>
}

export interface PersonDrill {
  days: number
  person: { id: string; name: string; avatar: string | null; department: string | null; manager: { name: string } | null }
  scopedTo: string | null
  totals: { open: number; overdue: number; upcoming: number; running: number; done: number; activeMinutes: number; avgCycleHours: number | null; medianCycleHours: number | null }
  byProject: Array<{ projectId: string; name: string; color: string | null; open: number; overdue: number; running: number; done: number; avgCycleHours: number | null }>
  weekly: WeekFlow[]
  running: DrillTaskRow[]
  overdue: DrillTaskRow[]
  upcoming: DrillTaskRow[]
  recent: DrillTaskRow[]
}

export interface DrillTaskQuery {
  projectId?: string
  scope?: ReportScope
  kind?: 'all' | 'open' | 'done' | 'overdue' | 'upcoming' | 'running'
  categories?: string
  statusId?: string
  priority?: string
  type?: string
  assigneeId?: string
  days?: number
}

export interface TaskListDrill {
  total: number
  limit: number
  tasks: DrillTaskRow[]
  byProject: Array<{ projectId: string; name: string; color: string | null; count: number }>
  byAssignee: Array<{ userId: string | null; name: string; avatar: string | null; count: number; canOpen: boolean }>
}

/** Evento do histórico da task, com ids já trocados por nomes. */
export interface TaskActivityEvent {
  id: string
  type: string
  createdAt: string
  actor: Person
  from?: string | null
  to?: string | null
  added?: string[]
  removed?: string[]
  action?: 'added' | 'done' | 'reopened' | 'removed'
}

type TaskRef = { id: string; seq: number; key?: string | null; title: string }

export interface TaskDrill {
  id: string
  projectId: string
  project: { id: string; name: string }
  key?: string | null
  seq: number
  title: string
  description: string | null
  priority: string
  status: { id: string; name: string; category: string; color: string }
  taskType: { id: string; name: string; color: string } | null
  list: { id: string; name: string } | null
  sprint: { id: string; name: string } | null
  parent: TaskRef | null
  assignees: Person[]
  creator: Person
  createdAt: string
  startDate: string | null
  dueDate: string | null
  isMilestone: boolean
  storyPoints: number | null
  archivedAt: string | null
  tags: Array<{ id: string; name: string; color: string }>
  checklist: Array<{ id: string; text: string; done: boolean }>
  subtasks: Array<TaskRef & { dueDate: string | null; status: { id: string; name: string; category: string } }>
  blockedBy: TaskRef[]
  blocks: TaskRef[]
  tickets: Array<{ id: string; displayNumber: string; title: string; status: string }>
  documents: Array<{ id: string; title: string }>
  commentsCount: number
  comments: Array<{ id: string; body: string; createdAt: string; author: Person }>
  time: {
    activeMinutes: number; running: boolean; startedAt: string | null; completedAt: string | null; cycleMinutes: number | null
    byStatus: Array<{ statusId: string; name: string; category: string; minutes: number }>
    byPerson: Array<{ userId: string | null; name: string; minutes: number }>
  } | null
  timeline: TaskActivityEvent[]
}

export async function getProjectDrill(projectId: string): Promise<ProjectDrill> {
  const { data } = await api.get(`/projects/${projectId}/drill`)
  return data.data
}

export async function getTaskDrill(projectId: string, taskId: string): Promise<TaskDrill> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/drill`)
  return data.data
}

export async function getPersonDrill(userId: string, projectId?: string): Promise<PersonDrill> {
  const { data } = await api.get(`/projects/drill/people/${userId}`, { params: projectId ? { projectId } : {} })
  return data.data
}

export async function getTaskListDrill(query: DrillTaskQuery): Promise<TaskListDrill> {
  const { data } = await api.get('/projects/drill/tasks', { params: query })
  return data.data
}

export async function listTaskActivity(projectId: string, taskId: string): Promise<TaskActivityEvent[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/activity`)
  return data.data
}
