// A descrição digitada com Enter (parágrafos, listas) aparecia toda
// colada no portal do cliente. Ela precisa manter as quebras de linha.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserTicketDetail } from './UserTicketDetail'
import { ticketService } from '@/services/ticketService'
import type { Ticket, TicketMessage } from '@/types'

vi.mock('@/services/ticketService', () => ({
  ticketService: {
    getTicket: vi.fn().mockResolvedValue({ events: [], participants: [], attachments: [] }),
    getMessages: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/services/socketService', () => ({
  getSocket: vi.fn().mockReturnValue(null),
  joinTicketRoom: vi.fn(),
  leaveTicketRoom: vi.fn(),
}))
vi.mock('@/components/GuidanceActions', () => ({ GuidanceActions: () => null }))
// jsdom não implementa scrollIntoView (o chat rola até a última mensagem).
Element.prototype.scrollIntoView = vi.fn()

const now = new Date().toISOString()
const description = 'O ERP não abre.\n\nPassos:\n1. Abrir o atalho\n2. Informar a senha'
const ticket = {
  id: 'ISA-3001', displayNumber: 'INC-3001', title: 'ERP não abre', description,
  status: 'open', priority: 'medium', type: 'incident', queue: 'geral', userId: 'cliente-1', orgId: 'org-1',
  categoryId: null, subcategoryId: null, assignedToId: null, messages: [], events: [], participants: [],
  createdAt: now, updatedAt: now,
} as unknown as Ticket

describe('UserTicketDetail — chamado resolvido pela IA', () => {
  const resolved = {
    ...ticket, status: 'resolved', resolved_at: now, resolution_details: 'Resolvido via IA.',
    slaDeadline: new Date(Date.now() + 864e5).toISOString(),
  }
  const renderTicket = (t: object) =>
    render(<UserTicketDetail ticket={t as Ticket} currentUserId="cliente-1" categories={[]} onBack={() => {}} />)

  it.each(['resolved', 'closed'])('%s: mostra o selo e esconde o prazo e a previsão', async status => {
    renderTicket({ ...resolved, status, aiResolved: true })
    expect(await screen.findByText('Resolvido pela Skadi')).toBeInTheDocument()
    expect(screen.queryByText(/SLA:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Previsão')).not.toBeInTheDocument()
    expect(screen.queryByText('Resolvido em')).not.toBeInTheDocument()
  })

  it('resolvido por analista mostra quando, sem falar de SLA e sem selo', async () => {
    renderTicket({ ...resolved, aiResolved: false })
    expect(await screen.findByText('Resolvido em')).toBeInTheDocument()
    expect(screen.queryByText(/SLA/)).not.toBeInTheDocument()
    expect(screen.queryByText('Resolvido pela Skadi')).not.toBeInTheDocument()
  })

  it('prazo passado nunca vira "vencido" para o cliente', async () => {
    renderTicket({ ...resolved, status: 'open', resolved_at: null, aiResolved: false, slaDeadline: new Date(Date.now() - 864e5).toISOString() })
    expect((await screen.findAllByText('Vamos informar uma nova previsão.')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/vencido/i)).not.toBeInTheDocument()
  })

  it('resolvido e ainda no prazo de reabrir: pergunta se resolveu', async () => {
    renderTicket({ ...resolved, aiResolved: false, canReopen: true })
    expect(await screen.findByRole('button', { name: 'Resolveu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ainda não' })).toBeInTheDocument()
  })

  it('de volta à fila perde o selo e volta a ter previsão, mesmo com a marca ainda na tela', async () => {
    renderTicket({ ...resolved, status: 'open', resolved_at: null, aiResolved: true })
    expect(await screen.findByText('Previsão')).toBeInTheDocument()
    expect(screen.queryByText('Resolvido pela Skadi')).not.toBeInTheDocument()
  })
})

describe('UserTicketDetail — descrição do chamado', () => {
  it('preserva as quebras de linha digitadas', async () => {
    render(<UserTicketDetail ticket={ticket} currentUserId="cliente-1" categories={[]} onBack={() => {}} />)

    const paragraph = await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === description)
    expect(paragraph.style.whiteSpace).toBe('pre-wrap')
  })
})

// O chamado antigo precisa deixar claro por que foi aberto.
describe('UserTicketDetail — solicitação original', () => {
  const opened = new Date(2026, 9, 13, 14, 32).toISOString()
  const emailTicket = {
    ...ticket, channel: 'email', createdAt: opened, title: 'Impressora do 3º andar',
    description: 'Bom dia, a impressora do 3º andar não imprime desde ontem.\n\nNorberto',
    user: { id: 'cliente-1', name: 'Norberto', email: 'nivaldo@cliente.com' },
  } as unknown as Ticket
  const reply = (text: string, at: Date) => [{
    id: 'm1', ticketId: ticket.id, userId: 'agente-1', type: 'agent', text, createdAt: at.toISOString(),
    user: { id: 'agente-1', name: 'Bruno Lima', avatar: null },
  }] as unknown as TicketMessage[]
  const renderTicket = (t: Ticket) =>
    render(<UserTicketDetail ticket={t} currentUserId="cliente-1" categories={[]} onBack={() => {}} />)

  it('mostra a solicitação original com autor, data e hora e canal e-mail', async () => {
    renderTicket(emailTicket)
    const section = await screen.findByRole('region', { name: 'Solicitação original' })
    expect(section).toHaveTextContent('Aberto por você em 13/10/2026 14:32 · por e-mail')
    expect(section).toHaveTextContent('a impressora do 3º andar não imprime desde ontem')
  })

  it('a solicitação original é o 1º item da trilha, antes das respostas', async () => {
    vi.mocked(ticketService.getMessages).mockResolvedValueOnce(reply('Já verificamos o toner.', new Date(2026, 9, 14, 9, 5)))
    renderTicket(emailTicket)
    const answer = await screen.findByText('Já verificamos o toner.')
    const opening = screen.getByTestId('opening-request')
    expect(opening).toHaveTextContent('Abertura do chamado')
    expect(opening).toHaveTextContent('13/10/2026 14:32')
    expect(opening).toHaveTextContent('não imprime desde ontem')
    expect(opening.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sem nenhuma resposta, a trilha mostra a abertura em vez de vazia', async () => {
    renderTicket(emailTicket)
    expect(await screen.findByTestId('opening-request')).toBeInTheDocument()
    expect(screen.queryByText('Sem registros')).not.toBeInTheDocument()
  })

  // Cada interação mostra o dia, não só a hora.
  it('mensagem e solução aplicada mostram data e hora', async () => {
    vi.mocked(ticketService.getMessages).mockResolvedValueOnce(reply('Reiniciei o serviço.', new Date(2026, 9, 14, 9, 5)))
    renderTicket({
      ...emailTicket, status: 'resolved', resolution_details: 'Serviço reiniciado.',
      resolved_at: new Date(2026, 9, 15, 17, 40).toISOString(), slaDeadline: new Date(Date.now() + 864e5).toISOString(),
    } as unknown as Ticket)
    await screen.findByText('Reiniciei o serviço.')
    expect(screen.getByText('Bruno Lima').parentElement).toHaveTextContent('14/10/2026 09:05')
    expect(screen.getAllByText('Solução aplicada').pop()!.parentElement?.parentElement).toHaveTextContent('15/10/2026 17:40')
  })
})
