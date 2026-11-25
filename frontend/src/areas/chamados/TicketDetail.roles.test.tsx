// Caracterização: o que cada cargo vê e pode fazer no detalhe do chamado,
// fotografado ANTES de dividir o TicketDetail. A divisão não pode mudar nenhuma
// destas fotos; mudança de propósito = atualizar a foto no mesmo commit.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
const ticket = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'ISA-1001', displayNumber: 'INC-1001', title: 'Impressora não liga', description: 'desc',
  status: 'in_progress', priority: 'medium', type: 'incident', queue: 'geral', userId: 'cliente-1', orgId: 'org-1',
  categoryId: null, subcategoryId: null, assignedToId: 'agent-1', messages: [], events: [], participants: [],
  createdAt: now, updatedAt: now, ...over,
}) as unknown as Ticket

const user = (role: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${role}-1`, name: role, role, queues: ['geral'], permissions: [], modules: { tickets: true, projects: false }, ...extra }) as unknown as AuthUser

// Mensagem de outra pessoa (para ver os botões de editar/apagar de terceiros).
const otherMessage = { id: 'm1', ticketId: 'ISA-1001', userId: 'cliente-1', type: 'user', text: 'Mensagem do cliente', createdAt: now, user: { id: 'cliente-1', name: 'Cliente', role: 'user' } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ticketService.getTicket).mockResolvedValue({ events: [], participants: [] } as any)
  vi.mocked(ticketService.getMessages).mockResolvedValue([otherMessage] as any)
})

/** Nomes acessíveis de todos os botões visíveis, com o menu Ações aberto. */
async function visibleActions(u: AuthUser, t: Ticket, participants: unknown[] = []) {
  vi.mocked(ticketService.getTicket).mockResolvedValue({ events: [], participants } as any)
  const { container } = render(
    <TicketDetail ticket={t} currentUser={u} users={[]} queues={[]} categories={[]} orgs={[]} onClose={() => {}} onTicketUpdate={() => {}} />,
  )
  await waitFor(() => expect(ticketService.getMessages).toHaveBeenCalled())
  await new Promise(r => setTimeout(r, 0))
  const acoes = screen.queryByRole('button', { name: /^ações/i })
  if (acoes) fireEvent.click(acoes)
  const names = within(container).queryAllByRole('button').map(b => (b.getAttribute('aria-label') || b.textContent || b.getAttribute('title') || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  const composer = !!container.querySelector('textarea')
  return { botoes: [...new Set(names)].sort(), podeEscrever: composer }
}

const SCENARIOS: Array<[string, AuthUser, Ticket, unknown[]?]> = [
  ['admin (só olha)', user('admin'), ticket()],
  ['analista responsável', user('agent', { id: 'agent-1' }), ticket()],
  ['analista, chamado sem responsável', user('agent', { id: 'agent-2' }), ticket({ assignedToId: null, status: 'open' })],
  ['analista colaborador', user('agent', { id: 'agent-2' }), ticket(), [{ agentId: 'agent-2', role: 'collaborator', active: true }]],
  ['analista com excluir chamados', user('agent', { id: 'agent-1', permissions: ['orgs', 'users', 'delete_tickets'] }), ticket()],
  ['analista com editar mensagens', user('agent', { id: 'agent-1', permissions: ['orgs', 'users', 'edit_messages'] }), ticket()],
  ['analista com Projetos', user('agent', { id: 'agent-1', modules: { tickets: true, projects: true } }), ticket()],
  ['Ticket Manager', user('supervisor'), ticket()],
  ['Gerente', user('manager'), ticket()],
  ['TM, chamado escalonado', user('supervisor'), ticket({ escalated: true })],
  ['analista, chamado resolvido', user('agent', { id: 'agent-1' }), ticket({ status: 'resolved' })],
]

describe('TicketDetail — o que cada cargo vê (caracterização)', () => {
  for (const [name, u, t, participants] of SCENARIOS) {
    it(name, async () => {
      expect(await visibleActions(u, t, participants ?? [])).toMatchSnapshot()
    })
  }
})
