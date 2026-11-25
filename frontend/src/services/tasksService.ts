import api from './api'
import { Task, ChecklistItem, TaskComment, TaskDetail } from '@/types/projects'

export interface TaskFilters {
  status?: string
  assignee?: string
  listId?: string
}

export async function listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks`, { params: filters })
  return data.data
}

export interface CreateTaskInput {
  title: string
  statusId: string
  parentId?: string | null
  description?: string | null
  listId?: string | null
  taskTypeId?: string | null
  sprintId?: string | null
  storyPoints?: number | null
  priority?: Task['priority']
  assigneeId?: string | null
  startDate?: string | null
  dueDate?: string | null
  isMilestone?: boolean
}

export async function createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
  const { data } = await api.post(`/projects/${projectId}/tasks`, input)
  return data.data
}

export type UpdateTaskInput = Partial<CreateTaskInput>

export async function updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
  const { data } = await api.patch(`/projects/${projectId}/tasks/${taskId}`, input)
  return data.data
}

export async function getTask(projectId: string, taskId: string): Promise<TaskDetail> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}`)
  return data.data
}

export async function addTagToTask(projectId: string, taskId: string, tagId: string): Promise<void> {
  await api.post(`/projects/${projectId}/tasks/${taskId}/tags/${tagId}`)
}

export async function removeTagFromTask(projectId: string, taskId: string, tagId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/tasks/${taskId}/tags/${tagId}`)
}

export async function linkTaskDocument(projectId: string, taskId: string, documentId: string): Promise<void> {
  await api.post(`/projects/${projectId}/tasks/${taskId}/documents/${documentId}`)
}

export async function unlinkTaskDocument(projectId: string, taskId: string, documentId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/tasks/${taskId}/documents/${documentId}`)
}

export async function listChecklist(projectId: string, taskId: string): Promise<ChecklistItem[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}`)
  return data.data.checklist ?? []
}

export async function createChecklistItem(projectId: string, taskId: string, text: string): Promise<ChecklistItem> {
  const { data } = await api.post(`/projects/${projectId}/tasks/${taskId}/checklist`, { text })
  return data.data
}

export async function toggleChecklistItem(projectId: string, taskId: string, itemId: string, done: boolean): Promise<ChecklistItem> {
  const { data } = await api.patch(`/projects/${projectId}/tasks/${taskId}/checklist/${itemId}`, { done })
  return data.data
}

export async function deleteChecklistItem(projectId: string, taskId: string, itemId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/tasks/${taskId}/checklist/${itemId}`)
}

export async function listComments(projectId: string, taskId: string): Promise<TaskComment[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/comments`)
  return data.data
}

export async function createComment(projectId: string, taskId: string, body: string): Promise<TaskComment> {
  const { data } = await api.post(`/projects/${projectId}/tasks/${taskId}/comments`, { body })
  return data.data
}

export async function editComment(projectId: string, taskId: string, commentId: string, body: string): Promise<TaskComment> {
  const { data } = await api.patch(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`, { body })
  return data.data
}

export async function deleteComment(projectId: string, taskId: string, commentId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`)
}

/** Todos os responsáveis da task (o primeiro é o principal, espelhado em assigneeId). */
export async function listTaskAssignees(projectId: string, taskId: string): Promise<string[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/assignees`)
  return data.data
}

export async function setTaskAssignees(projectId: string, taskId: string, userIds: string[]): Promise<string[]> {
  const { data } = await api.put(`/projects/${projectId}/tasks/${taskId}/assignees`, { userIds })
  return data.data
}
