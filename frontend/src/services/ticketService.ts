import api from './api'
import { Ticket, TicketMessage, TicketStatus, ApiResponse } from '@/types'
import { events } from '@/utils/events'

export interface CreateTicketInput {
  title?: string
  description?: string
  special_data?: Record<string, string | string[]>
  priority: string
  categoryId?: string
  subcategoryId?: string
  attachmentUrl?: string
  attachment_url?: string
  onBehalfOfUserId?: string
  proactiveOrgId?: string
  /** Segundos entre abrir o formulário e enviar. */
  openingSeconds?: number
  /** Sugestão da IA recusada antes de abrir o chamado. */
  aiInteractionId?: string
}

// Espelha o listPageQuery do backend (controllers/tickets.ts). Listas vão como CSV.
export interface TicketPageQuery {
  status?: string
  priority?: string
  type?: string
  categoryId?: string
  orgId?: string
  queueId?: string
  assignedToId?: string
  unassigned?: boolean
  overdue?: boolean
  mine?: boolean
  requested?: boolean
  isReopened?: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  ids?: string
  sort?: 'urgency' | 'sla' | 'priority' | 'date' | 'id' | 'title' | 'org' | 'category' | 'queue' | 'status' | 'assignee' | 'portal'
  dir?: 'asc' | 'desc'
}

export const ticketService = {
  async getTickets(params?: { status?: TicketStatus; userId?: string; orgId?: string; isReopened?: boolean; limit?: number; offset?: number }) {
    const res = await api.get<ApiResponse<Ticket[]>>('/tickets', { params })
    return res.data.data
  },

  /** Página filtrada/ordenada no servidor (GET /tickets?page=…). */
  async getTicketsPage(params: TicketPageQuery & { page: number; pageSize: number }) {
    const res = await api.get<{ data: Ticket[]; total: number; page: number; pageSize: number }>('/tickets', { params })
    return res.data
  },

  /** Contadores da sidebar: ativos totais, meus e por fila (`{ total, my, [queueId]: n }`). */
  async getCounts(params?: Pick<TicketPageQuery, 'orgId' | 'assignedToId' | 'unassigned' | 'requested'>) {
    const res = await api.get<ApiResponse<Record<string, number>>>('/tickets/counts', { params })
    return res.data.data
  },

  /** Contagem por status agrupada por responsável/solicitante/empresa: `{ [id]: { [status]: n } }`. */
  async getGroupedCounts(by: 'assignee' | 'requester' | 'org', orgId?: string) {
    const res = await api.get<ApiResponse<Record<string, Record<string, number>>>>('/tickets/counts/grouped', { params: { by, orgId } })
    return res.data.data
  },

  /** Linhas leves com a última mensagem — base de não-lidos e do sino. */
  async getActivity() {
    const res = await api.get<ApiResponse<Array<{ id: string; title: string; displayNumber: string; latestMessage: { id: string; userId: string; createdAt: string } | null }>>>('/tickets/activity')
    return res.data.data
  },

  /** Agente da fila escalonada entra no chamado como colaborador (co-responsável). */
  async joinTicket(id: string) {
    const res = await api.post(`/tickets/${id}/join`)
    return res.data.data
  },

  /** Cliente confirma que a solução funcionou: o chamado fecha. */
  async confirmResolution(id: string) {
    const res = await api.post(`/tickets/${id}/confirm`)
    return res.data.data as Ticket
  },

  async getTicket(id: string) {
    const res = await api.get<ApiResponse<Ticket>>(`/tickets/${id}`)
    return res.data.data
  },

  async createTicket(data: CreateTicketInput) {
    const res = await api.post<ApiResponse<Ticket>>('/tickets', data)
    return res.data.data
  },

  async updateTicket(id: string, data: Partial<Ticket> & { assigned_to_id?: string | null; note?: string; resolution_details?: string; chat_enabled?: boolean; pending_reason?: string; pending_evidence_url?: string; pending_schedule_at?: string }) {
    const res = await api.patch<ApiResponse<Ticket>>(`/tickets/${id}`, data)
    const updated = res.data.data
    events.dispatchTicketUpdate({ ticketId: updated.id, ...updated })
    return updated
  },

  async getMessages(ticketId: string) {
    const res = await api.get<ApiResponse<TicketMessage[]>>(`/tickets/${ticketId}/messages`)
    return res.data.data
  },

  async addMessage(ticketId: string, text: string, type: 'user' | 'agent' | 'internal' | 'email' = 'user', attachmentUrl?: string, dispatchChannel?: string, isRealtime?: boolean) {
    const res = await api.post<ApiResponse<TicketMessage>>(`/tickets/${ticketId}/messages`, { text, type, attachment_url: attachmentUrl, dispatchChannel, is_realtime: isRealtime })
    return res.data.data
  },

  async reopenTicket(ticketId: string, reason: string) {
    const res = await api.post<ApiResponse<Ticket>>(`/tickets/${ticketId}/reopen`, { reason })
    const updated = res.data.data
    events.dispatchTicketUpdate({ ticketId: updated.id, ...updated })
    return updated
  },

  async escalateTicket(ticketId: string, ruleId: string, targetAgentId?: string | null, note?: string | null) {
    const res = await api.post<ApiResponse<any>>(`/tickets/${ticketId}/escalate`, { ruleId, targetAgentId: targetAgentId || null, note: note || null })
    return res.data.data
  },

  /** Pai e filhos do chamado (escalonamento por chamado filho). */
  async getFamily(ticketId: string): Promise<TicketFamily> {
    const res = await api.get<ApiResponse<TicketFamily>>(`/tickets/${ticketId}/family`)
    return res.data.data
  },

  async revertEscalation(ticketId: string, agentId?: string | null) {
    const res = await api.post<ApiResponse<any>>(`/tickets/${ticketId}/escalation/revert`, { agentId: agentId || null })
    return res.data.data
  },

  async updateMessage(ticketId: string, messageId: string, text: string) {
    const res = await api.patch<ApiResponse<TicketMessage>>(`/tickets/${ticketId}/messages/${messageId}`, { text })
    return res.data.data
  },

  async deleteTicket(ticketId: string) {
    await api.delete(`/tickets/${ticketId}`)
  },

  async deleteMessage(ticketId: string, messageId: string) {
    const res = await api.delete<ApiResponse<any>>(`/tickets/${ticketId}/messages/${messageId}`)
    return res.data.data
  },
}

export type TicketFamilyItem = { id: string; displayNumber: string; title: string; status: string; queue: string | null; assignedTo: { id: string; name: string } | null }
export type TicketFamily = { parent: TicketFamilyItem | null; children: TicketFamilyItem[] }
