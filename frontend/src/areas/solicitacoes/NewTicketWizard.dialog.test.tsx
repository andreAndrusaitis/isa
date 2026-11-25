import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/services/ticketService', () => ({ ticketService: { createTicket: vi.fn(), addMessage: vi.fn() } }))
vi.mock('@/services/adminService', () => ({ adminService: { getUsers: vi.fn(async () => []) } }))
vi.mock('@/services/aiSuggestService', () => ({
  aiSuggestService: { status: vi.fn(), suggest: vi.fn(), accept: vi.fn(), feedback: vi.fn() },
}))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/teams/dialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/teams/dialog')>()),
  submitDialog: vi.fn(async () => true),
}))

import { NewTicketWizard } from './NewTicketWizard'
import { opensNewTicket } from './UserPortalPage'
import { aiSuggestService } from '@/services/aiSuggestService'
import { ticketService } from '@/services/ticketService'
import { submitDialog } from '@/teams/dialog'
import { resetTeamsContext } from '@/teams/teamsContext'

const categories = [{ id: 'c1', name: 'Infraestrutura', description: 'Rede e impressoras', subcategories: [] }]

function at(url: string) {
  sessionStorage.clear()
  window.history.replaceState(null, '', url)
  resetTeamsContext()
}

function renderWizard() {
  const onBack = vi.fn()
  const onRefresh = vi.fn(async () => {})
  render(<NewTicketWizard categories={categories} org={null} onBack={onBack} onRefresh={onRefresh} />)
  fireEvent.click(screen.getByText('Infraestrutura'))
  return { onBack, onRefresh }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ticketService.createTicket).mockResolvedValue({ id: 't9', displayNumber: 'ISA-9' } as any)
  vi.mocked(aiSuggestService.status).mockResolvedValue({ enabled: false, shadow: false })
})

describe('wizard em dialog do Teams', () => {
  it('vem preenchido pela URL (limpo) e devolve o chamado ao bot em vez de voltar à lista', async () => {
    at(`/solicitacoes/nova?teams=1&dialog=1&titulo=${encodeURIComponent('<b>Impressora</b> parada')}&descricao=${encodeURIComponent('Não imprime desde ontem')}`)
    const { onBack, onRefresh } = renderWizard()
    expect(screen.getByPlaceholderText('Ex: Não consigo acessar meu e-mail')).toHaveValue('Impressora parada')
    expect(screen.getByPlaceholderText(/Por favor, descreva/)).toHaveValue('Não imprime desde ontem')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }))
    await waitFor(() => expect(submitDialog).toHaveBeenCalledWith({ ticketId: 't9', numero: 'ISA-9' }))
    expect(ticketService.createTicket).toHaveBeenCalledWith(expect.objectContaining({ title: 'Impressora parada', description: 'Não imprime desde ontem' }))
    expect(onRefresh).not.toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('fora do modo dialog nada muda: campos vazios, sem submit ao Teams', async () => {
    at('/solicitacoes/nova?titulo=Nao%20usar')
    const { onRefresh } = renderWizard()
    const title = screen.getByPlaceholderText('Ex: Não consigo acessar meu e-mail')
    expect(title).toHaveValue('')
    fireEvent.change(title, { target: { value: 'VPN não conecta' } })
    fireEvent.change(screen.getByPlaceholderText(/Por favor, descreva/), { target: { value: 'Erro 809' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(submitDialog).not.toHaveBeenCalled()
  })
})

describe('card de solução no dialog do Teams', () => {
  async function openCard() {
    vi.mocked(aiSuggestService.status).mockResolvedValue({ enabled: true, shadow: false })
    vi.mocked(aiSuggestService.suggest).mockResolvedValue({
      answer: 'Reinicie o cliente.', confidence: 0.9, sources: [{ articleId: 'a1', title: 'VPN' }], interactionId: 'i1',
    })
    at(`/solicitacoes/nova?teams=1&dialog=1&titulo=VPN&descricao=${encodeURIComponent('Erro 809')}`)
    const props = renderWizard()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }))
    await screen.findByRole('region', { name: 'A Skadi encontrou uma possível solução' })
    return props
  }

  it('aceitar devolve o chamado ao bot como qualquer abertura', async () => {
    vi.mocked(aiSuggestService.accept).mockResolvedValue({ id: 't7', displayNumber: 'ISA-7' } as any)
    const { onRefresh } = await openCard()
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e Encerrar' }))
    await waitFor(() => expect(submitDialog).toHaveBeenCalledWith({ ticketId: 't7', numero: 'ISA-7' }))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('prosseguir devolve o chamado ao bot com a interação ligada', async () => {
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: 'Prosseguir com Atendimento Humano' }))
    await waitFor(() => expect(submitDialog).toHaveBeenCalledWith({ ticketId: 't9', numero: 'ISA-9' }))
    expect(ticketService.createTicket).toHaveBeenCalledWith(expect.objectContaining({ aiInteractionId: 'i1' }))
  })
})

describe('endereço que abre o wizard', () => {
  it('/solicitacoes/nova e ?nova=1 abrem direto o wizard', () => {
    expect(opensNewTicket('/solicitacoes/nova', '?teams=1&dialog=1')).toBe(true)
    expect(opensNewTicket('/solicitacoes/nova/', '')).toBe(true)
    expect(opensNewTicket('/solicitacoes', '?nova=1&teams=1&dialog=1')).toBe(true)
    expect(opensNewTicket('/solicitacoes', '')).toBe(false)
    expect(opensNewTicket('/solicitacoes', '?ticket=t1')).toBe(false)
  })
})
