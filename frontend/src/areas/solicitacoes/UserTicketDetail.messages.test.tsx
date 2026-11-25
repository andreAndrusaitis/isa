// A IA escreve ao cliente com o usuário de sistema: na conversa ela aparece como
// Skadi, e só as mensagens dela. Aviso comum de sistema segue "Sistema".
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserTicketDetail } from './UserTicketDetail'
import { ticketService } from '@/services/ticketService'
import { SKADI_AVATAR_SRC } from '@/utils/skadi'
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

const SYSTEM = '00000000-0000-0000-0000-000000000000'
const now = new Date().toISOString()
const ticket = {
  id: 'ISA-3002', displayNumber: 'INC-3002', title: 'VPN caiu', description: 'Sem acesso',
  status: 'open', priority: 'medium', type: 'incident', queue: 'geral', userId: 'cliente-1', orgId: 'org-1',
  categoryId: null, subcategoryId: null, assignedToId: null, messages: [], events: [], participants: [],
  createdAt: now, updatedAt: now,
} as unknown as Ticket

const message = (text: string, over: Partial<TicketMessage> = {}) => ({
  id: 'm1', ticketId: ticket.id, userId: SYSTEM, type: 'agent', text, createdAt: now,
  user: { id: SYSTEM, name: 'Sistema', avatar: null }, ...over,
}) as unknown as TicketMessage

const renderWith = async (msg: TicketMessage) => {
  vi.mocked(ticketService.getMessages).mockResolvedValue([msg])
  const view = render(<UserTicketDetail ticket={ticket} currentUserId="cliente-1" categories={[]} onBack={() => {}} />)
  await screen.findByText(new RegExp(msg.text.split('\n')[0]))
  return view
}
const skadiAvatar = (c: HTMLElement) => c.querySelector(`img[src="${SKADI_AVATAR_SRC}"]`)

describe('UserTicketDetail: mensagens da IA na Trilha de atendimento', () => {
  it('mensagem assinada aparece como Skadi, com o avatar e sem repetir a assinatura', async () => {
    const { container } = await renderWith(message('Reinicie o cliente da VPN.\n— Skadi'))
    expect(screen.getByText('Skadi')).toBeInTheDocument()
    expect(skadiAvatar(container)).toBeInTheDocument()
    expect(screen.queryByText('Sistema')).not.toBeInTheDocument()
    expect(screen.queryByText(/— Skadi/)).not.toBeInTheDocument()
  })

  it('assinatura antiga também aparece como Skadi', async () => {
    const { container } = await renderWith(message('Reinicie o cliente da VPN.\n— Assistente ISA'))
    expect(screen.getByText('Skadi')).toBeInTheDocument()
    expect(skadiAvatar(container)).toBeInTheDocument()
    expect(screen.queryByText(/Assistente ISA/)).not.toBeInTheDocument()
  })

  it('mensagem de sistema sem assinatura segue como Sistema', async () => {
    const { container } = await renderWith(message('Chamado reaberto automaticamente.'))
    expect(screen.getByText('Sistema')).toBeInTheDocument()
    expect(screen.queryByText('Skadi')).not.toBeInTheDocument()
    expect(skadiAvatar(container)).not.toBeInTheDocument()
  })

  it('pessoa que escreve a assinatura no fim do texto não vira Skadi', async () => {
    const { container } = await renderWith(message('Assinei como ela.\n— Skadi', { userId: 'analista-1', user: { id: 'analista-1', name: 'Bruno', avatar: null } as any }))
    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText(/— Skadi/)).toBeInTheDocument()
    expect(skadiAvatar(container)).not.toBeInTheDocument()
  })
})
