import api from './api'

export type SurveyQuestionType = 'escala' | 'escolha_unica' | 'escolha_multipla' | 'texto_livre' | 'nps' | 'escala_1_5' | 'unica_escolha'
export type SurveyQuestionStyle = 'emoji' | 'estrela' | 'numerico' | 'pill'

export interface SurveyQuestionOption {
  id?: string
  ordem?: number
  rotulo: string
  valor: string
  emoji?: string | null
  cor?: string | null
  pontuacao?: number | null
  acao?: 'reabrir_chamado' | null
}

export interface SurveyQuestion {
  id: string
  template_id: string
  ordem: number
  enunciado: string
  descricao?: string | null
  tipo: SurveyQuestionType
  estilo?: SurveyQuestionStyle | null
  obrigatoria: boolean
  ativa: boolean
  opcoes: SurveyQuestionOption[]
}

export interface SurveyTemplate {
  id: string
  nome: string
  assunto_email: string
  corpo_convite_auto: string
  corpo_convite_macro: string
  ativo: boolean
  atualizado_por_id?: string
  created_at: string
  updated_at: string
  questions?: SurveyQuestion[]
}

export interface SurveyAnswerSubmit {
  question_id: string
  valor_texto?: string
  valor_numero?: number
  valores_opcao?: string[]
}

export interface SurveyResponseSubmit {
  answers: SurveyAnswerSubmit[]
  reopen_reason?: string
  reopen_attachment?: string
}

export interface SurveyQuestionStat {
  questionId: string
  enunciado: string
  tipo: string
  estilo: string | null
  ativa: boolean
  distribution: Array<{
    rotulo: string
    valor: string
    count: number
    pct: number
    emoji: string | null
    cor: string | null
  }> | null
  average: number | null
  npsScore: number | null
  comments: Array<{ ticketId: string; text: string; date: string }> | null
  answeredCount: number
  scaleMin: number | null
  scaleMax: number | null
  npsBuckets: { detratores: number; neutros: number; promotores: number } | null
  monthlyScores: Array<{ month: string; score: number | null; responses: number }>
}

export interface SurveyDashboardStats {
  monthlyTrend: Array<{
    month: string // 'YYYY-MM'
    sent: number
    responses: number
    responseRate: number
    satisfactionScore: number | null // 0..100, null quando não houve nota no mês
  }>
  sent: number
  responses: number
  responseRate: number
  questions: SurveyQuestionStat[]
  responsesList: Array<{
    ticketId: string
    ticketTitle: string
    clientName: string
    companyName: string
    date: string
    answers: Array<{ questionId: string; enunciado: string; display: string }>
  }>
  unansweredList: Array<{
    ticketId: string
    ticketTitle: string
    clientName: string
    clientEmail: string
    companyName: string
    status: 'enviada' | 'respondida' | 'expirada'
    sentAt: string
    dispatchesCount: number
  }>
}

export const surveyService = {
  // --- Templates Management (Admin only) ---
  resendSurveyEmail: (ticketId: string): Promise<{ message: string }> =>
    api.post(`/survey/tickets/${ticketId}/resend-email`).then(r => r.data),

  getTemplates: (): Promise<SurveyTemplate[]> =>
    api.get('/survey/templates').then(r => r.data.data),

  getTemplate: (id: string): Promise<SurveyTemplate> =>
    api.get(`/survey/templates/${id}`).then(r => r.data.data),

  getActiveTemplate: (): Promise<SurveyTemplate> =>
    api.get('/survey/templates/active').then(r => r.data.data),

  createTemplate: (data: Partial<SurveyTemplate>): Promise<SurveyTemplate> =>
    api.post('/survey/templates', data).then(r => r.data.data),

  updateTemplate: (id: string, data: Partial<SurveyTemplate>): Promise<SurveyTemplate> =>
    api.put(`/survey/templates/${id}`, data).then(r => r.data.data),

  deleteTemplate: (id: string): Promise<void> =>
    api.delete(`/survey/templates/${id}`),

  setActiveTemplate: (id: string): Promise<SurveyTemplate> =>
    api.post(`/survey/templates/${id}/active`).then(r => r.data.data),

  // --- Question Management (Admin only) ---
  addQuestion: (templateId: string, data: Partial<SurveyQuestion>): Promise<SurveyQuestion> =>
    api.post(`/survey/templates/${templateId}/questions`, data).then(r => r.data.data),

  updateQuestion: (questionId: string, data: Partial<SurveyQuestion>): Promise<SurveyQuestion> =>
    api.put(`/survey/questions/${questionId}`, data).then(r => r.data.data),

  // arquivada=true => a pergunta já tinha respostas e foi desativada em vez de
  // apagada, preservando o histórico agregado no dashboard.
  deleteQuestion: (questionId: string): Promise<{ arquivada: boolean; respostas: number }> =>
    api.delete(`/survey/questions/${questionId}`).then(r => r.data),

  reorderQuestions: (templateId: string, orderedIds: string[]): Promise<SurveyTemplate> =>
    api.post(`/survey/templates/${templateId}/questions/reorder`, { orderedIds }).then(r => r.data.data),

  // --- Public survey answering (No auth required) ---
  getPublicSurvey: (token: string): Promise<{
    id: string
    ticket_id: string
    status: 'enviada' | 'respondida' | 'expirada'
    ticket: { id: string; title: string; user_id: string }
    template: SurveyTemplate
  }> =>
    api.get(`/survey/public/${token}`).then(r => r.data.data),

  submitPublicSurvey: (token: string, data: SurveyResponseSubmit): Promise<any> =>
    api.post(`/survey/public/${token}`, data).then(r => r.data.data),

  // --- Dashboard stats (Admins and Supervisors) ---
  getDashboardStats: (params?: { startDate?: string; endDate?: string; orgId?: string }): Promise<SurveyDashboardStats> =>
    api.get('/survey/dashboard', { params }).then(r => r.data.data),

  // --- Ticket Link generation (Agents / Admins) ---
  getSurveyLinkForTicket: (ticketId: string): Promise<{ token: string }> =>
    api.get(`/tickets/${ticketId}/survey-link`).then(r => r.data.data),

  // --- Get pending surveys for client/user ---
  getPendingSurveys: (): Promise<Array<{
    id: string
    ticket_id: string
    link_token: string
    status: 'enviada' | 'respondida' | 'expirada'
    created_at: string
    ticket: { id: string; title: string }
  }>> =>
    api.get('/survey/pending').then(r => r.data.data),
}
