import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TicketDetail } from './TicketDetail'
import type { AuthUser } from '@/store/auth'
import type { Ticket, Category } from '@/types'
import { adminService } from '@/services/adminService'
import { ticketService } from '@/services/ticketService'
import { SKADI_AVATAR_SRC } from '@/utils/skadi'

vi.mock('@/services/ticketService', () => ({
  ticketService: {
    getTicket: vi.fn().mockResolvedValue({ events: [], participants: [] }),
    getMessages: vi.fn().mockResolvedValue([]),
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
vi.mock('@/services/macroService', () => ({
  macroService: { getMacros: vi.fn().mockResolvedValue([]) },
}))
vi.mock('@/services/socketService', () => ({
  getSocket: vi.fn().mockReturnValue(null),
  joinTicketRoom: vi.fn(),
  leaveTicketRoom: vi.fn(),
}))

const baseTicket: Ticket = {
  id: 'ISA-1001',
  displayNumber: 'INC-1001',
  title: 'Impressora não liga',
  description: 'desc',
  status: 'open',
  priority: 'medium',
  type: 'incident',
  queue: 'geral',
  userId: 'user-1',
  orgId: 'org-1',
  categoryId: null,
  subcategoryId: null,
  assignedToId: null,
  messages: [],
  events: [],
  participants: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Ticket

const adminUser = { id: 'admin-1', name: 'Admin', role: 'admin', queues: [] } as unknown as AuthUser
const agentUser = { id: 'agent-1', name: 'Agente', role: 'agent', queues: ['geral'] } as unknown as AuthUser

describe('TicketDetail — admin somente leitura', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderAs = (currentUser: AuthUser) => render(
    <TicketDetail
      ticket={baseTicket}
      currentUser={currentUser}
      users={[]}
      queues={[]}
      categories={[]}
      orgs={[]}
      onClose={() => {}}
      onTicketUpdate={() => {}}
    />
  )

  it('admin vê Ações apenas com "Excluir chamado" (não atua no chamado)', () => {
    renderAs(adminUser)
    fireEvent.click(screen.getByRole('button', { name: /ações/i }))
    expect(screen.getByRole('button', { name: /excluir chamado/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /conversa interna/i })).not.toBeInTheDocument()
  })

  it('"Excluir chamado" só aparece para agent com a permissão delete_tickets', () => {
    renderAs(agentUser)
    fireEvent.click(screen.getByRole('button', { name: /ações/i }))
    expect(screen.queryByRole('button', { name: /excluir chamado/i })).not.toBeInTheDocument()
  })

  it('agent com delete_tickets vê "Excluir chamado"', () => {
    renderAs({ ...agentUser, permissions: ['delete_tickets'] } as AuthUser)
    fireEvent.click(screen.getByRole('button', { name: /ações/i }))
    expect(screen.getByRole('button', { name: /excluir chamado/i })).toBeInTheDocument()
  })

  it('exibe o botão de Ações para agent', () => {
    render(
      <TicketDetail
        ticket={baseTicket}
        currentUser={agentUser}
        users={[]}
        queues={[]}
        categories={[]}
        orgs={[]}
        onClose={() => {}}
        onTicketUpdate={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /ações/i })).toBeInTheDocument()
  })
})

describe('TicketDetail — chamado resolvido pela IA', () => {
  const resolved = {
    ...baseTicket, status: 'resolved', resolved_at: new Date().toISOString(), resolution_details: 'Resolvido via IA.',
    slaDeadline: new Date(Date.now() + 864e5).toISOString(),
  }
  const renderTicket = (ticket: object) => render(
    <TicketDetail
      ticket={ticket as Ticket}
      currentUser={agentUser}
      users={[]}
      queues={[]}
      categories={[]}
      orgs={[]}
      onClose={() => {}}
      onTicketUpdate={() => {}}
    />
  )

  it.each(['resolved', 'closed'])('%s: mostra o selo e esconde o SLA e o prazo', status => {
    renderTicket({ ...resolved, status, aiResolved: true })
    expect(screen.getByText('Resolvido pela Skadi')).toBeInTheDocument()
    expect(screen.queryByText(/SLA no encerramento/)).not.toBeInTheDocument()
    expect(screen.queryByText(/SLA:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Prazo final/)).not.toBeInTheDocument()
  })

  it('resolvido por analista segue com o SLA, sem selo', () => {
    renderTicket({ ...resolved, aiResolved: false })
    expect(screen.queryByText('Resolvido pela Skadi')).not.toBeInTheDocument()
    expect(screen.getByText(/SLA no encerramento/)).toBeInTheDocument()
  })

  it('de volta à fila perde o selo e volta a ter prazo, mesmo com a marca ainda na tela', () => {
    renderTicket({ ...resolved, status: 'open', resolved_at: null, aiResolved: true })
    expect(screen.queryByText('Resolvido pela Skadi')).not.toBeInTheDocument()
    expect(screen.getByText(/Prazo final/)).toBeInTheDocument()
  })
})

describe('TicketDetail: mensagens da IA na timeline', () => {
  const SYSTEM = '00000000-0000-0000-0000-000000000000'
  const message = (text: string) => ({
    id: 'm1', ticketId: baseTicket.id, userId: SYSTEM, type: 'agent', text, createdAt: new Date().toISOString(),
    user: { id: SYSTEM, name: 'Sistema', avatar: null },
  })
  const renderWith = async (text: string) => {
    vi.mocked(ticketService.getMessages).mockResolvedValue([message(text)] as any)
    const view = render(
      <TicketDetail ticket={baseTicket} currentUser={agentUser} users={[]} queues={[]} categories={[]} orgs={[]}
        onClose={() => {}} onTicketUpdate={() => {}} />
    )
    await screen.findByText(new RegExp(text.split('\n')[0]))
    return view
  }
  const skadiAvatar = (c: HTMLElement) => c.querySelector(`img[src="${SKADI_AVATAR_SRC}"]`)

  it('mensagem assinada aparece como Skadi, com o avatar e sem repetir a assinatura', async () => {
    const { container } = await renderWith('Reinicie o cliente da VPN.\n— Skadi')
    expect(screen.getByText('Skadi')).toBeInTheDocument()
    expect(skadiAvatar(container)).toBeInTheDocument()
    expect(screen.queryByText('Sistema')).not.toBeInTheDocument()
    expect(screen.queryByText(/— Skadi/)).not.toBeInTheDocument()
  })

  it('assinatura antiga também aparece como Skadi', async () => {
    const { container } = await renderWith('Reinicie o cliente da VPN.\n— Assistente ISA')
    expect(screen.getByText('Skadi')).toBeInTheDocument()
    expect(skadiAvatar(container)).toBeInTheDocument()
    expect(screen.queryByText(/Assistente ISA/)).not.toBeInTheDocument()
  })

  it('mensagem de sistema sem assinatura segue como Sistema', async () => {
    const { container } = await renderWith('Chamado reaberto automaticamente.')
    expect(screen.getByText('Sistema')).toBeInTheDocument()
    expect(screen.queryByText('Skadi')).not.toBeInTheDocument()
    expect(skadiAvatar(container)).not.toBeInTheDocument()
  })
})

describe('TicketDetail — categorias desligadas para a empresa', () => {
  const cats = [
    { id: 'catA', name: 'Hardware', icon: '', subcategories: [] },
    { id: 'catB', name: 'Software', icon: '', subcategories: [] },
  ] as unknown as Category[]

  const openCatModal = (ticket: Ticket) => {
    render(
      <TicketDetail
        ticket={ticket}
        currentUser={agentUser}
        users={[]}
        queues={[]}
        categories={cats}
        orgs={[]}
        onClose={() => {}}
        onTicketUpdate={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Categoria'))
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('esconde a categoria desligada e mantém a atual', async () => {
    vi.mocked(adminService.getOrgBlockedCategories).mockResolvedValue(['catB'])
    openCatModal({ ...baseTicket, categoryId: 'catA' } as Ticket)
    await waitFor(() => expect(adminService.getOrgBlockedCategories).toHaveBeenCalledWith('org-1'))
    expect(await screen.findByRole('button', { name: 'Hardware' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Software' })).not.toBeInTheDocument())
  })

  it('sem orgId lista todas e não consulta o bloqueio', async () => {
    openCatModal({ ...baseTicket, orgId: null, categoryId: 'catA' } as Ticket)
    expect(await screen.findByRole('button', { name: 'Software' })).toBeInTheDocument()
    expect(adminService.getOrgBlockedCategories).not.toHaveBeenCalled()
  })
})

// Solicitação original com autor e data/hora; cada registro com o dia.
describe('TicketDetail — solicitação original e data/hora', () => {
  const opened = new Date(2026, 9, 13, 14, 32).toISOString()
  const emailTicket = {
    ...baseTicket, channel: 'email', createdAt: opened,
    description: 'Bom dia, a impressora do 3º andar não imprime desde ontem.',
  } as unknown as Ticket
  const renderTicket = () => render(
    <TicketDetail ticket={emailTicket} currentUser={agentUser} users={[]} queues={[]} categories={[]} orgs={[]}
      onClose={() => {}} onTicketUpdate={() => {}} />
  )
  beforeEach(() => {
    vi.mocked(ticketService.getTicket).mockResolvedValue({
      events: [{
        id: 'e1', ticketId: baseTicket.id, userId: 'agent-1', fromStatus: 'open', toStatus: 'in_progress',
        note: 'Status alterado', createdAt: new Date(2026, 9, 14, 8, 15).toISOString(), user: { id: 'agent-1', name: 'Bruno Lima' },
      }],
      participants: [], attachments: [],
      user: { id: 'user-1', name: 'Norberto', email: 'nivaldo@cliente.com' },
    } as any)
    vi.mocked(ticketService.getMessages).mockResolvedValue([{
      id: 'm1', ticketId: baseTicket.id, userId: 'agent-1', type: 'agent', text: 'Já verificamos o toner.',
      createdAt: new Date(2026, 9, 14, 9, 5).toISOString(), user: { id: 'agent-1', name: 'Bruno Lima', avatar: null },
    }] as any)
  })

  it('coluna da esquerda mostra a solicitação original com autor, data e hora e canal e-mail', async () => {
    renderTicket()
    expect(screen.getByText('Solicitação original')).toBeInTheDocument()
    expect(await screen.findByText('Aberto por Norberto em 13/10/2026 14:32 · por e-mail')).toBeInTheDocument()
  })

  it('timeline abre com a solicitação original (pública, não nota interna) com data e hora', async () => {
    renderTicket()
    const opening = await screen.findByTestId('opening-request')
    expect(opening).toHaveTextContent('não imprime desde ontem')
    const header = opening.previousElementSibling as HTMLElement
    expect(header).toHaveTextContent('Abertura do chamado')
    expect(header).toHaveTextContent('13/10/2026 14:32')
    expect(header).toHaveTextContent('E-mail')
    expect(header).not.toHaveTextContent('Interna')
  })

  it('resposta e evento da timeline mostram data e hora', async () => {
    renderTicket()
    const reply = await screen.findByText('Já verificamos o toner.')
    expect(reply.parentElement?.parentElement).toHaveTextContent('14/10/2026 09:05')
    expect(screen.getByText(/Status alterado/).parentElement).toHaveTextContent('14/10/2026 08:15')
  })
})
