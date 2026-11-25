import api from './api'
import { GlobalSprint, GlobalSprintOverview, SprintOwner, ProjectNavFolder } from '@/types/projects'
import { Project, ProjectMemberRole, ProjectStatus, ProjectFolder, ProjectListEntity, ProjectMemberWithUser, StatusCategory, Tag, TaskType, Sprint, Task } from '@/types/projects'
import type {
  MyArea, ProjectDashboard, ProjectTimeline, WorkloadData, CompletionCheck,
  BulkResult, TaskWatcher, TaskRelation, TaskRelationType, SavedFilter,
  CustomView, CustomViewType, ProjectWebhook, ProjectWebhookEvent, WebhookDelivery,
} from '@/types/projects'

export async function checkProjectsAccess(): Promise<boolean> {
  try {
    const { data } = await api.get('/projects/access')
    return data.allowed === true
  } catch (error: any) {
    if (error?.response?.status === 403) return false
    throw error
  }
}

export async function listProjects(): Promise<Project[]> {
  const { data } = await api.get('/projects')
  return data.data
}

export async function createProject(input: { name: string; description?: string; privacy?: string; color?: string | null }): Promise<Project> {
  const { data } = await api.post('/projects', input)
  return data.data
}

export async function getProject(projectId: string): Promise<Project> {
  const { data } = await api.get(`/projects/${projectId}`)
  return data.data
}

export async function listProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
  const { data } = await api.get(`/projects/${projectId}/statuses`)
  return data.data
}

export async function addProjectMember(projectId: string, userId: string, role: ProjectMemberRole = 'member') {
  const { data } = await api.post(`/projects/${projectId}/members`, { userId, role })
  return data.data
}

export interface TeamWorkloadEntry {
  userId: string
  name: string
  avatar?: string | null
  taskCount: number
}

export async function getTeamWorkload(): Promise<TeamWorkloadEntry[]> {
  const { data } = await api.get('/projects/team')
  return data.data
}

export interface DashboardGlobal {
  totalTasks: number
  byStatus: Record<string, number>
  overdueCount: number
  upcomingCount: number
}

/** Ciclo (1ª entrada em andamento → conclusão, horas úteis) por tipo de task. */
export interface CycleTimeByType {
  days: number
  byType: Array<{ type: string; color: string | null; tasks: number; avgHours: number; medianHours: number }>
}

/** Lente do BI: projetos de que a equipe participa (padrão) ou os que eu sou dono/gerente. */
export type ReportScope = 'team' | 'mine'

export async function getCycleTimeByType(days: number, scope?: ReportScope): Promise<CycleTimeByType> {
  const { data } = await api.get('/projects/cycle-time', { params: { days, ...(scope ? { scope } : {}) } })
  return data.data
}

export async function getDashboardGlobal(scope?: ReportScope): Promise<DashboardGlobal> {
  const { data } = await api.get('/projects/dashboard-global', scope ? { params: { scope } } : undefined)
  return data.data
}

/** Linha da tabela "Meus projetos" (projetos de que sou dono ou gerente). */
export interface MyProjectReportRow {
  id: string
  name: string
  color: string | null
  openTasks: number
  doneTasks: number
  /** Abertas com prazo vencido (o próprio dia do prazo não conta). */
  overdueTasks: number
  avgCycleHours: number | null
  membersCount: number
}

export async function getMyProjectsReport(days = 90): Promise<{ days: number; projects: MyProjectReportRow[] }> {
  const { data } = await api.get('/projects/reports/my-projects', { params: { days } })
  return data.data
}

/** Meu ciclo por projeto (Minha área): só as tasks em que sou responsável ou co-responsável. */
export interface MyCycle {
  days: number
  projects: Array<{ projectId: string; name: string; color: string | null; done: number; avgCycleHours: number | null; medianCycleHours: number | null; open: number; inProgress: number }>
  recent: Array<{ taskId: string; projectId: string; key: string | null; seq: number; title: string; projectName: string; startedAt: string | null; completedAt: string; cycleHours: number | null }>
  current: Array<{ taskId: string; projectId: string; key: string | null; seq: number; title: string; projectName: string; statusName: string | null; startedAt: string; hoursSoFar: number }>
}

export async function getMyCycle(days: number): Promise<MyCycle> {
  const { data } = await api.get('/projects/my-cycle', { params: { days } })
  return data.data
}

export async function updateProject(projectId: string, input: Partial<{ name: string; description: string | null; privacy: string; color: string | null; startDate: string | null; targetDate: string | null; sprintSourceId: string | null }>): Promise<Project> {
  const { data } = await api.patch(`/projects/${projectId}`, input)
  return data.data
}

export async function archiveProject(projectId: string): Promise<void> {
  await api.delete(`/projects/${projectId}`)
}

export async function listMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
  const { data } = await api.get(`/projects/${projectId}/members`)
  return data.data
}

export async function updateMemberRole(projectId: string, userId: string, role: ProjectMemberRole): Promise<ProjectMemberWithUser> {
  const { data } = await api.patch(`/projects/${projectId}/members/${userId}`, { role })
  return data.data
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/members/${userId}`)
}

export async function listFolders(projectId: string): Promise<ProjectFolder[]> {
  const { data } = await api.get(`/projects/${projectId}/folders`)
  return data.data
}

export async function createFolder(projectId: string, name: string): Promise<ProjectFolder> {
  const { data } = await api.post(`/projects/${projectId}/folders`, { name })
  return data.data
}

export async function listLists(projectId: string): Promise<ProjectListEntity[]> {
  const { data } = await api.get(`/projects/${projectId}/lists`)
  return data.data
}

export async function createList(projectId: string, input: { name: string; description?: string; folderId?: string | null }): Promise<ProjectListEntity> {
  const { data } = await api.post(`/projects/${projectId}/lists`, input)
  return data.data
}

// --- Colaboração ----------------------------------------------------------

export async function getMyArea(): Promise<MyArea> {
  const { data } = await api.get('/projects/me/area')
  return data.data
}

export async function getProjectDashboard(projectId: string): Promise<ProjectDashboard> {
  const { data } = await api.get(`/projects/${projectId}/dashboard`)
  return data.data
}

export async function getProjectTimeline(projectId: string): Promise<ProjectTimeline> {
  const { data } = await api.get(`/projects/${projectId}/timeline`)
  return data.data
}

export async function getProjectWorkload(projectId: string): Promise<WorkloadData> {
  const { data } = await api.get(`/projects/${projectId}/workload`)
  return data.data
}

export async function checkCompletion(projectId: string, taskId: string): Promise<CompletionCheck> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/completion-check`)
  return data.data
}

export async function completeTask(projectId: string, taskId: string, statusId?: string) {
  const { data } = await api.post(`/projects/${projectId}/tasks/${taskId}/complete`, statusId ? { statusId } : {})
  return data.data
}

export type BulkActionKind = 'status' | 'assignee' | 'priority' | 'add_tag' | 'move_list' | 'archive' | 'due_date' | 'start_date' | 'task_type' | 'sprint'

export interface BulkActionInput {
  taskIds: string[]
  action: BulkActionKind
  statusId?: string
  assigneeId?: string | null
  priority?: string
  tagId?: string
  listId?: string | null
  taskTypeId?: string
  sprintId?: string | null
  /** Datas: `date` define a mesma em todas (null limpa); `shiftDays` desloca a de cada uma. */
  date?: string | null
  shiftDays?: number
}

export async function bulkAction(projectId: string, input: BulkActionInput): Promise<BulkResult> {
  const { data } = await api.post(`/projects/${projectId}/tasks/bulk`, input)
  return data.data
}

export async function listWatchers(projectId: string, taskId: string): Promise<TaskWatcher[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/watchers`)
  return data.data
}

export async function addWatcher(projectId: string, taskId: string, userId?: string) {
  const { data } = await api.post(`/projects/${projectId}/tasks/${taskId}/watchers`, userId ? { userId } : {})
  return data.data
}

export async function removeWatcher(projectId: string, taskId: string, userId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/tasks/${taskId}/watchers/${userId}`)
}

export async function listRelations(projectId: string, taskId: string): Promise<TaskRelation[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/relations`)
  return data.data
}

export async function createRelation(projectId: string, taskId: string, toTaskId: string, type: TaskRelationType = 'relates_to') {
  const { data } = await api.post(`/projects/${projectId}/tasks/${taskId}/relations`, { toTaskId, type })
  return data.data
}

export async function removeRelation(projectId: string, taskId: string, relationId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/tasks/${taskId}/relations/${relationId}`)
}

export async function listFavorites(): Promise<Array<{ id: string; entityType: string; entityId: string }>> {
  const { data } = await api.get('/projects/me/favorites')
  return data.data
}

export async function toggleFavorite(entityType: 'project' | 'document', entityId: string, projectId?: string): Promise<{ favorited: boolean }> {
  const { data } = await api.post('/projects/me/favorites', { entityType, entityId, projectId })
  return data.data
}

export async function listSavedFilters(projectId?: string): Promise<SavedFilter[]> {
  const { data } = await api.get('/projects/me/filters', { params: projectId ? { projectId } : undefined })
  return data.data
}

export async function createSavedFilter(input: { name: string; projectId?: string | null; filters: Record<string, unknown> }): Promise<SavedFilter> {
  const { data } = await api.post('/projects/me/filters', input)
  return data.data
}

export async function deleteSavedFilter(filterId: string): Promise<void> {
  await api.delete(`/projects/me/filters/${filterId}`)
}

export async function listCustomViews(projectId: string): Promise<CustomView[]> {
  const { data } = await api.get(`/projects/${projectId}/views`)
  return data.data
}

export async function createCustomView(projectId: string, input: { name: string; type: CustomViewType; filters?: Record<string, unknown> | null; groupBy?: string | null; sortBy?: string | null }): Promise<CustomView> {
  const { data } = await api.post(`/projects/${projectId}/views`, input)
  return data.data
}

export async function deleteCustomView(projectId: string, viewId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/views/${viewId}`)
}

export async function listWebhookEvents(): Promise<ProjectWebhookEvent[]> {
  const { data } = await api.get('/projects/webhook-events')
  return data.data
}

/** Corpo de exemplo do evento — exatamente o JSON que o destino recebe. */
export async function getWebhookEventExample(event: string): Promise<Record<string, unknown>> {
  const { data } = await api.get(`/projects/webhook-events/${encodeURIComponent(event)}/example`)
  return data.data.payload
}

/** JSON Schema (draft-07) do evento, para o Power Automate / Zapier. */
export async function getWebhookEventSchema(event: string): Promise<Record<string, unknown>> {
  const { data } = await api.get(`/projects/webhook-events/${encodeURIComponent(event)}/schema`)
  return data.data.payload
}

// Webhooks são globais ao módulo Projetos (não aninhados sob um projeto) —
// cada webhook seleciona a lista de projetos aos quais se aplica.
export async function listWebhooks(): Promise<ProjectWebhook[]> {
  const { data } = await api.get('/projects/webhooks')
  return data.data
}

export interface WebhookInput {
  name: string
  description?: string | null
  url: string
  events: string[]
  active?: boolean
  projectIds: string[]
}

export async function createWebhook(input: WebhookInput): Promise<ProjectWebhook> {
  const { data } = await api.post('/projects/webhooks', input)
  return data.data
}

export async function updateWebhook(webhookId: string, input: Partial<WebhookInput>): Promise<ProjectWebhook> {
  const { data } = await api.patch(`/projects/webhooks/${webhookId}`, input)
  return data.data
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  await api.delete(`/projects/webhooks/${webhookId}`)
}

export interface DeliveriesPage {
  data: WebhookDelivery[]
  meta: { total: number; page: number; pages: number }
}

export async function listWebhookDeliveries(webhookId: string, page = 1, status?: string): Promise<DeliveriesPage> {
  const { data } = await api.get(`/projects/webhooks/${webhookId}/deliveries`, { params: { page, ...(status ? { status } : {}) } })
  return data
}

export async function resendDelivery(webhookId: string, deliveryId: string) {
  const { data } = await api.post(`/projects/webhooks/${webhookId}/deliveries/${deliveryId}/resend`)
  return data.data
}

/** Ping síncrono só para este webhook: devolve o resultado da tentativa. */
export async function testWebhook(webhookId: string): Promise<{ status: string; responseStatus: number | null; durationMs: number | null; errorMessage: string | null } | null> {
  const { data } = await api.post(`/projects/webhooks/${webhookId}/test`)
  return data.data
}

/** Troca o secret; o novo volta só nesta resposta. */
export async function regenerateWebhookSecret(webhookId: string): Promise<ProjectWebhook> {
  const { data } = await api.post(`/projects/webhooks/${webhookId}/regenerate-secret`)
  return data.data
}

// --- Gerenciamento de status -----------------------------------------

export async function createStatusFull(projectId: string, input: { name: string; color: string; category: StatusCategory; afterId?: string; wipLimit?: number | null }): Promise<ProjectStatus> {
  const { data } = await api.post(`/projects/${projectId}/statuses`, input)
  return data.data
}

export async function updateStatus(projectId: string, statusId: string, input: Partial<{ name: string; color: string; category: StatusCategory; requiresApproval: boolean; wipLimit: number | null }>): Promise<ProjectStatus> {
  const { data } = await api.patch(`/projects/${projectId}/statuses/${statusId}`, input)
  return data.data
}

export async function reorderStatuses(projectId: string, statusIds: string[]): Promise<ProjectStatus[]> {
  const { data } = await api.patch(`/projects/${projectId}/statuses/reorder`, { statusIds })
  return data.data
}

export async function deleteStatus(projectId: string, statusId: string, reassignToId: string): Promise<{ movedTaskCount: number }> {
  const { data } = await api.delete(`/projects/${projectId}/statuses/${statusId}`, { data: { reassignToId } })
  return data.data
}

// --- Tipos de tarefa (por projeto) ------------------------------------------

export async function listTaskTypes(projectId: string): Promise<TaskType[]> {
  const { data } = await api.get(`/projects/${projectId}/task-types`)
  return data.data
}

export async function createTaskType(projectId: string, input: { name: string; icon: string; color: string; prefix?: string }): Promise<TaskType> {
  const { data } = await api.post(`/projects/${projectId}/task-types`, input)
  return data.data
}

export async function updateTaskType(projectId: string, taskTypeId: string, input: Partial<{ name: string; icon: string; color: string; prefix: string }>): Promise<TaskType> {
  const { data } = await api.patch(`/projects/${projectId}/task-types/${taskTypeId}`, input)
  return data.data
}

/** As tasks do tipo excluído vão para `replacementTypeId` (padrão: Tarefa) e ganham ID novo. */
export async function deleteTaskType(projectId: string, taskTypeId: string, replacementTypeId?: string): Promise<void> {
  await api.delete(`/projects/${projectId}/task-types/${taskTypeId}`, { params: replacementTypeId ? { replacementTypeId } : undefined })
}

// --- Sprints (por projeto) ---------------------------------------------------

export async function listSprints(projectId: string): Promise<Sprint[]> {
  const { data } = await api.get(`/projects/${projectId}/sprints`)
  return data.data
}

export async function createSprint(projectId: string, input: { name: string; startDate?: string | null; endDate?: string | null }): Promise<Sprint> {
  const { data } = await api.post(`/projects/${projectId}/sprints`, input)
  return data.data
}

export async function updateSprint(projectId: string, sprintId: string, input: Partial<{ name: string; startDate: string | null; endDate: string | null }>): Promise<Sprint> {
  const { data } = await api.patch(`/projects/${projectId}/sprints/${sprintId}`, input)
  return data.data
}

export async function deleteSprint(projectId: string, sprintId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/sprints/${sprintId}`)
}

export async function startSprint(projectId: string, sprintId: string): Promise<Sprint> {
  const { data } = await api.post(`/projects/${projectId}/sprints/${sprintId}/start`)
  return data.data
}

export async function completeSprint(projectId: string, sprintId: string): Promise<Sprint> {
  const { data } = await api.post(`/projects/${projectId}/sprints/${sprintId}/complete`)
  return data.data
}

type SprintInput = { name: string; startDate?: string | null; endDate?: string | null }

/** Operações que o SprintManager usa — por projeto ou no calendário global de um Gerente. */
export interface SprintApi<S extends { id: string } = Sprint | GlobalSprint> {
  list: () => Promise<S[]>
  create: (input: SprintInput) => Promise<S>
  update: (id: string, input: Partial<SprintInput>) => Promise<S>
  remove: (id: string) => Promise<void>
  start: (id: string) => Promise<S>
  complete: (id: string) => Promise<S>
}

// --- Sprints globais (calendário por Gerente) -------------------------------

export async function listSprintOwners(): Promise<SprintOwner[]> {
  const { data } = await api.get('/projects/global-sprints/owners')
  return data.data
}

export async function listGlobalSprints(ownerId: string): Promise<GlobalSprint[]> {
  const { data } = await api.get('/projects/global-sprints', { params: { ownerId } })
  return data.data
}

export async function getGlobalSprintOverview(id: string): Promise<GlobalSprintOverview> {
  const { data } = await api.get(`/projects/global-sprints/${id}/overview`)
  return data.data
}

export function globalSprintApi(ownerId: string): SprintApi {
  const base = '/projects/global-sprints'
  return {
    list: () => listGlobalSprints(ownerId),
    create: async (input) => (await api.post(base, { ...input, ownerId })).data.data,
    update: async (id, input) => (await api.patch(`${base}/${id}`, input)).data.data,
    remove: async (id) => { await api.delete(`${base}/${id}`) },
    start: async (id) => (await api.post(`${base}/${id}/start`)).data.data,
    complete: async (id) => (await api.post(`${base}/${id}/complete`)).data.data,
  }
}

// --- Pastas da sidebar (compartilhadas) --------------------------------------

export async function listNavFolders(): Promise<ProjectNavFolder[]> {
  const { data } = await api.get('/projects/nav-folders')
  return data.data
}

export async function createNavFolder(input: { name: string; parentId?: string | null }): Promise<ProjectNavFolder> {
  const { data } = await api.post('/projects/nav-folders', input)
  return data.data
}

export async function updateNavFolder(id: string, input: Partial<{ name: string; parentId: string | null }>): Promise<ProjectNavFolder> {
  const { data } = await api.patch(`/projects/nav-folders/${id}`, input)
  return data.data
}

export async function deleteNavFolder(id: string): Promise<void> {
  await api.delete(`/projects/nav-folders/${id}`)
}

export async function moveProjectToNavFolder(projectId: string, folderId: string | null): Promise<void> {
  await api.put(`/projects/${projectId}/nav-folder`, { folderId })
}

// --- Tags (por projeto) -----------------------------------------------------

export async function listTags(projectId: string): Promise<Tag[]> {
  const { data } = await api.get(`/projects/${projectId}/tags`)
  return data.data
}

export async function createTag(projectId: string, input: { name: string; color: string }): Promise<Tag> {
  const { data } = await api.post(`/projects/${projectId}/tags`, input)
  return data.data
}

export async function deleteTag(projectId: string, tagId: string): Promise<{ removedFrom: number }> {
  const { data } = await api.delete(`/projects/${projectId}/tags/${tagId}`)
  return data.data
}

// --- Documentos do projeto (para atrelar a uma task) ------------------------

export interface ProjectDocumentSummary {
  id: string
  title: string
}

export async function listProjectDocuments(projectId: string): Promise<ProjectDocumentSummary[]> {
  const { data } = await api.get(`/projects/${projectId}/docs`)
  return data.data
}

// --- Anexos do projeto (arquivos avulsos ou atrelados a uma task) ----------

export interface ProjectAttachment {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  url: string
  createdAt: string
  entityType: 'task' | 'comment' | 'document'
  entityId: string
  /** Quem enviou (a listagem traz; o upload devolve só o id em uploadedBy). */
  uploader?: { id: string; name: string } | null
  uploadedBy?: string
  /** Task de origem: a do anexo direto ou a do comentário. */
  task?: { id: string; key: string | null; title: string } | null
}

/** `mimeType` filtra por prefixo (ex: "image/") — não confundir com entityType, que a API não filtra no servidor. */
export async function listAttachments(projectId: string, mimeType?: string, taskId?: string): Promise<ProjectAttachment[]> {
  const params = { ...(mimeType ? { type: mimeType } : {}), ...(taskId ? { taskId } : {}) }
  const { data } = await api.get(`/projects/${projectId}/files`, { params })
  return data.data
}

export async function uploadAttachment(projectId: string, input: { entityType: 'task' | 'comment' | 'document'; entityId: string; fileName: string; dataUri: string }): Promise<ProjectAttachment> {
  const { data } = await api.post(`/projects/${projectId}/files`, input)
  return data.data
}

// --- Ponte chamado ↔ task -------------------------------------------

export interface TaskTicket {
  id: string
  displayNumber: string
  title: string
  status: string
  pendingReason: string | null
  slaDeadline: string
  /** Previsão (prazo da task) vencida e já avisada pelo job. */
  projectForecastAlertedAt?: string | null
  org: { name: string } | null
}

export async function listTaskTickets(projectId: string, taskId: string): Promise<TaskTicket[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/tickets`)
  return data.data
}

/** `ticket` aceita o id ou o número (ex.: ISA-1234). Devolve a lista atualizada. */
export async function linkTicketToTask(projectId: string, taskId: string, ticket: string): Promise<TaskTicket[]> {
  const { data } = await api.post(`/projects/${projectId}/tasks/${taskId}/tickets`, { ticket })
  return data.data
}

export async function unlinkTicketFromTask(projectId: string, taskId: string, ticketId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/tasks/${taskId}/tickets/${ticketId}`)
}

export interface BulkLinkResult {
  linked: string[]
  failed: Array<{ ref: string; error: string }>
  tickets: TaskTicket[]
}

/** Vários chamados de uma vez: não atômico, devolve quem falhou e por quê. */
export async function linkTicketsBulk(projectId: string, taskId: string, tickets: string[]): Promise<BulkLinkResult> {
  const { data } = await api.post(`/projects/${projectId}/tasks/${taskId}/tickets/bulk`, { tickets })
  return data.data
}

export interface CreateTaskFromTicketInput {
  ticket: string
  taskTypeId: string
  dueDate: string
  title?: string
  assigneeId?: string | null
}

/** Cria a task no projeto a partir do chamado e já vincula (o chamado passa a seguir o prazo). */
export async function createTaskFromTicket(projectId: string, input: CreateTaskFromTicketInput): Promise<{ task: Task }> {
  const { data } = await api.post(`/projects/${projectId}/tasks/from-ticket`, input)
  return data.data
}

// --- Tempo por task/projeto e gestão ------------------------------------------
// Conta em andamento/revisão; backlog e a fazer pausam; concluída para. Minutos úteis.

export interface TaskTime {
  activeMinutes: number
  wallActiveMinutes: number
  running: boolean
  startedAt: string | null
  completedAt: string | null
  byStatus: Array<{ statusId: string; name: string; category: string; minutes: number }>
  byPerson: Array<{ userId: string | null; name: string; minutes: number }>
}

export interface ProjectTime {
  tasks: Array<{ taskId: string; seq: number; key?: string | null; title: string; status: { name: string; category: string } | null; activeMinutes: number; wallActiveMinutes: number; running: boolean; startedAt: string | null; completedAt: string | null }>
  totals: { activeMinutes: number; runningTasks: number; doneTasks: number; avgMinutesPerDoneTask: number | null }
  byPerson: Array<{ userId: string | null; name: string; activeMinutes: number }>
}

export interface PortfolioTime {
  projects: Array<{ projectId: string; name: string; activeMinutes: number; runningTasks: number; doneTasks: number; avgMinutesPerDoneTask: number | null }>
  byPerson: Array<{ userId: string | null; name: string; activeMinutes: number; canOpen?: boolean }>
}

export interface LinkedTicket {
  id: string
  displayNumber: string
  title: string
  slaDeadline: string
  org: { name: string } | null
  projectTask: { id: string; seq: number; key?: string | null; title: string; dueDate: string | null; project: { id: string; name: string } } | null
  linkedAt: string | null
  linkedBy: string | null
}

export async function getTaskTime(projectId: string, taskId: string): Promise<TaskTime> {
  const { data } = await api.get(`/projects/${projectId}/tasks/${taskId}/time`)
  return data.data
}

export async function getProjectTime(projectId: string): Promise<ProjectTime> {
  const { data } = await api.get(`/projects/${projectId}/time`)
  return data.data
}

export async function getPortfolioTime(): Promise<PortfolioTime> {
  const { data } = await api.get('/projects/time-summary')
  return data.data
}

export async function listLinkedTickets(): Promise<LinkedTicket[]> {
  const { data } = await api.get('/projects/linked-tickets')
  return data.data
}

// ---------------------------------------------------------------------------
// Backup (exportar / importar)
// ---------------------------------------------------------------------------

export interface ImportPreview {
  format: 'backup' | 'clickup'
  projects: Array<{ name: string; tasks: number; statuses: string[]; lists: string[]; members: number }>
  totalTasks: number
  peopleFound: string[]
  peopleMissing: string[]
  unmappedAssignees: string[]
}

export interface ImportResult {
  format: 'backup' | 'clickup'
  projects: Array<{ id: string; name: string; tasks: number }>
}

export async function exportProjectBackup(projectId: string): Promise<unknown> {
  const { data } = await api.get(`/projects/${projectId}/export`)
  return data.data
}

export async function previewProjectImport(file: unknown): Promise<ImportPreview> {
  const { data } = await api.post('/projects/import/preview', file)
  return data.data
}

export async function importProjects(file: unknown): Promise<ImportResult> {
  const { data } = await api.post('/projects/import', file, { timeout: 180_000 })
  return data.data
}

// --- Gráficos (Visão geral, Tempo, Equipe, Minha área, BI) --------------------------
export interface ProjectInsights {
  byType: Array<{ name: string; prefix: string; color: string; total: number; done: number }>
  onTime: { onTime: number; late: number; pct: number | null }
  daily: Array<{ date: string; created: number; completed: number; open: number; doneTotal: number; minutes: number; hours: number }>
  weekly: Array<{ week: string; completed: number }>
  events: Array<{ date: string; week: string; label: string; detail: string }>
  burndown: null | {
    sprint: { id: string; name: string; start: string; end: string }
    unit: 'pontos' | 'tasks'
    total: number
    days: Array<{ date: string; remaining: number | null; ideal: number }>
  }
}

export async function getProjectInsights(projectId: string): Promise<ProjectInsights> {
  const { data } = await api.get(`/projects/${projectId}/insights`)
  return data.data
}

/** Portfólio: todos os projetos de que o usuário é membro. */
export async function getPortfolioInsights(): Promise<ProjectInsights> {
  const { data } = await api.get('/projects/insights')
  return data.data
}

/** Atividade por dia (mapa de calor): do time, de uma pessoa ou 'me'. */
export async function getProjectsActivity(userId?: string): Promise<Array<{ date: string; count: number }>> {
  const { data } = await api.get('/projects/activity', { params: userId ? { userId } : {} })
  return data.data
}

/** Baixa o dossiê (HTML ou Excel) dos projetos escolhidos — ou de todos os visíveis, sem projectIds. */
export async function downloadProjectsExport(params: { format: 'html' | 'xlsx'; projectIds?: string[]; from?: string; to?: string }): Promise<void> {
  try {
    const { data } = await api.get('/projects/export', {
      params: { format: params.format, projectIds: params.projectIds?.join(',') || undefined, from: params.from || undefined, to: params.to || undefined },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = `dossie-projetos-${new Date().toLocaleDateString('sv-SE')}.${params.format}`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error: any) {
    // Com responseType blob o erro também chega como Blob: lê a mensagem do JSON.
    const blob = error?.response?.data
    if (blob instanceof Blob) {
      const body = JSON.parse((await blob.text().catch(() => '')) || '{}')
      throw new Error(body.error || 'Não foi possível gerar o dossiê.')
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Chaves da API pública de Projetos (/api/integrations/v1/projects)
// ---------------------------------------------------------------------------

export interface ProjectApiKey {
  id: string
  name: string
  description: string | null
  keyPrefix: string
  scopes: string[]
  active: boolean
  createdBy: string
  serviceUserId: string
  lastUsedAt: string | null
  createdAt: string
  projectIds: string[]
  requestsCount?: number
  /** Só na criação e na regeneração. */
  key?: string
}

export interface ProjectApiKeyInput {
  name: string
  description?: string | null
  scopes: string[]
  active?: boolean
  projectIds: string[]
}

export interface ApiRequestRow {
  id: string
  method: string
  path: string
  status: 'received' | 'processing' | 'success' | 'duplicate' | 'failed'
  responseStatus: number | null
  errorCode: string | null
  errorMessage: string | null
  resourceType: string | null
  resourceId: string | null
  externalRequestId: string | null
  requestPayload?: unknown
  createdAt: string
}

export async function listProjectApiScopes(): Promise<string[]> {
  const { data } = await api.get('/projects/api-scopes')
  return data.data
}

export async function listProjectApiKeys(): Promise<ProjectApiKey[]> {
  const { data } = await api.get('/projects/api-keys')
  return data.data
}

export async function createProjectApiKey(input: ProjectApiKeyInput): Promise<ProjectApiKey> {
  const { data } = await api.post('/projects/api-keys', input)
  return data.data
}

export async function updateProjectApiKey(keyId: string, input: Partial<ProjectApiKeyInput>): Promise<ProjectApiKey> {
  const { data } = await api.patch(`/projects/api-keys/${keyId}`, input)
  return data.data
}

export async function regenerateProjectApiKey(keyId: string): Promise<ProjectApiKey> {
  const { data } = await api.post(`/projects/api-keys/${keyId}/regenerate`)
  return data.data
}

export async function deleteProjectApiKey(keyId: string): Promise<void> {
  await api.delete(`/projects/api-keys/${keyId}`)
}

export async function listProjectApiKeyRequests(keyId: string, page = 1): Promise<{ data: ApiRequestRow[]; meta: { total: number; page: number; pages: number } }> {
  const { data } = await api.get(`/projects/api-keys/${keyId}/requests`, { params: { page } })
  return data
}
