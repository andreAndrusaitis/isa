import api, { AUTH_BASE_URL } from './api'
import { useAuthStore } from '@/store/auth'
import type { UserScope, OrgServedBy } from '@/types'

export const adminService = {
  // Users
  getUsers: (params?: Record<string, any>) => api.get('/users', { params }).then(r => r.data.data),
  createUser: (data: any) => api.post('/users', data).then(r => r.data.data),
  updateUser: (id: string, data: any) => api.patch(`/users/${id}`, data).then(r => r.data.data),
  updateProfile: (data: any) => api.patch('/users/me', data).then(r => r.data.data),
  // O backend derruba todas as sessões ao trocar a senha (inclusive esta):
  // entra de novo com a senha nova para o usuário seguir logado.
  changeMyPassword: async (data: { currentPassword: string; newPassword: string }) => {
    const result = await api.patch('/users/me/password', data).then(r => r.data.data)
    const email = useAuthStore.getState().user?.email
    if (email) {
      const { data: login } = await api.post('/auth/login', { email, password: data.newPassword }, { baseURL: AUTH_BASE_URL })
      useAuthStore.getState().setAuth(login.data.user, login.data.accessToken)
    }
    return result
  },
  getMeStats: () => api.get('/users/me/stats').then(r => r.data.data),
  deleteUser: (id: string) => api.delete(`/users/${id}`),
  getUserScope: (id: string) => api.get(`/users/${id}/scope`).then(r => r.data.data as UserScope),

  // Organizations
  getOrganizations: () => api.get('/organizations').then(r => r.data.data),
  getOrganization: (id?: string | null) => {
    if (!id) return Promise.resolve(null)
    return api.get(`/organizations/${id}`).then(r => r.data.data)
  },
  createOrganization: (data: any) => api.post('/organizations', data).then(r => r.data.data),
  updateOrganization: (id: string, data: any) => api.patch(`/organizations/${id}`, data).then(r => r.data.data),
  deleteOrganization: (id: string) => api.delete(`/organizations/${id}`),

  // Authorized Domains (SSO — auto-provisionamento por domínio)
  getAuthorizedDomains: (orgId: string) => api.get(`/organizations/${orgId}/authorized-domains`).then(r => r.data.data),
  createAuthorizedDomain: (orgId: string, domain: string) =>
    api.post(`/organizations/${orgId}/authorized-domains`, { domain }).then(r => r.data.data),
  updateAuthorizedDomain: (orgId: string, domainId: string, data: { active: boolean }) =>
    api.patch(`/organizations/${orgId}/authorized-domains/${domainId}`, data).then(r => r.data.data),
  deleteAuthorizedDomain: (orgId: string, domainId: string) =>
    api.delete(`/organizations/${orgId}/authorized-domains/${domainId}`),

  // Categories
  getCategories: () => api.get('/categories').then(r => r.data.data),
  getAvailableCategories: () => api.get('/categories/available').then(r => r.data.data),
  createCategory: (data: any) => api.post('/categories', data).then(r => r.data.data),
  updateCategory: (id: string, data: any) => api.patch(`/categories/${id}`, data).then(r => r.data.data),
  deleteCategory: (id: string) => api.delete(`/categories/${id}`),
  // Empresas com acesso à categoria (desligar por empresa)
  getCategoryOrgSummary: (): Promise<Record<string, { enabled: number; total: number }>> =>
    api.get('/categories/org-summary').then(r => r.data.data),
  getCategoryOrgs: (id: string): Promise<{ inPlan: { id: string; name: string; tier: string; enabled: boolean }[]; outOfPlan: { id: string; name: string; tier: string }[] }> =>
    api.get(`/categories/${id}/orgs`).then(r => r.data.data),
  setCategoryOrgs: (id: string, orgIds: string[], enabled: boolean): Promise<{ updated: number; skipped: { id: string; reason: string }[] }> =>
    api.put(`/categories/${id}/orgs`, { orgIds, enabled }).then(r => r.data.data),
  getOrgBlockedCategories: (orgId: string): Promise<string[]> =>
    api.get(`/organizations/${orgId}/blocked-categories`).then(r => r.data.data),

  // Subcategories
  createSubcategory: (data: any) => api.post('/categories/sub', data).then(r => r.data.data),
  updateSubcategory: (id: string, data: any) => api.patch(`/categories/sub/${id}`, data).then(r => r.data.data),
  deleteSubcategory: (id: string) => api.delete(`/categories/sub/${id}`),

  // SLA
  getSlaConfigs: () => api.get('/sla').then(r => r.data.data),
  createSlaConfig: (data: any) => api.post('/sla', data).then(r => r.data.data),
  updateSlaConfig: (id: string, data: any) => api.patch(`/sla/${id}`, data).then(r => r.data.data),
  deleteSlaConfig: (id: string) => api.delete(`/sla/${id}`),

  // Pacotes adicionais (feature 196)
  getAdditionalPackages: () => api.get('/sla/packages').then(r => r.data.data),          // catálogo ativo (seletor de alocação)
  getAllPackages: () => api.get('/sla/packages', { params: { include_inactive: 'true' } }).then(r => r.data.data), // gestão (inclui inativos)
  createPackage: (data: { name: string; description?: string | null }) =>
    api.post('/sla/packages', data).then(r => r.data.data),
  updatePackage: (id: string, data: { name?: string; description?: string | null; active?: boolean }) =>
    api.patch(`/sla/packages/${id}`, data).then(r => r.data.data),
  setPlanPackages: (id: string, packageIds: string[]) =>
    api.put(`/sla/${id}/packages`, { packageIds }).then(r => r.data.data),
  setPlanCategories: (id: string, categoryIds: string[]) =>
    api.put(`/sla/${id}/categories`, { categoryIds }).then(r => r.data.data),

  // Horário comercial (motor de SLA)
  getBusinessHours: () => api.get('/business-hours').then(r => r.data.data),
  updateBusinessHours: (data: any) => api.patch('/business-hours', data).then(r => r.data.data),

  // Queues
  getQueues: (includeInactive = false) => api.get('/queues', { params: includeInactive ? { include_inactive: 'true' } : {} }).then(r => r.data.data),
  createQueue: (data: any) => api.post('/queues', data).then(r => r.data.data),
  updateQueue: (id: string, data: any) => api.patch(`/queues/${id}`, data).then(r => r.data.data),
  deleteQueue: (id: string) => api.delete(`/queues/${id}`),
  getQueueAgents: (id: string) => api.get(`/queues/${id}/agents`).then(r => r.data.data),
  addQueueAgents: (id: string, userIds: string[]) => api.post(`/queues/${id}/agents`, { userIds }).then(r => r.data.data),
  removeQueueAgent: (id: string, userId: string) => api.delete(`/queues/${id}/agents/${userId}`).then(r => r.data.data),


  // Routing Rules
  getRoutingRules: () => api.get('/routing').then(r => r.data.data),
  createRoutingRule: (data: any) => api.post('/routing', data).then(r => r.data.data),
  updateRoutingRule: (id: string, data: any) => api.patch(`/routing/${id}`, data).then(r => r.data.data),
  deleteRoutingRule: (id: string) => api.delete(`/routing/${id}`),
  reorderRoutingRules: (ids: string[]) => api.post('/routing/reorder', { ids }),
  getRoutingSchema: () => api.get('/routing/schema').then(r => r.data.data),
  // Projetos onde o usuário edita (tipos + tasks com prazo): opções das ações de projeto.
  getRoutingProjectTargets: () => api.get('/routing/project-targets').then(r => r.data.data),
  testRoutingRule: (rule: any, ticket: string) => api.post('/routing/test', { rule, ticket }).then(r => r.data.data),

  // Audit Logs
  getAuditLogs: (params: any) => api.get('/audit', { params }).then(r => r.data),
  getEmailLogs: (params: any) => api.get('/email-logs', { params }).then(r => r.data),
  getEmailLog: (id: string) => api.get(`/email-logs/${id}`).then(r => r.data),
  getInboundEmails: (params: any) => api.get('/email-logs/inbound', { params }).then(r => r.data),
  getEmailSettings: () => api.get('/email-logs/settings').then(r => r.data),
  testEmailConnection: () => api.post('/email-logs/settings/test').then(r => r.data),
  getEmailBlocks: () => api.get('/email-logs/blocks').then(r => r.data),
  createEmailBlock: (data: { kind: 'email' | 'domain'; value: string; reason?: string }) => api.post('/email-logs/blocks', data).then(r => r.data),
  deleteEmailBlock: (id: string) => api.delete(`/email-logs/blocks/${id}`),

  // Escalation Rules
  getEscalationRules: () => api.get('/escalation').then(r => r.data.data),
  createEscalationRule: (data: any) => api.post('/escalation', data).then(r => r.data.data),
  updateEscalationRule: (id: string, data: any) => api.patch(`/escalation/${id}`, data).then(r => r.data.data),
  deleteEscalationRule: (id: string) => api.delete(`/escalation/${id}`),

  // Org Queue Access
  getOrgQueueAccess: (orgId: string) => api.get(`/organizations/${orgId}/queue-access`).then(r => r.data.data),
  upsertOrgQueueAccess: (orgId: string, data: any) => api.post(`/organizations/${orgId}/queue-access`, data).then(r => r.data.data),

  // Quem atende a empresa (carteira vista pela empresa)
  getOrgServedBy: (orgId: string) => api.get(`/organizations/${orgId}/served-by`).then(r => r.data.data as OrgServedBy),
  addOrgServedBy: (orgId: string, userId: string) => api.post(`/organizations/${orgId}/served-by`, { userId }).then(r => r.data.data as OrgServedBy),
  removeOrgServedBy: (orgId: string, userId: string) => api.delete(`/organizations/${orgId}/served-by/${userId}`).then(r => r.data.data as OrgServedBy),

  // Inactivity Redirect
  getInactivityConfig: () => api.get('/inactivity/config').then(r => r.data.data),
  updateInactivityConfig: (data: any) => api.patch('/inactivity/config', data).then(r => r.data.data),
  getInactivityLogs: (params: any) => api.get('/inactivity/logs', { params }).then(r => r.data),
  triggerInactivityJob: () => api.post('/inactivity/trigger').then(r => r.data),
  // Auto Close (Resolvido → Fechado)
  getAutoCloseConfig: () => api.get('/auto-close/config').then(r => r.data.data),
  updateAutoCloseConfig: (data: any) => api.patch('/auto-close/config', data).then(r => r.data.data),
  getAutoCloseLogs: (params: any) => api.get('/auto-close/logs', { params }).then(r => r.data),
  triggerAutoCloseJob: () => api.post('/auto-close/trigger').then(r => r.data),

  // Reopen SLA
  getReopenSlaConfig: () => api.get('/reopen-sla/config').then(r => r.data.data),
  updateReopenSlaConfig: (data: any) => api.patch('/reopen-sla/config', data).then(r => r.data.data),

  // Ticket Types
  getTicketTypeConfigs: () => api.get('/ticket-types').then(r => r.data.data),
  updateTicketTypeConfig: (type: string, enabled: boolean) => api.patch(`/ticket-types/${type}`, { enabled }).then(r => r.data.data),
}
