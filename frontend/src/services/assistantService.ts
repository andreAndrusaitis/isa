import api from './api'

// Assistente de chamados do portal: mesma conversa do bot do Teams,
// pelo POST /api/assistant/chat (só o solicitante).

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Escrita proposta pelo assistente, aguardando a pessoa confirmar. */
export interface PendingAction {
  tool: string
  input: unknown
  summary: string
}

export interface AssistantSource {
  title: string
  url: string
}

export interface AssistantReply {
  text: string
  pending?: PendingAction
  sources?: AssistantSource[]
  /** Chamado criado/alterado pela ação confirmada. */
  ticket?: { id: string; numero: string }
}

export interface AssistantChatInput {
  message: string
  history: AssistantMessage[]
  confirm?: PendingAction
  conversationId?: string
}

export const assistantService = {
  async chat(input: AssistantChatInput): Promise<AssistantReply> {
    const res = await api.post<{ data: AssistantReply }>('/assistant/chat', input)
    return res.data.data
  },
}
