import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantLauncher, AssistantPanel, HISTORY_LIMIT, toHistory, type ChatItem } from './AssistantPanel'
import { assistantService } from '@/services/assistantService'

vi.mock('@/services/assistantService', () => ({ assistantService: { chat: vi.fn() } }))
const chat = vi.mocked(assistantService.chat)

const renderPanel = (onClose = vi.fn(), onTicketChange?: () => void) =>
  render(<MemoryRouter><AssistantPanel userId="u1" onClose={onClose} onTicketChange={onTicketChange} /></MemoryRouter>)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function type(text: string) {
  const box = screen.getByLabelText('Mensagem para a Skadi')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

beforeEach(() => {
  chat.mockReset()
  sessionStorage.clear()
})

describe('AssistantPanel', () => {
  it('apresenta a Skadi: rosto, nome, subtítulo e saudação com a foto acenando', () => {
    renderPanel()
    const dialog = screen.getByRole('dialog', { name: 'Skadi' })
    expect(within(dialog).getByRole('heading', { name: 'Skadi' })).toBeInTheDocument()
    expect(within(dialog).getByText('Assistente de IA do ISA')).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: 'Skadi' })).toHaveAttribute('src', '/skadi/skadi-avatar.svg')
    expect(within(dialog).getByText('Olá! Eu sou a Skadi.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('img', { name: 'Skadi acenando' })).not.toBeInTheDocument()
  })

  it('a saudação sai quando a conversa começa; o rosto do cabeçalho fica', async () => {
    chat.mockResolvedValue({ text: 'Certo.' })
    renderPanel()
    type('Oi')
    await screen.findByText('Certo.')
    expect(screen.getByRole('img', { name: 'Skadi' })).toBeInTheDocument()
  })

  it('vazio: mostra as sugestões e envia a escolhida', async () => {
    chat.mockResolvedValue({ text: 'Vamos ver isso. A impressora está ligada?' })
    renderPanel()
    expect(screen.getByText('Como posso ajudar?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver meus chamados' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Minha impressora não imprime' }))
    expect(await screen.findByText('Vamos ver isso. A impressora está ligada?')).toBeInTheDocument()
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ message: 'Minha impressora não imprime', history: [] }))
    expect(screen.queryByText('Como posso ajudar?')).toBeNull()
  })

  it('enviando: mostra "digitando", bloqueia o envio e manda o histórico na próxima', async () => {
    const pending = deferred<{ text: string }>()
    chat.mockReturnValueOnce(pending.promise)
    renderPanel()
    type('Outlook não abre')
    expect(screen.getByRole('status')).toHaveTextContent('Skadi está digitando')
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled()
    pending.resolve({ text: 'Tente reiniciar o Outlook.' })
    expect(await screen.findByText('Tente reiniciar o Outlook.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()

    chat.mockResolvedValueOnce({ text: 'Certo.' })
    type('Não resolveu')
    await screen.findByText('Certo.')
    expect(chat).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Não resolveu',
      history: [{ role: 'user', content: 'Outlook não abre' }, { role: 'assistant', content: 'Tente reiniciar o Outlook.' }],
    }))
    // Mesma conversa nas duas chamadas.
    expect(chat.mock.calls[0][0].conversationId).toBe(chat.mock.calls[1][0].conversationId)
  })

  it('erro: avisa e "Tentar de novo" reenvia a mesma mensagem', async () => {
    chat.mockRejectedValueOnce({ response: { data: { error: 'Você enviou muitas mensagens.' } } })
    renderPanel()
    type('VPN não conecta')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Você enviou muitas mensagens.')
    chat.mockResolvedValueOnce({ text: 'Agora foi.' })
    fireEvent.click(within(alert).getByRole('button', { name: /Tentar de novo/ }))
    expect(await screen.findByText('Agora foi.')).toBeInTheDocument()
    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[1][0]).toEqual(chat.mock.calls[0][0])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByText('VPN não conecta')).toHaveLength(1)
  })

  it('confirmação: card com resumo, Confirmar manda o confirm e o sucesso traz o link do chamado', async () => {
    const action = { tool: 'abrir_chamado', input: { titulo: 'Impressora', descricao: 'Não imprime' }, summary: 'Abrir chamado "Impressora"' }
    chat.mockResolvedValueOnce({ text: 'Confira o resumo abaixo e confirme.', pending: action })
    const onTicketChange = vi.fn()
    renderPanel(vi.fn(), onTicketChange)
    type('abre um chamado')
    const card = await screen.findByRole('group', { name: 'Confirmar ação da Skadi' })
    expect(card).toHaveTextContent('Abrir chamado "Impressora"')

    chat.mockResolvedValueOnce({ text: 'Pronto: chamado aberto.', ticket: { id: 'tk-1', numero: 'ISA-77' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Pronto: chamado aberto.')).toBeInTheDocument()
    expect(chat).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: action, message: 'Confirmar' }))
    expect(screen.getByRole('link', { name: 'Ver chamado ISA-77' })).toHaveAttribute('href', '/c/tk-1')
    expect(screen.queryByRole('group', { name: 'Confirmar ação da Skadi' })).toBeNull()
    // A lista do portal recarrega com o chamado novo.
    expect(onTicketChange).toHaveBeenCalledTimes(1)
  })

  it('Cancelar não chama o servidor e encerra a pendência', async () => {
    chat.mockResolvedValueOnce({ text: 'Confirma?', pending: { tool: 'reabrir_chamado', input: {}, summary: 'Reabrir ISA-1' } })
    renderPanel()
    type('reabre o ISA-1')
    const card = await screen.findByRole('group', { name: 'Confirmar ação da Skadi' })
    fireEvent.click(within(card).getByRole('button', { name: 'Cancelar' }))
    expect(chat).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/não fiz nada/)).toBeInTheDocument()
    expect(screen.getByText('Ação não executada.')).toBeInTheDocument()
  })

  it('fontes do Learn viram links externos', async () => {
    chat.mockResolvedValueOnce({ text: 'Siga os passos.', sources: [{ title: 'Redefinir senha', url: 'https://learn.microsoft.com/pt-br/x' }] })
    renderPanel()
    type('esqueci a senha')
    const link = await screen.findByRole('link', { name: /Redefinir senha/ })
    expect(link).toHaveAttribute('href', 'https://learn.microsoft.com/pt-br/x')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('a conversa sobrevive a fechar e abrir (sessionStorage) e "Nova conversa" limpa', async () => {
    chat.mockResolvedValueOnce({ text: 'Oi! Em que posso ajudar?' })
    const first = renderPanel()
    type('oi')
    await screen.findByText('Oi! Em que posso ajudar?')
    first.unmount()
    renderPanel()
    expect(screen.getByText('Oi! Em que posso ajudar?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
    expect(screen.getByText('Como posso ajudar?')).toBeInTheDocument()
  })

  it('o histórico enviado tem no máximo as últimas mensagens', () => {
    const items: ChatItem[] = Array.from({ length: 30 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: `m${i}` }))
    const h = toHistory(items)
    expect(h).toHaveLength(HISTORY_LIMIT)
    expect(h[h.length - 1]).toEqual({ role: 'assistant', content: 'm29' })
  })
})

describe('AssistantLauncher', () => {
  it('abre o painel, Esc fecha e o foco volta ao botão', async () => {
    render(<MemoryRouter><AssistantLauncher userId="u1" /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Skadi' }))
    const dialog = screen.getByRole('dialog', { name: 'Skadi' })
    expect(screen.getByLabelText('Mensagem para a Skadi')).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skadi' })).toHaveFocus())
  })

  it('o botão mostra o rosto da Skadi e continua abrindo se a imagem falhar', () => {
    render(<MemoryRouter><AssistantLauncher userId="u1" /></MemoryRouter>)
    const button = screen.getByRole('button', { name: 'Skadi' })
    const face = button.querySelector('img')!
    expect(face).toHaveAttribute('src', '/skadi/skadi-avatar.svg')
    fireEvent.error(face)
    fireEvent.click(screen.getByRole('button', { name: 'Skadi' }))
    expect(screen.getByRole('dialog', { name: 'Skadi' })).toBeInTheDocument()
  })
})
