import api from './api'

export type AutomationTrigger =
  | 'task_created' | 'status_changed' | 'assignee_changed' | 'due_date_reached'
  | 'task_overdue' | 'task_completed' | 'subtasks_completed' | 'priority_changed'
  | 'approval_decided' | 'comment_created'

export type AutomationAction =
  | { type: 'change_status'; statusId: string }
  | { type: 'change_assignee'; assigneeId: string }
  | { type: 'change_priority'; priority: string }
  | { type: 'add_tag'; tagId: string }
  | { type: 'send_notification'; userId: string; message: string }
  | { type: 'request_approval'; approverId: string }
  | { type: 'move_list'; listId: string }
  | { type: 'add_comment'; body: string }

export interface Automation {
  id: string
  name: string
  trigger: AutomationTrigger
  actions: AutomationAction[]
  isActive: boolean
}

export interface CreateAutomationInput {
  name: string
  trigger: AutomationTrigger
  conditions?: Array<{ field: string; operator: 'equals' | 'not_equals'; value: string }>
  actions: AutomationAction[]
}

export async function listAutomations(projectId: string): Promise<Automation[]> {
  const { data } = await api.get(`/projects/${projectId}/automations`)
  return data.data
}

export async function createAutomation(projectId: string, input: CreateAutomationInput): Promise<Automation> {
  const { data } = await api.post(`/projects/${projectId}/automations`, input)
  return data.data
}

export async function setAutomationActive(projectId: string, automationId: string, isActive: boolean): Promise<Automation> {
  const { data } = await api.patch(`/projects/${projectId}/automations/${automationId}`, { isActive })
  return data.data
}
