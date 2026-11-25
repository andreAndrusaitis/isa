import api from './api'

// Serviço da área Admin → Motor IA: execuções dos agentes e o modo de cada um.

export interface AiAgentStatus {
  key: string
  name: string
  description: string
  mode: string // 'off' | 'shadow' | 'apply'
  active: boolean
  runs_24h: number
  runs_7d: number
  errors_24h: number
  last_run_at: string | null
  /** Configurações declaradas pelo agente (a tela monta o formulário) e os valores vigentes. */
  settings?: AiAgentSetting[]
  config?: Record<string, unknown>
}

export interface AiAgentSetting {
  key: string
  label: string
  help?: string
  kind: 'rigor' | 'bool' | 'int' | 'multi'
  options?: { value: string; label: string }[]
  min?: number
  max?: number
}

/** Cartão da base de resoluções (Motor IA › Orientação). */
export interface ResolutionCard {
  id: string
  problem: string
  active: boolean
  source: string
  created_at: string
  selfService: boolean
  steps: string[]
  teamAction: string
  product: string | null
  sourceDisplay: string | null
}
export interface ResolutionCardsPage { data: ResolutionCard[]; next_cursor: string | null; total: number; inactive: number }

export type GuidanceStatus = 'offered' | 'deflected' | 'declined' | 'duplicate_offered' | 'linked' | 'skipped' | 'none'
export type GuidanceAnswer = 'resolved' | 'declined' | 'link' | 'not-duplicate'

/** Última execução do agente guidance (só para a equipe). */
export interface GuidanceRunResult {
  skipReason?: string
  duplicate?: { ticket: { id: string; display_number: string; title: string }; confidence: number; isDuplicate: boolean } | null
  guidance?: {
    /** Portão: problem | request | other; só "problem" confiante recebe orientação. */
    kind?: { chosen: string; confidence: number; problem: boolean }
    microsoft: boolean
    learnQuery: string | null
    cards: { id: string; ref: string; problem: string; score: number; selfService: boolean; sourceDisplay: string }[]
    steps: { text: string; how?: string[]; source: string }[]
    links: { title: string; url: string }[]
    usedCards: string[]
    teamHints: { cardId: string; text: string; sourceDisplay: string; score: number }[]
  } | null
}

export interface GuidanceInfo {
  guidance_status: GuidanceStatus | null
  /** Solicitante: o chamado aberto sugerido como duplicado (é dele mesmo). */
  related?: { id: string; display_number: string; title: string } | null
  /** Equipe: última execução. */
  run?: { id: string; mode: string; created_at: string; result: GuidanceRunResult | null } | null
}

export interface AiStatus { configured: boolean; model: string; agents: AiAgentStatus[] }

/** Formato de decisão por campo (TriageResult e futuros agentes de múltipla escolha). */
export interface AiFieldDecision { key: string; label?: string; chosenLabel?: string; confidence?: number; margin?: number; wouldApply?: boolean; evidence?: string | null }

export type AiChangeKind = 'applied' | 'proposed'

/** Uma alteração de campo: o chamado era `from_label` e virou (applied) ou viraria (proposed) `to_label`. */
export interface AiRunChange {
  kind: AiChangeKind
  field: string // 'type' | 'category' | 'subcategory' | 'priority'
  label: string
  from: string | null
  from_label: string
  to: string
  to_label: string
  confidence: number | null
  /** Mudança feita por regra de automação, reavaliada com a classificação da IA. */
  rule?: string | null
  /** Por que a sugestão da IA não foi aplicada (ex.: uma regra define outro valor). */
  reason?: string | null
}

/** Linha do catálogo GET /ai/changes. */
export interface AiChange extends AiRunChange {
  run_id: string
  created_at: string
  agent: string
  mode: string
  ticket: { id: string; display_number: string; title: string } | null
}

export interface AiChangesPage { data: AiChange[]; next_cursor: string | null }

export interface AiRun {
  id: string
  agent: string
  ticket_id: string | null
  ticket: { id: string; display_number: string; title: string } | null
  mode: string
  model: string
  prompt_version: string
  status: 'ok' | 'error'
  error: string | null
  latency_ms: number
  input_tokens: number
  output_tokens: number
  created_at: string
  /** Alterações já achatadas de result.applied/proposed (execução antiga = []). */
  changes?: AiRunChange[]
  apply_error?: string | null
  result: {
    questions?: AiFieldDecision[]
    priority?: { value: string; confidence: number; wouldApply: boolean }
    justification?: string
    [k: string]: unknown
  } | null
}

export interface AiRunsPage { data: AiRun[]; next_cursor: string | null }

export interface AiMetrics {
  agent: string | null
  days: number
  runs: number
  errors: number
  error_rate: number
  latency_p50_ms: number | null
  latency_p95_ms: number | null
  input_tokens: number
  output_tokens: number
  cost_usd: number
  fields: { key: string; total: number; would_apply: number; would_apply_rate: number; avg_confidence: number | null }[]
  changes?: {
    by_field: { field: string; label: string; applied: number; proposed: number }[]
    top_transitions: { field: string; label: string; from_label: string; to_label: string; applied: number; proposed: number; total: number }[]
  }
}

export interface IntakeChecklistItem {
  id: string
  type: 'incident' | 'request' | 'problem' | 'change'
  subcategory_id: string | null
  subcategory?: { id: string; name: string } | null
  key: string
  label: string
  criterion: string
  question: string
  kind: 'text' | 'evidence'
  required: boolean
  sort: number
  active: boolean
}
export type IntakeChecklistInput = Omit<IntakeChecklistItem, 'id' | 'subcategory'>

export type AiAgentMode = 'off' | 'shadow' | 'apply'

/** Triagem IA de um chamado (agente triage): campos decididos, justificativa, mudanças e correções humanas. */
export interface TriageField {
  key: 'type' | 'category' | 'subcategory' | 'urgency' | 'impact'
  label: string
  chosen: string | null
  chosen_label: string | null
  confidence: number
  would_apply: boolean
  evidence: string | null
  evidence_source: 'texto' | 'anexo' | null
  evidence_valid: boolean
}
export interface TriageChange {
  kind: 'applied' | 'proposed'
  field: 'type' | 'category' | 'subcategory' | 'priority' | 'queue'
  label: string
  from: string | null
  from_label: string | null
  to: string | null
  to_label: string | null
  confidence: number
  rule: string | null
  reason: string | null
}
export interface TriageFeedback {
  field: string
  ai_value: string | null
  /** A pessoa só confirmou o que a IA sugeriu (não é correção). */
  accepted: boolean
  ai_label: string | null
  from_value: string | null
  to_value: string | null
  from_label: string | null
  to_label: string | null
  user: { id: string; name: string }
  created_at: string
}
export interface TicketTriage {
  id: string
  created_at: string
  mode: 'shadow' | 'apply'
  model: string
  prompt_version: string
  status: 'ok' | 'error'
  error: string | null
  justification: string | null
  low_information: boolean
  apply_error: string | null
  /** Portão lido pela triagem (relato de pessoa, comunicado automático, teste ou resposta). */
  gate?: { value: 'user' | 'automatic' | 'test' | 'reply'; confidence: number; would_apply: boolean } | null
  fields: TriageField[]
  priority: { value: 'low' | 'medium' | 'high'; confidence: number; would_apply: boolean } | null
  changes: TriageChange[]
  feedback: TriageFeedback[]
}

/** Painel de métricas da triagem (gestor): GET /ai/insights. Datas = dias do calendário de São Paulo. */
export type InsightField = 'type' | 'category' | 'subcategory' | 'priority'
export interface InsightTime { count: number; median_minutes: number | null; p90_minutes: number | null }
/** Taxas null: não há base para calcular (nenhum chamado ou nenhuma avaliação no período). */
export interface KnowledgeMetrics {
  period: { from: string; to: string }
  resolution: { ai_resolved: number; team_opened: number; rate: number | null; target: number }
  feedback: { useful: number; not_useful: number; rate: number | null }
  interactions: { total: number; answered: number; bucket: 'day' | 'month'; series: { date: string; count: number }[] }
  top_articles: { article_id: string; title: string; uses: number }[]
  empty: boolean
}

export interface AiInsights {
  period: { from: string; to: string }
  tickets: number
  triaged: number
  automatic: number
  manual: number
  automatic_rate: number
  reclassified: number
  reclassification_rate: number
  accuracy: { field: InsightField; total: number; correct: number; rate: number }[]
  time_to_assign: { triaged: InsightTime; not_triaged: InsightTime }
  intake: { incomplete: number; complemented: number }
  guidance: { deflected: number; linked: number }
  empty: boolean
}

/** Correção humana de um campo que a IA tinha decidido (Motor IA › Correções). */
export interface AiFeedbackItem {
  id: string
  created_at: string
  field: string
  ai_value: string | null
  accepted: boolean
  ai_label: string | null
  from_value: string | null
  to_value: string | null
  from_label: string | null
  to_label: string | null
  user: { id: string; name: string }
  ticket: { id: string; display_number: string; title: string } | null
  run_id: string | null
}
export interface AiFeedbackPage { data: AiFeedbackItem[]; next_cursor: string | null }

export const aiService = {
  getIntakeChecklist: () => api.get('/ai/intake/checklist').then(r => r.data.data as IntakeChecklistItem[]),
  createIntakeItem: (data: IntakeChecklistInput) => api.post('/ai/intake/checklist', data).then(r => r.data.data as IntakeChecklistItem),
  updateIntakeItem: (id: string, data: Partial<IntakeChecklistInput>) => api.put(`/ai/intake/checklist/${id}`, data).then(r => r.data.data as IntakeChecklistItem),
  dismissIntake: (ticketId: string) => api.post(`/ai/intake/tickets/${ticketId}/dismiss`).then(() => undefined),
  /** Agente guidance: o solicitante recebe só a marca e o chamado relacionado; a equipe, a última execução. */
  getGuidance: (ticketId: string) => api.get(`/ai/guidance/tickets/${ticketId}`).then(r => r.data.data as GuidanceInfo),
  answerGuidance: (ticketId: string, answer: GuidanceAnswer) => api.post(`/ai/guidance/tickets/${ticketId}/${answer}`).then(() => undefined),
  /** 👎 da equipe: o cartão da base de resoluções sai da busca. */
  disableExample: (exampleId: string) => api.patch(`/ai/guidance/examples/${exampleId}/disable`).then(() => undefined),
  getTicketTriage: (ticketId: string) => api.get(`/ai/tickets/${ticketId}/triage`).then(r => r.data.data as TicketTriage | null),
  getStatus: () => api.get('/ai/status').then(r => r.data.data as AiStatus),
  /** Configurações do agente (parcial); vale na hora no backend. */
  setAgentConfig: (key: string, config: Record<string, unknown>) =>
    api.put(`/ai/agents/${key}/config`, { config }).then(r => r.data.data.config as Record<string, unknown>),
  listResolutionCards: (params: { q?: string; active?: boolean; cursor?: string }) =>
    api.get('/ai/guidance/examples', { params }).then(r => r.data as ResolutionCardsPage),
  setResolutionCardActive: (id: string, active: boolean) => api.patch(`/ai/guidance/examples/${id}`, { active }).then(() => undefined),
  /** Liga, desliga ou põe em sombra um agente; vale na hora no backend. */
  setAgentMode: (key: string, mode: AiAgentMode) => api.put(`/ai/agents/${key}/mode`, { mode }).then(() => undefined),
  getRuns: (params: { agent?: string; status?: string; limit?: number; cursor?: string }) =>
    api.get('/ai/runs', { params }).then(r => r.data as AiRunsPage),
  /** Últimas execuções sem filtro (Motor IA). */
  getRecentRuns: (limit = 100) => api.get('/ai/runs', { params: { limit } }).then(r => r.data as AiRunsPage),
  getChanges: (params: { agent?: string; field?: string; kind?: AiChangeKind; days?: number; limit?: number; cursor?: string }) =>
    api.get('/ai/changes', { params }).then(r => r.data as AiChangesPage),
  getMetrics: (params: { agent?: string; days?: number }) =>
    api.get('/ai/metrics', { params }).then(r => r.data.data as AiMetrics),
  getInsights: (params: { from?: string; to?: string; org_id?: string; category_id?: string }) =>
    api.get('/ai/insights', { params }).then(r => r.data.data as AiInsights),
  getKnowledgeMetrics: (params: { from?: string; to?: string; org_id?: string }) =>
    api.get('/ai/insights/knowledge', { params }).then(r => r.data.data as KnowledgeMetrics),
  getFeedback: (params: { field?: string; days?: number; limit?: number; cursor?: string }) =>
    api.get('/ai/feedback', { params }).then(r => r.data as AiFeedbackPage),
}
