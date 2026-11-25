import api from './api'
import type { Macro } from '@/types'

// Serviço de Macros (respostas pré-definidas).
// Usado tanto pelo painel de gestão (Admin/Gerente) quanto pelo chat do chamado.
export const macroService = {
  getMacros: () => api.get('/macros').then(r => r.data.data as Macro[]),
  createMacro: (data: Partial<Macro>) => api.post('/macros', data).then(r => r.data.data as Macro),
  updateMacro: (id: string, data: Partial<Macro>) =>
    api.patch(`/macros/${id}`, data).then(r => r.data.data as Macro),
  deleteMacro: (id: string) => api.delete(`/macros/${id}`).then(r => r.data),
  // Lista oficial de variáveis ({chave}) — vem do backend, fonte única.
  getVariables: () => api.get('/macros/variables').then(r => r.data.data as MacroVariable[]),
  // Substitui as variáveis no servidor. Sem ticketId = chamado de exemplo (pré-visualização).
  render: (content: string, ticketId?: string) =>
    api.post('/macros/render', { content, ticketId }).then(r => r.data.data as MacroRender),
}

export interface MacroVariable { key: string; label: string; example: string }
export interface MacroRender { content: string; unknown: string[]; surveyLink?: boolean }
