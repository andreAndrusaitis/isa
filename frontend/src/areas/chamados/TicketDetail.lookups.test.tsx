// Chamado aberto para empresa e cliente cadastrados depois que as
// listas de usuários/empresas foram carregadas. O painel usa o solicitante e a
// empresa que vêm no GET /tickets/:id em vez de ficar vazio.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TicketDetail } from './TicketDetail'
import type { AuthUser } from '@/store/auth'
import type { Ticket } from '@/types'
import { ticketService } from '@/services/ticketService'

vi.mock('@/services/ticketService', () => ({
  ticketService: {
    getTicket: vi.fn(),
    getMessages: vi.fn(),
    updateTicket: vi.fn(),
  },
}))
vi.mock('@/services/adminService', () => ({
  adminService: {
    getReopenSlaConfig: vi.fn().mockResolvedValue(null),
    getTicketTypeConfigs: vi.fn().mockResolvedValue([]),
    getEscalationRules: vi.fn().mockResolvedValue([]),
    getBusinessHours: vi.fn().mockResolvedValue(null),
    getOrgBlockedCategories: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/services/macroService', () => ({ macroService: { getMacros: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/services/socketService', () => ({
  getSocket: vi.fn().mockReturnValue(null),
  joinTicketRoom: vi.fn(),
  leaveTicketRoom: vi.fn(),
}))

const now = new Date().toISOString()
const ticket = {
  id: 'ISA-2001', displayNumber: 'INC-2001', title: 'Acesso ao ERP', description: 'desc',
  status: 'open', priority: 'medium', type: 'incident', queue: 'geral', userId: 'cliente-novo', orgId: 'org-nova',
  categoryId: null, subcategoryId: null, assignedToId: null, messages: [], events: [], participants: [],
  createdAt: now, updatedAt: now,
} as unknown as Ticket
const analyst = { id: 'agent-1', name: 'Analista', role: 'agent', queues: ['geral'], permissions: [], modules: { tickets: true, projects: false } } as unknown as AuthUser

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ticketService.getMessages).mockResolvedValue([] as any)
})

describe('TicketDetail — cadastro feito depois do carregamento das listas', () => {
  it('mostra solicitante e empresa vindos do próprio chamado', async () => {
    vi.mocked(ticketService.getTicket).mockResolvedValue({
      events: [{ id: 'e1', ticketId: ticket.id, toStatus: 'open', note: 'Chamado aberto em nome de Maria Nova (Empresa Recém Cadastrada)', createdAt: now, user: { id: 'agent-1', name: 'Analista' } }],
      participants: [],
      user: { id: 'cliente-novo', name: 'Maria Nova', email: 'maria@nova.com.br', avatar: null },
      org: { id: 'org-nova', name: 'Empresa Recém Cadastrada', tier: 'bronze', sla_config: null },
    } as any)

    render(<TicketDetail ticket={ticket} currentUser={analyst} users={[]} queues={[]} categories={[]} orgs={[]} onClose={() => {}} onTicketUpdate={() => {}} />)

    expect((await screen.findAllByText('Maria Nova')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('maria@nova.com.br').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Empresa Recém Cadastrada').length).toBeGreaterThan(0)
    expect(screen.queryByText(/cliente-novo/)).toBeNull()
  })
})
