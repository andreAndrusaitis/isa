import api from './api'
import type { CreateTicketInput } from './ticketService'
import type { ApiResponse, Ticket } from '@/types'

export interface SuggestStatus {
  enabled: boolean
  shadow: boolean
}

export interface SuggestInput {
  title: string
  description: string
  categoryId?: string
}

export interface SuggestionSource {
  articleId: string
  title: string
}

export interface AiSuggestion {
  answer: string
  confidence: number
  sources: SuggestionSource[]
  interactionId: string
}

export type AiFeedbackValue = 'useful' | 'not_useful'

/** Corpo de POST /tickets, mais os anexos além do primeiro (que vai em attachment_url). */
export interface AcceptInput extends CreateTicketInput {
  extra_attachments?: { name: string; url: string }[]
}

/** Sugestão da base de conhecimento no Wizard de abertura. */
export const aiSuggestService = {
  status: (): Promise<SuggestStatus> => api.get('/ai/suggest/status')
    .then(r => ({ enabled: r.data.enabled === true, shadow: r.data.shadow === true })),

  suggest: (input: SuggestInput, signal?: AbortSignal): Promise<AiSuggestion | null> => api.post('/ai/suggest', input, { signal })
    .then(r => r.data.suggestion ?? null),

  /** Mesma resposta de POST /tickets, mas o chamado nasce resolvido. */
  accept: (interactionId: string, body: AcceptInput): Promise<Ticket> => api.post<ApiResponse<Ticket>>(`/ai/suggest/${interactionId}/accept`, body)
    .then(r => r.data.data),

  feedback: (interactionId: string, value: AiFeedbackValue): Promise<void> => api.post('/ai/feedback', { interactionId, value })
    .then(() => undefined),
}
