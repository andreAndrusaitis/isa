import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/services/ticketService', () => ({ ticketService: { createTicket: vi.fn(), addMessage: vi.fn() } }))
vi.mock('@/services/adminService', () => ({ adminService: { getUsers: vi.fn(async () => []) } }))
vi.mock('@/services/aiSuggestService', () => ({
  aiSuggestService: { status: vi.fn(), suggest: vi.fn(), accept: vi.fn(), feedback: vi.fn() },
}))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { NewTicketWizard } from './NewTicketWizard'
import { SUGGEST_TIMEOUT_MS } from '@/hooks/useAiSuggest'
import { aiSuggestService } from '@/services/aiSuggestService'
import { ticketService } from '@/services/ticketService'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toastStore'

const ai = vi.mocked(aiSuggestService)
const createTicket = vi.mocked(ticketService.createTicket)

const SPECIAL_FORM = [{ key: 'motivo', label: 'Motivo', type: 'text', required: true }]
const categories = [
  { id: 'c1', name: 'Infraestrutura', description: 'Rede', subcategories: [] },
  { id: 'c2', name: 'Acessos', description: 'Contas', subcategories: [{ id: 's1', name: 'Novo acesso', is_special: true, special_form_schema: SPECIAL_FORM }] },
]

const suggestion = {
  answer: 'Reinicie o cliente de VPN.\nDepois confirme o usuário.',
  confidence: 0.91,
  sources: [{ articleId: 'a1', title: 'Guia da VPN' }, { articleId: 'a2', title: 'Códigos de erro' }],
  interactionId: 'i1',
}

const CARD = { name: 'A Skadi encontrou uma possível solução' }
const titleField = () => screen.getByPlaceholderText('Ex: Não consigo acessar meu e-mail')
const descriptionField = () => screen.getByPlaceholderText(/Por favor, descreva/)
const card = () => screen.getByRole('region', CARD)
const queryCard = () => screen.queryByRole('region', CARD)
const cardShown = () => screen.findByRole('region', CARD)
const button = (name: string) => screen.getByRole('button', { name })

async function renderWizard() {
  const onBack = vi.fn()
  const onRefresh = vi.fn(async () => {})
  const view = render(<NewTicketWizard categories={categories} org={null} organizations={[]} onBack={onBack} onRefresh={onRefresh} />)
  await act(async () => {})
  return { ...view, onBack, onRefresh }
}

function fillForm() {
  fireEvent.click(screen.getByText('Infraestrutura'))
  fireEvent.change(titleField(), { target: { value: 'VPN não conecta' } })
  fireEvent.change(descriptionField(), { target: { value: 'Erro 809' } })
}

const addFiles = (...names: string[]) => fireEvent.change(document.getElementById('file-up')!, {
  target: { files: names.map(name => new File(['conteudo'], name, { type: 'text/plain' })) },
})

const submit = () => fireEvent.click(button('Enviar solicitação'))

async function openCard(...files: string[]) {
  ai.suggest.mockResolvedValue(suggestion)
  const view = await renderWizard()
  fillForm()
  if (files.length) addFiles(...files)
  submit()
  await cardShown()
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/solicitacoes/nova')
  useAuthStore.setState({ user: null } as any)
  ai.status.mockResolvedValue({ enabled: true, shadow: false })
  ai.suggest.mockResolvedValue(null)
  ai.accept.mockResolvedValue({ id: 't7', displayNumber: 'ISA-7' } as any)
  ai.feedback.mockResolvedValue(undefined)
  createTicket.mockResolvedValue({ id: 't9', displayNumber: 'ISA-9' } as any)
})

afterEach(() => { vi.useRealTimers() })

describe('status da sugestão', () => {
  it('desligado: não chama a IA, não mostra nada e abre o chamado', async () => {
    ai.status.mockResolvedValue({ enabled: false, shadow: false })
    const { onRefresh } = await renderWizard()
    fillForm()
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(ai.suggest).not.toHaveBeenCalled()
    expect(createTicket.mock.calls[0][0]).not.toHaveProperty('aiInteractionId')
  })

  it('falha no status conta como desligado', async () => {
    ai.status.mockRejectedValue(new Error('fora do ar'))
    const { onRefresh } = await renderWizard()
    fillForm()
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(ai.suggest).not.toHaveBeenCalled()
  })

  it('shadow: dispara /suggest sem esperar a resposta e não mostra nada', async () => {
    ai.status.mockResolvedValue({ enabled: false, shadow: true })
    ai.suggest.mockReturnValue(new Promise(() => {}))
    const { onRefresh } = await renderWizard()
    fillForm()
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(ai.suggest).toHaveBeenCalledWith({ title: 'VPN não conecta', description: 'Erro 809', categoryId: 'c1' })
    expect(createTicket).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Procurando uma solução…')).not.toBeInTheDocument()
    expect(queryCard()).not.toBeInTheDocument()
  })

  it('shadow: falha da coleta não vira erro para o usuário', async () => {
    ai.status.mockResolvedValue({ enabled: false, shadow: true })
    ai.suggest.mockRejectedValue(new Error('fora do ar'))
    const { onRefresh } = await renderWizard()
    fillForm()
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('procura da solução', () => {
  it('avisa em região aria-live que já existia antes da procura', async () => {
    ai.suggest.mockReturnValue(new Promise(() => {}))
    await renderWizard()
    fillForm()
    const live = screen.getByRole('status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('')
    submit()
    expect(await screen.findByText('Procurando uma solução…')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Skadi' })).toHaveAttribute('src', '/skadi/skadi-avatar.svg')
    expect(screen.getByRole('status')).toBe(live)
    expect(createTicket).not.toHaveBeenCalled()
  })

  it('sem sugestão: cria direto, sem aiInteractionId', async () => {
    const { onRefresh } = await renderWizard()
    fillForm()
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ title: 'VPN não conecta', description: 'Erro 809', categoryId: 'c1' }))
    expect(createTicket.mock.calls[0][0]).not.toHaveProperty('aiInteractionId')
    expect(queryCard()).not.toBeInTheDocument()
  })

  it('erro na IA: cria direto, sem avisar erro', async () => {
    ai.suggest.mockRejectedValue(new Error('503'))
    const { onRefresh } = await renderWizard()
    fillForm()
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(createTicket).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('tempo esgotado: desiste aos 9 s, cancela o pedido e cria direto', async () => {
    let signal: AbortSignal | undefined
    ai.suggest.mockImplementation((_input, s) => { signal = s; return new Promise(() => {}) })
    await renderWizard()
    fillForm()
    vi.useFakeTimers()
    submit()
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGEST_TIMEOUT_MS - 1) })
    expect(createTicket).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(SUGGEST_TIMEOUT_MS).toBe(9_000)
    expect(createTicket).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('sair do Wizard durante a procura não abre chamado', async () => {
    let finish: (value: null) => void = () => {}
    ai.suggest.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { unmount } = await renderWizard()
    fillForm()
    submit()
    await screen.findByText('Procurando uma solução…')
    unmount()
    await act(async () => { finish(null) })
    expect(createTicket).not.toHaveBeenCalled()
  })

  it('Voltar durante a procura cancela e devolve o formulário preenchido', async () => {
    ai.suggest.mockReturnValue(new Promise(() => {}))
    await renderWizard()
    fillForm()
    submit()
    await screen.findByText('Procurando uma solução…')
    fireEvent.click(button('Voltar'))
    await waitFor(() => expect(titleField()).toHaveValue('VPN não conecta'))
    expect(createTicket).not.toHaveBeenCalled()
    await waitFor(() => expect(button('Enviar solicitação')).toBeEnabled())
  })
})

describe('quem não recebe sugestão', () => {
  const asAgent = () => useAuthStore.setState({ user: { id: 'u1', name: 'Ana', role: 'agent' } } as any)

  it.each([['client'], ['proactive']])('equipe abrindo no modo %s não chama a IA', async mode => {
    asAgent()
    const { onRefresh } = await renderWizard()
    fillForm()
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: mode } })
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(ai.suggest).not.toHaveBeenCalled()
  })

  it('o mesmo vale para a coleta em sombra', async () => {
    asAgent()
    ai.status.mockResolvedValue({ enabled: false, shadow: true })
    const { onRefresh } = await renderWizard()
    fillForm()
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'client' } })
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(ai.suggest).not.toHaveBeenCalled()
  })

  it('equipe abrindo para si mesma recebe a sugestão', async () => {
    asAgent()
    await openCard()
    expect(card()).toBeInTheDocument()
  })

  it('formulário especial não chama a IA', async () => {
    const { onRefresh } = await renderWizard()
    fireEvent.click(screen.getByText('Acessos'))
    fireEvent.click(screen.getByText('Novo acesso'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Entrada na equipe' } })
    submit()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(ai.suggest).not.toHaveBeenCalled()
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ special_data: { motivo: 'Entrada na equipe' } }))
  })
})

describe('card de solução', () => {
  it('mostra a resposta e as fontes pelo título, e recebe o foco', async () => {
    await openCard()
    expect(card()).toHaveTextContent('Reinicie o cliente de VPN.')
    expect(screen.getByText('Guia da VPN')).toBeInTheDocument()
    expect(screen.getByText('Códigos de erro')).toBeInTheDocument()
    expect(card()).toHaveFocus()
    expect(createTicket).not.toHaveBeenCalled()
  })

  it('mostra a resposta como texto, nunca como HTML', async () => {
    ai.suggest.mockResolvedValue({ ...suggestion, answer: '<img src=x onerror=alert(1)> reinicie' })
    await renderWizard()
    fillForm()
    submit()
    await cardShown()
    // A única imagem do card é o rosto da Skadi: nada da resposta vira elemento.
    expect([...card().querySelectorAll('img')].map(i => i.getAttribute('src'))).toEqual(['/skadi/skadi-avatar.svg'])
    expect(card()).toHaveTextContent('<img src=x onerror=alert(1)> reinicie')
  })

  it('aceitar chama /accept com o corpo de criação e leva à tela de sucesso de resolvido', async () => {
    await openCard()
    fireEvent.click(button('Aceitar e Encerrar'))
    expect(await screen.findByText('Chamado resolvido!')).toBeInTheDocument()
    expect(screen.getByText(/continua disponível para consulta/)).toBeInTheDocument()
    expect(ai.accept).toHaveBeenCalledWith('i1', expect.objectContaining({
      title: 'VPN não conecta', description: 'Erro 809', priority: 'medium', categoryId: 'c1', openingSeconds: expect.any(Number),
    }))
    expect(createTicket).not.toHaveBeenCalled()
  })

  it('aceitar com um anexo manda o anexo no corpo e não posta mensagem', async () => {
    await openCard('print.txt')
    fireEvent.click(button('Aceitar e Encerrar'))
    await screen.findByText('Chamado resolvido!')
    expect(ai.accept).toHaveBeenCalledWith('i1', expect.objectContaining({ attachment_url: expect.stringMatching(/^data:/) }))
    expect(ticketService.addMessage).not.toHaveBeenCalled()
  })

  // Mensagem em chamado resolvido reabre o chamado: os extras vão no próprio aceite.
  it('aceitar com vários anexos manda todos no corpo e não posta mensagem', async () => {
    await openCard('a.txt', 'b.txt', 'c.txt')
    expect(screen.queryByText(/deixe só um anexo/)).not.toBeInTheDocument()
    fireEvent.click(button('Aceitar e Encerrar'))
    await screen.findByText('Chamado resolvido!')
    expect(ai.accept).toHaveBeenCalledWith('i1', expect.objectContaining({
      attachment_url: expect.stringMatching(/^data:/),
      extra_attachments: [
        { name: 'b.txt', url: expect.stringMatching(/^data:/) },
        { name: 'c.txt', url: expect.stringMatching(/^data:/) },
      ],
    }))
    expect(ticketService.addMessage).not.toHaveBeenCalled()
  })

  it('anexos grandes demais explicam a saída e mantêm Prosseguir', async () => {
    ai.accept.mockRejectedValue({ response: { status: 413, data: { error: 'Arquivo grande demais: cada anexo pode ter no máximo 10 MB.' } } })
    await openCard('a.txt', 'b.txt')
    fireEvent.click(button('Aceitar e Encerrar'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Os anexos juntos são grandes demais')
    expect(button('Prosseguir com Atendimento Humano')).toBeEnabled()
  })

  it('erro no aceite mostra a mensagem e mantém Prosseguir', async () => {
    ai.accept.mockRejectedValue({ response: { data: { error: 'Sugestão expirada' } } })
    await openCard()
    fireEvent.click(button('Aceitar e Encerrar'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sugestão expirada')
    expect(button('Prosseguir com Atendimento Humano')).toBeEnabled()
    fireEvent.click(button('Prosseguir com Atendimento Humano'))
    await waitFor(() => expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ aiInteractionId: 'i1' })))
  })

  it('prosseguir cria o chamado normal com aiInteractionId e todos os anexos', async () => {
    const { onRefresh } = await openCard('a.txt', 'b.txt')
    fireEvent.click(button('Prosseguir com Atendimento Humano'))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(screen.getByText('Chamado enviado!')).toBeInTheDocument()
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({
      title: 'VPN não conecta', description: 'Erro 809', aiInteractionId: 'i1', attachment_url: expect.stringMatching(/^data:/),
    }))
    expect(ticketService.addMessage).toHaveBeenCalledTimes(1)
    expect(ticketService.addMessage).toHaveBeenCalledWith('t9', 'Anexo adicional: b.txt', 'user', expect.stringMatching(/^data:/))
    expect(ai.accept).not.toHaveBeenCalled()
  })

  it('erro ao prosseguir fica no card para tentar de novo', async () => {
    createTicket.mockRejectedValueOnce({ response: { data: { error: 'Falha ao abrir' } } })
    await openCard()
    fireEvent.click(button('Prosseguir com Atendimento Humano'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao abrir')
    expect(button('Prosseguir com Atendimento Humano')).toBeEnabled()
  })

  it('o tempo de abertura não conta a leitura do card', async () => {
    await openCard()
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_000)
    fireEvent.click(button('Prosseguir com Atendimento Humano'))
    await waitFor(() => expect(createTicket).toHaveBeenCalled())
    later.mockRestore()
    expect(createTicket.mock.calls[0][0].openingSeconds).toBeLessThan(60)
  })

  it('Voltar devolve o formulário com campos e anexos', async () => {
    await openCard('print.txt')
    fireEvent.click(button('Voltar'))
    expect(titleField()).toHaveValue('VPN não conecta')
    expect(descriptionField()).toHaveValue('Erro 809')
    expect(screen.getByText('print.txt')).toBeInTheDocument()
    expect(queryCard()).not.toBeInTheDocument()
  })
})

describe('feedback do card', () => {
  const useful = () => button('Útil')
  const notUseful = () => button('Não útil')

  it('chama a API, marca o escolhido e permite trocar', async () => {
    await openCard()
    fireEvent.click(useful())
    await waitFor(() => expect(ai.feedback).toHaveBeenCalledWith('i1', 'useful'))
    expect(useful()).toHaveAttribute('aria-pressed', 'true')
    expect(notUseful()).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(notUseful())
    await waitFor(() => expect(ai.feedback).toHaveBeenCalledWith('i1', 'not_useful'))
    expect(useful()).toHaveAttribute('aria-pressed', 'false')
    expect(notUseful()).toHaveAttribute('aria-pressed', 'true')
  })

  it('repetir a mesma escolha não reenvia', async () => {
    await openCard()
    fireEvent.click(useful())
    fireEvent.click(useful())
    await waitFor(() => expect(useful()).toHaveAttribute('aria-pressed', 'true'))
    expect(ai.feedback).toHaveBeenCalledTimes(1)
  })

  it('falha no feedback não interrompe nada: desmarca em silêncio e os botões seguem', async () => {
    ai.feedback.mockRejectedValue(new Error('503'))
    await openCard()
    fireEvent.click(useful())
    await waitFor(() => expect(useful()).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
    fireEvent.click(button('Prosseguir com Atendimento Humano'))
    await waitFor(() => expect(createTicket).toHaveBeenCalled())
  })
})
