import api from './api'

export const dashboardService = {
  getOverview: (params?: Record<string, string>) =>
    api.get('/dashboard/overview', { params }).then(r => r.data.data),

  getProductivity: (params?: Record<string, string>) =>
    api.get('/dashboard/productivity', { params }).then(r => r.data.data),

  getManagement: (params?: Record<string, string>) =>
    api.get('/dashboard/management', { params }).then(r => r.data.data),

  getCorporations: (params?: Record<string, string>) =>
    api.get('/dashboard/corporations', { params }).then(r => r.data.data),

  getInactivity: (params?: Record<string, string>) =>
    api.get('/dashboard/inactivity', { params }).then(r => r.data.data),

  getSlaExpiring: (params?: Record<string, string>) =>
    api.get('/dashboard/sla-expiring', { params }).then(r => r.data.data),

  // Métricas por canal de origem no período (from/to em ISO).
  getChannels: (params?: { from?: string; to?: string }) =>
    api.get('/dashboard/channels', { params }).then(r => r.data.data),

  getMyOrgs: () => api.get('/manager-links/my/orgs').then(r => r.data.data),
  getMyAnalysts: () => api.get('/manager-links/my/analysts').then(r => r.data.data),

  // Admin: manage links
  getOrgLinks: () => api.get('/manager-links/orgs').then(r => r.data.data),
  createOrgLink: (orgId: string, managerId: string) =>
    api.post('/manager-links/orgs', { orgId, managerId }).then(r => r.data.data),
  deleteOrgLink: (id: string) => api.delete(`/manager-links/orgs/${id}`),
  setOrgGlobal: (orgId: string, managerGlobal: boolean) =>
    api.patch(`/manager-links/orgs/${orgId}/global`, { managerGlobal }).then(r => r.data.data),
  setAnalystGlobal: (userId: string, managerGlobal: boolean) =>
    api.patch(`/manager-links/analysts/${userId}/global`, { managerGlobal }).then(r => r.data.data),

  // Quick assign in management page
  assignTicket: (ticketId: string, agentId: string) =>
    api.patch(`/tickets/${ticketId}`, { assigned_to_id: agentId }).then(r => r.data.data),
}
