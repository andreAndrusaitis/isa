// Tipos compartilhados entre páginas, hooks e serviços
// Espelham os modelos Prisma do backend

export type Role = 'user' | 'agent' | 'supervisor' | 'manager' | 'admin'
export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum'
export type TicketStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed'
export type TicketPendingReason = 'pending_user' | 'pending_vendor' | 'pending_approval' | 'pending_parts' | 'pending_schedule' | 'pending_project'
export type TicketPriority = 'low' | 'medium' | 'high'
export type TicketType = 'incident' | 'request' | 'problem' | 'change'
export type MessageType = 'user' | 'agent' | 'email' | 'internal'
export type QueueId = 'geral' | 'vip' | 'especializada' | 'sistemas'

// Macro: resposta pré-definida cadastrada por Admin/Gerente e usada no chat
export interface Macro {
  id: string
  title: string
  content: string
  active: boolean
  created_by_id?: string | null
  created_at?: string
  updated_at?: string
}

// Pacote adicional (complemento) alocável a planos / SLA (feature 196)
export interface AdditionalPackage {
  id: string
  name: string
  description?: string | null
  active: boolean
  created_at?: string
  updated_at?: string
}

export interface SlaConfig {
  id: string
  tier: string
  incident_first_response_hours: number
  incident_resolution_hours: number
  request_first_response_hours?: number
  request_resolution_hours?: number
  problem_first_response_hours?: number
  problem_resolution_hours?: number
  change_first_response_hours?: number
  change_resolution_hours?: number
  default_queue: string
  escalation_queue: string
  escalation_minutes: number
  color?: string | null
  packages?: AdditionalPackage[]
  categories?: { id: string; name: string }[]
  created_at?: string
  updated_at?: string
}

export interface Organization {
  id: string
  name: string
  domains: string[]
  tier: Tier
  defaultQueue: QueueId | null
  escalationQueue: QueueId | null
  slaHours: number
  firstResponseHours?: number
  /** Plano de SLA do tier (vem cru da API): `<tipo>_first_response_hours` / `<tipo>_resolution_hours`. */
  sla_config?: Record<string, number | string | null> | null
  active: boolean
  address: string | null
  phone: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  name: string
  email: string
  role: Role
  orgId: string | null
  org_id?: string | null
  avatar: string
  queues: QueueId[]
  permissions?: string[]
  active: boolean
  createdAt: string
  manager_id?: string | null
  manager?: Pick<User, 'id' | 'name'> | null
  position?: string | null
  department?: string | null
  phone?: string | null
  authProvider?: 'local' | 'microsoft'
  auth_provider?: 'local' | 'microsoft'
}

export interface Queue {
  id: QueueId
  name: string
  color: string
  description: string
  active: boolean
}

export interface Category {
  id: string
  name: string
  icon: string
  subcategories: Subcategory[]
  color?: string
  description?: string
  active?: boolean
}

export type SpecialFormFieldType = 'text' | 'textarea' | 'date' | 'email' | 'select'

export interface SpecialFormOption {
  value: string
  label: string
}

export interface SpecialFormField {
  key: string
  label: string
  type: SpecialFormFieldType
  required: boolean
  multiple?: boolean
  options?: SpecialFormOption[]
}

export interface Subcategory {
  id: string
  name: string
  categoryId: string
  is_special?: boolean
  special_form_schema?: SpecialFormField[] | null
  special_title_template?: string | null
}

export interface TicketMessage {
  id: string
  ticketId: string
  userId: string
  type: MessageType
  text: string
  attachmentUrl?: string
  isRealtime?: boolean
  createdAt: string
  user?: Pick<User, 'id' | 'name' | 'avatar'>
}

export interface TicketAttachment {
  id: string
  ticketId: string
  name: string
  size: string
  type: 'image' | 'file'
  url: string
  createdAt: string
}

export interface TicketEvent {
  id: string
  ticketId: string
  userId: string
  user?: { id: string; name: string }
  fromStatus: TicketStatus | null
  toStatus: TicketStatus
  note: string | null
  pendingReason?: TicketPendingReason | null
  pendingScheduleAt?: string | null
  /** Nova previsão combinada com o cliente (ele vê esta no lugar do prazo). */
  clientForecastAt?: string | null
  attachmentUrl?: string | null
  createdAt: string
}

export interface TicketParticipant {
  id: string
  ticketId: string
  agentId: string
  agent?: Pick<User, 'id' | 'name' | 'avatar'>
  role: 'owner' | 'collaborator'
  active: boolean
  addedAt: string
  removedAt?: string | null
}

export interface Ticket {
  id: string
  /** Previsão do projeto vencida e já avisada (job); zera quando a previsão muda. */
  project_forecast_alerted_at?: string | null
  /** Ponte chamado ↔ task (snake: vem espalhado do backend). Solicitante recebe só due_date. */
  project_task?: {
    id?: string; seq?: number; key?: string | null; title?: string; due_date: string | null; project_id?: string
    project?: { name: string }; status?: { name: string; category: string }
  } | null
  title: string
  description: string | null
  special_data?: Record<string, string | string[]> | null
  /** Canal de abertura (portal, e-mail, API...). */
  channel?: string | null
  status: TicketStatus
  priority: TicketPriority
  type: TicketType
  displayNumber: string
  queue: QueueId
  categoryId: string
  subcategoryId: string | null
  userId: string
  orgId: string | null
  assignedToId: string | null
  collabQueue?: string | null
  slaDeadline: string
  escalated: boolean
  chatEnabled?: boolean
  is_reopened?: boolean
  /** Resolvido pela IA, sem passar pela fila. A volta à fila desliga. */
  aiResolved?: boolean
  intake_status?: string | null
  canReopen?: boolean
  reopenSlaEnabled?: boolean | null
  reopenSlaLimitHours?: number | null
  resolution_details: string | null
  resolved_at: string | null
  pendingReason?: TicketPendingReason | null
  pendingScheduleAt?: string | null
  /** Nova previsão combinada com o cliente (ele vê esta no lugar do prazo). */
  clientForecastAt?: string | null
  attachmentUrl?: string
  createdAt: string
  updatedAt: string
  // Relações opcionais (populate)
  category?: Category
  user?: Pick<User, 'id' | 'name' | 'email' | 'avatar'>
  org?: Pick<Organization, 'id' | 'name' | 'tier'>
  assignedTo?: Pick<User, 'id' | 'name' | 'avatar'>
  messages?: TicketMessage[]
  attachments?: TicketAttachment[]
  events?: TicketEvent[]
  participants?: TicketParticipant[]
  latestMessage?: { id: string; userId: string; createdAt: string } | null
  surveyInstance?: {
    id: string
    ticketId: string
    linkToken: string
    status: 'enviada' | 'respondida' | 'expirada'
    criadaEm: string
    respondidaEm?: string | null
  } | null
}

export interface RoutingRule {
  id: string
  name: string
  enabled: boolean
  priority: number
  conditions: RoutingCondition[]
  actions: RoutingAction[]
}

export interface RoutingCondition {
  field: 'email_domain' | 'email' | 'org_tier' | 'organization' | 'category' | 'subject_contains' | 'priority'
  operator: 'equals' | 'contains' | 'not_equals' | 'in'
  value: string
}

export interface RoutingAction {
  type: 'set_queue' | 'set_priority' | 'assign_agent'
  value: string
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ApiResponse<T> {
  data: T
  meta?: PaginationMeta
}

export interface ApiError {
  error: string
  code: string
  details?: unknown
}

// Dashboard types
export interface DashboardOverview {
  /** `resolved` e `closed` são só da equipe; `ai_resolved` junta os resolvidos pela IA, fechados ou não. */
  counts: { open: number; in_progress: number; pending: number; resolved: number; ai_resolved: number; closed: number }
  /** `count` chegou à equipe, `aiResolved` a IA resolveu sem fila; `tickets` lista os dois. */
  timeSeries: { date: string; count: number; aiResolved: number; tickets?: { id: string }[] }[]
  priorityDist: { priority: string; _count: { _all: number } }[]
  queueDist: { queue: string; _count: { _all: number } }[]
  /** Abertura por dia da semana (0=dom) × hora, últimos `days` dias, fuso de Brasília. */
  demand?: { days: number; total: number; matrix: number[][] }
}

export interface AnalystWorkload {
  analyst: { id: string; name: string; avatar: string | null; role: string }
  active: number
  resolved: number
  reopened: number
  avgResolutionHours: number
  slaRate: number
  activeTickets: {
    id: string; display_number: string; title: string; status: string; priority: string; queue: string
    updated_at: string; sla_deadline: string
    org: { id: string; name: string } | null
  }[]
}

export type UnassignedLevel = 'attention' | 'alert' | 'critical' | 'evidence'

export interface UnassignedTicket {
  id: string; display_number: string; title: string; status: string; priority: string; queue: string
  created_at: string; sla_deadline: string; hoursOpen: number; level: UnassignedLevel
  org: { id: string; name: string; tier: string } | null
  category: { id: string; name: string } | null
}

export type InactivityLevel = 'monitor' | 'attention' | 'alert' | 'critical'

export interface InactiveTicket {
  id: string; display_number: string; title: string; status: string; priority: string; queue: string
  slaDeadline: string; lastActivity: string; lastBy: 'client' | 'agent' | 'system'
  inactiveDays: number; level: InactivityLevel
  org: { id: string; name: string } | null
  assignedTo: { id: string; name: string } | null
}

export type SlaExpiringLevel = 'critical' | 'alert' | 'attention'

export interface SlaExpiringTicket {
  id: string; display_number: string; title: string; status: string; priority: string; queue: string
  slaDeadline: string; createdAt: string; minutesRemaining: number; level: SlaExpiringLevel
  org: { id: string; name: string; tier: string } | null
  assignedTo: { id: string; name: string } | null
}

/** Chamado em projeto cuja task passou do prazo sem concluir: risco de SLA. */
export interface ForecastOverdueTicket {
  id: string; display_number: string; title: string; status: string; priority: string; queue: string
  org: { id: string; name: string; tier: string } | null
  assignedTo: { id: string; name: string } | null
  task: { id: string; key: string; title: string; dueDate: string; project: { id: string; name: string } }
  overdueDays: number
}

export interface OrgManagerLink {
  id: string
  orgId: string
  managerId: string
  org: { id: string; name: string; tier: string; managerGlobal: boolean }
  manager: { id: string; name: string }
  createdAt: string
}

// ── Webhooks de saída + API externa de integração — espelham os modelos Prisma ──

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed'
export type ApiKeyScope =
  | 'create_ticket' | 'update_ticket' | 'close_ticket' | 'create_user' | 'update_user'
  | 'read_categories' | 'read_subcategories' | 'read_queues' | 'read_organizations' | 'read_tickets'
  | 'read_messages' | 'create_message'
export type ApiRequestStatus = 'received' | 'processing' | 'success' | 'duplicate' | 'failed'

export interface WebhookEventInfo {
  event: string
  group: string
  label: string
  description: string
}

export interface WebhookEndpoint {
  id: string
  name: string
  url: string
  events: string[]
  filters?: Record<string, any>
  active: boolean
  created_at: string
  updated_at: string
  /** Presente apenas na resposta de criação/regeneração — exibir uma única vez */
  secret?: string
  recent_deliveries?: { total: number; success: number; failed: number; pending: number }
}

export interface WebhookDelivery {
  id: string
  endpoint_id: string
  event: string
  payload: unknown
  status: WebhookDeliveryStatus
  attempts: number
  next_retry_at: string | null
  response_status: number | null
  response_body: string | null
  error_message: string | null
  duration_ms: number | null
  delivered_at: string | null
  created_at: string
}

export interface ApiKey {
  id: string
  name: string
  key_prefix: string
  scopes: ApiKeyScope[]
  /** Preenchido = key travada numa empresa; null = multi-empresa por domínio */
  org_id: string | null
  active: boolean
  created_by_id: string | null
  created_at: string
  updated_at: string
  last_used_at: string | null
  requests_count?: number
  /** Presente apenas na resposta de criação/regeneração — exibir uma única vez */
  key?: string
}

export interface ApiRequestLog {
  id: string
  api_key_id: string
  external_request_id: string | null
  method: string
  path: string
  status: ApiRequestStatus
  request_payload: unknown
  response_status: number | null
  error_code: string | null
  error_message: string | null
  resource_type: 'ticket' | 'user' | null
  resource_id: string | null
  ip: string | null
  created_at: string
}

export interface Paginated<T> {
  data: T[]
  meta: { total: number; page: number; pages: number }
}

// ── Carteira (escopo de empresas) ──────────────────────────────────────────
export interface EffectiveScope {
  scopeAll: boolean
  orgIds: string[]
  queueIds: string[]
  enforceQueues: boolean
}

/** Carteira de um usuário: modo próprio + escopo efetivo já calculado pelo backend. */
export interface UserScope {
  mode: 'all' | 'selected' | 'inherit'
  own: string[]
  effective: EffectiveScope
}

export interface OrgServedBy {
  managers: { id: string; name: string; email: string; avatar?: string | null; mode: 'all' | 'selected' }[]
  team: { id: string; name: string; email: string; avatar?: string | null; role: string; mode: 'inherit' | 'restricted'; queues: string[] }[]
}
