export type ProjectPrivacy = 'private' | 'organization' | 'restricted'
export type ProjectMemberRole = 'owner' | 'manager' | 'member' | 'viewer'
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'none'
export type StatusCategory = 'backlog' | 'open' | 'in_progress' | 'in_review' | 'done' | 'cancelled'

export interface Project {
  id: string
  name: string
  description: string | null
  privacy: ProjectPrivacy
  ownerId: string
  /** Cor de identidade (#rrggbb); null = cor padrão do tema. */
  color?: string | null
  startDate: string | null
  targetDate: string | null
  /** null = sprints próprios; id do Gerente = segue o calendário global dele. */
  sprintSourceId?: string | null
  /** Pasta da sidebar (árvore compartilhada). */
  navFolderId?: string | null
  archivedAt: string | null
  /** Papel de quem pediu (GET /projects/:id); o front esconde o que o backend recusaria. */
  myRole?: 'owner' | 'manager' | 'member' | 'viewer' | null
  /** Números do card (só em GET /projects). */
  memberCount?: number
  totalTasks?: number
  doneTasks?: number
  openTasks?: number
  overdueTasks?: number
  progress?: number
  /** Visível só porque alguém da equipe do Gerente participa (leitura). */
  teamOnly?: boolean
}

export const PRIVACY_LABEL: Record<ProjectPrivacy, string> = {
  private: 'Privado',
  organization: 'Organização',
  restricted: 'Restrito',
}

export interface ProjectStatus {
  id: string
  projectId: string
  name: string
  color: string
  category: StatusCategory
  position: number
  isActive: boolean
  requiresApproval: boolean
  wipLimit?: number | null
}

export interface TaskType {
  id: string
  projectId: string
  name: string
  icon: string
  color: string
  position: number
  /** Prefixo do ID das tasks deste tipo (BUG, FEAT…), único no projeto. */
  prefix: string
  nextNumber: number
}

export type SprintStatus = 'planned' | 'active' | 'completed'

export interface Sprint {
  id: string
  projectId: string
  name: string
  status: SprintStatus
  startDate: string | null
  endDate: string | null
  position: number
  /** Cópia de um sprint global (gerido no calendário do Gerente). */
  globalSprintId?: string | null
}

export interface GlobalSprint {
  id: string
  ownerId: string
  name: string
  status: SprintStatus
  startDate: string | null
  endDate: string | null
  position: number
}

export interface SprintOwner { id: string; name: string; role: string }

export interface GlobalSprintOverview {
  sprint: GlobalSprint
  /** Restante por dia somando os projetos (null se a sprint não tem datas). */
  burndown: { unit: 'pontos' | 'tasks'; total: number; days: Array<{ date: string; remaining: number | null; ideal: number }> } | null
  projects: Array<{
    id: string
    name: string
    color: string | null
    sprintId: string
    tasks: Array<{
      id: string
      seq: number
      key: string | null
      title: string
      priority: TaskPriority
      storyPoints: number | null
      dueDate: string | null
      status: { id: string; name: string; color: string; category: StatusCategory }
      assignee: { id: string; name: string; avatar: string | null } | null
    }>
  }>
}

export interface ProjectNavFolder { id: string; name: string; parentId: string | null }

export interface Task {
  id: string
  projectId: string
  listId: string | null
  statusId: string
  parentId: string | null
  seq: number
  /** ID por tipo, ex.: "BUG-12". Ausente só em respostas antigas — usar taskLabel(). */
  key?: string | null
  typeNumber?: number | null
  title: string
  description: string | null
  priority: TaskPriority
  assigneeId: string | null
  creatorId: string
  startDate: string | null
  dueDate: string | null
  isMilestone: boolean
  archivedAt: string | null
  tags?: Array<{ taskId: string; tagId: string; tag: Tag }>
  multiAssignees?: Array<{ taskId: string; userId: string; user: UserRef }>
  blockedBy?: Array<{ id: string; taskId: string; dependsOnId: string }>
  subtasksCount?: number
  commentsCount?: number
  taskTypeId?: string | null
  taskType?: TaskType | null
  storyPoints?: number | null
  sprintId?: string | null
  sprint?: Sprint | null
}

export interface ChecklistItem {
  id: string
  taskId: string
  text: string
  done: boolean
  position: number
}

export interface TaskComment {
  id: string
  taskId: string
  authorId: string
  body: string
  editedAt: string | null
  createdAt: string
}

export interface Tag {
  id: string
  projectId: string
  name: string
  color: string
  /** Em quantas tasks a tag está. Só vem na lista das configurações do projeto. */
  taskCount?: number
}

export interface TaskDocumentLink {
  taskId: string
  documentId: string
  document: { id: string; title: string }
}

export type TaskRef = { id: string; seq: number; key?: string | null; title: string }

export interface TaskDetail extends Task {
  subtasks?: Array<TaskRef & { statusId: string; assigneeId: string | null; dueDate: string | null }>
  parent?: TaskRef | null
  checklist: ChecklistItem[]
  comments: TaskComment[]
  tags: Array<{ taskId: string; tagId: string; tag: Tag }>
  documents: TaskDocumentLink[]
}

export interface ProjectMemberWithUser {
  userId: string
  projectId: string
  role: ProjectMemberRole
  user: { id: string; name: string; avatar: string | null; role: string }
}

export interface ProjectFolder {
  id: string
  projectId: string
  name: string
  position: number
  archivedAt: string | null
}

export interface ProjectListEntity {
  id: string
  projectId: string
  folderId: string | null
  name: string
  description: string | null
  position: number
  archivedAt: string | null
}

// --- Colaboração ----------------------------------------------------------

export type TaskRelationType = 'relates_to' | 'duplicates' | 'causes'
export type CustomViewType = 'board' | 'list' | 'calendar' | 'gantt' | 'timeline'
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface Recurrence {
  freq: RecurrenceFreq
  interval: number
  mode: 'on_complete' | 'on_due'
}

export interface UserRef {
  id: string
  name: string
  avatar: string | null
}

export interface TaskWatcher {
  taskId: string
  userId: string
  user: UserRef
}

export interface TaskRelation {
  id: string
  type: TaskRelationType
  task: { id: string; seq: number; title: string; statusId: string }
}

export interface CompletionBlocker {
  code: string
  message: string
}

export interface CompletionCheck {
  canComplete: boolean
  blockers: CompletionBlocker[]
}

export interface BulkResult {
  succeeded: string[]
  failed: Array<{ taskId: string; reason: string }>
}

export interface SavedFilter {
  id: string
  name: string
  projectId: string | null
  filters: Record<string, unknown>
}

export interface CustomView {
  id: string
  projectId: string
  name: string
  type: CustomViewType
  filters: Record<string, unknown> | null
  groupBy: string | null
  sortBy: string | null
  position: number
}

export interface ActivityEntry {
  id: string
  type: string
  fromValue: string | null
  toValue: string | null
  createdAt: string
  actor: UserRef
  task: { id: string; seq: number; key?: string | null; title: string; projectId?: string }
}

export interface MyArea {
  counts: {
    today: number
    overdue: number
    thisWeek: number
    upcoming: number
    noDueDate: number
    approvals: number
  }
  priorities: Array<Task & { project: { id: string; name: string }; status: ProjectStatus }>
  agenda: Array<{ date: string; count: number }>
  recentProjects: Array<{
    id: string
    name: string
    description: string | null
    targetDate: string | null
    totalTasks: number
    doneTasks: number
    overdueTasks: number
    progress: number
  }>
  recentActivity: ActivityEntry[]
}

export interface ProjectDashboard {
  project: {
    id: string
    name: string
    description: string | null
    startDate: string | null
    targetDate: string | null
    owner: UserRef
    _count: { members: number }
  }
  totals: {
    total: number
    done: number
    open: number
    overdue: number
    dueSoon: number
    progress: number
    pendingApprovals: number
  }
  byStatus: Array<{ statusId: string; name: string; color: string; count: number }>
  byPriority: Record<string, number>
  byAssignee: Array<{ id: string; name: string; avatar?: string | null; count: number }>
  byList: Array<{ id: string; name: string; count: number }>
  milestones: Array<{
    id: string
    seq: number
    title: string
    dueDate: string | null
    status: { name: string; color: string; category: StatusCategory }
  }>
  upcoming: Array<{ id: string; seq: number; title: string; dueDate: string | null }>
  recentActivity: ActivityEntry[]
}

export interface TimelineTask {
  id: string
  seq: number
  key?: string | null
  title: string
  startDate: string | null
  dueDate: string | null
  isMilestone: boolean
  parentId: string | null
  priority: TaskPriority
  progress: number
  status: { id: string; name: string; color: string; category: StatusCategory }
  assignee: UserRef | null
}

export interface ProjectTimeline {
  tasks: TimelineTask[]
  dependencies: Array<{ id: string; taskId: string; dependsOnId: string }>
}

export interface WorkloadData {
  weekStart: string
  entries: Array<{ userId: string; name: string; days: number[] }>
}

export interface ProjectWebhook {
  id: string
  // Lista de projetos aos quais este webhook se aplica — vazio = global,
  // recebe eventos de todos os projetos (presentes e futuros).
  projectIds: string[]
  name: string
  description: string | null
  url: string
  events: string[]
  active: boolean
  createdAt: string
  secret?: string
  /** Resumo das últimas 50 entregas (indicador de saúde do card). */
  recentDeliveries?: { total: number; success: number; failed: number; pending: number }
}

export interface ProjectWebhookEvent {
  event: string
  group: string
  label: string
  description: string
}

export interface WebhookDelivery {
  id: string
  eventId: string
  event: string
  status: 'pending' | 'success' | 'failed'
  attempts: number
  responseStatus: number | null
  durationMs: number | null
  errorMessage: string | null
  createdAt: string
  deliveredAt: string | null
  nextRetryAt?: string | null
}
