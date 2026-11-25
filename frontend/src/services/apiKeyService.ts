import api from './api'
import type { ApiKey, ApiKeyScope, ApiRequestLog, Paginated } from '@/types'

// Serviço da área Admin → Integrações → API externa (/api/integrations/keys).
// A key em texto pleno só vem na resposta de criação/regeneração — exibir uma única vez.
export const apiKeyService = {
  getScopes: () => api.get('/integrations/keys/scopes').then(r => r.data.data as ApiKeyScope[]),
  getKeys: () => api.get('/integrations/keys').then(r => r.data.data as ApiKey[]),
  createKey: (data: { name: string; scopes: ApiKeyScope[]; org_id?: string | null; active?: boolean }) =>
    api.post('/integrations/keys', data).then(r => r.data.data as ApiKey),
  updateKey: (id: string, data: Partial<Pick<ApiKey, 'name' | 'scopes' | 'org_id' | 'active'>>) =>
    api.patch(`/integrations/keys/${id}`, data).then(r => r.data.data as ApiKey),
  deleteKey: (id: string) => api.delete(`/integrations/keys/${id}`).then(r => r.data),
  regenerateKey: (id: string) =>
    api.post(`/integrations/keys/${id}/regenerate`).then(r => r.data.data as ApiKey),
  getKeyRequests: (id: string, page = 1) =>
    api.get(`/integrations/keys/${id}/requests`, { params: { page } })
      .then(r => r.data as Paginated<ApiRequestLog>),
}
