import api from './api'
import type {
  WebhookEndpoint, WebhookDelivery, WebhookEventInfo, Paginated,
} from '@/types'

// Serviço da área Admin → Webhooks de saída.
// Secret só vem na resposta de criação/regeneração — exibir uma única vez.
// Para a API externa de integração (entrada), ver services/apiKeyService.ts.
export const webhookService = {
  // Catálogo de eventos (para montar a seleção na UI)
  getEvents: () => api.get('/webhooks/events').then(r => r.data.data as WebhookEventInfo[]),
  getEventExample: (event: string) => api.get(`/webhooks/events/${event}/example`).then(r => r.data.data),
  getEventSchema: (event: string) => api.get(`/webhooks/events/${event}/schema`).then(r => r.data.data),

  // Saída — endpoints
  getEndpoints: () => api.get('/webhooks/endpoints').then(r => r.data.data as WebhookEndpoint[]),
  createEndpoint: (data: Partial<WebhookEndpoint>) =>
    api.post('/webhooks/endpoints', data).then(r => r.data.data as WebhookEndpoint),
  updateEndpoint: (id: string, data: Partial<WebhookEndpoint>) =>
    api.patch(`/webhooks/endpoints/${id}`, data).then(r => r.data.data as WebhookEndpoint),
  deleteEndpoint: (id: string) => api.delete(`/webhooks/endpoints/${id}`).then(r => r.data),
  regenerateSecret: (id: string) =>
    api.post(`/webhooks/endpoints/${id}/regenerate-secret`).then(r => r.data.data as WebhookEndpoint),
  testEndpoint: (id: string) =>
    api.post(`/webhooks/endpoints/${id}/test`).then(r => r.data.data as Pick<WebhookDelivery, 'status' | 'response_status' | 'duration_ms' | 'error_message'>),
  getDeliveries: (id: string, page = 1, status?: string) =>
    api.get(`/webhooks/endpoints/${id}/deliveries`, { params: { page, status } })
      .then(r => r.data as Paginated<WebhookDelivery>),
  retryDelivery: (deliveryId: string) =>
    api.post(`/webhooks/deliveries/${deliveryId}/retry`).then(r => r.data.data as WebhookDelivery),
}
