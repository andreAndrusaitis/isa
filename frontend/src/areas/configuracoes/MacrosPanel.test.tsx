import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MacrosPanel } from './MacrosPanel'
import { macroService } from '@/services/macroService'

vi.mock('@/services/macroService', () => ({
  macroService: {
    getMacros: vi.fn(),
    getVariables: vi.fn(),
    render: vi.fn(),
    createMacro: vi.fn(),
    updateMacro: vi.fn(),
    deleteMacro: vi.fn(),
  },
}))

const mockVariables = [
  { key: 'nome_usuario', label: 'Nome do solicitante', example: 'Maria Souza' },
  { key: 'primeiro_nome_usuario', label: 'Primeiro nome do solicitante', example: 'Maria' },
  { key: 'numero_chamado', label: 'Número do chamado', example: 'INC-000123' },
  { key: 'link_chamado', label: 'Link do chamado no portal', example: 'https://exemplo.com' },
]

const mockMacros = [
  { id: '1', title: 'Boas-vindas', content: 'Olá {primeiro_nome_usuario}!', active: true },
]

describe('MacrosPanel — Modal e Layout de Variáveis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(macroService.getMacros).mockResolvedValue(mockMacros as any)
    vi.mocked(macroService.getVariables).mockResolvedValue(mockVariables)
    vi.mocked(macroService.render).mockResolvedValue({ content: 'Olá Maria!', unknown: [] })
  })

  it('abre modal com layout aprimorado, abas e painel de variáveis', async () => {
    render(<MacrosPanel />)
    const newBtn = await screen.findByRole('button', { name: /Nova resposta/i })
    fireEvent.click(newBtn)

    // Modal aberto
    expect(screen.getByRole('heading', { name: 'Nova resposta' })).toBeTruthy()
    expect(screen.getByText('Variáveis disponíveis')).toBeTruthy()
    expect(screen.getByPlaceholderText('Buscar variável (ex: nome, sla, link)...')).toBeTruthy()

    // Abas de escrita e prévia
    expect(screen.getByRole('button', { name: /Escrever/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pré-visualizar/i })).toBeTruthy()

    // Categorias
    expect(screen.getByRole('button', { name: /Todas/i })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Solicitante/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Chamado/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Links/i })).toBeTruthy()
  })

  it('permite filtrar variáveis pela barra de busca', async () => {
    render(<MacrosPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Nova resposta/i }))

    const searchInput = screen.getByPlaceholderText('Buscar variável (ex: nome, sla, link)...')
    fireEvent.change(searchInput, { target: { value: 'portal' } })

    expect(screen.getByText('Link do chamado no portal')).toBeTruthy()
    expect(screen.queryByText('Primeiro nome do solicitante')).toBeNull()
  })

  it('insere variável no cursor do textarea ao clicar no card da variável', async () => {
    render(<MacrosPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Nova resposta/i }))

    const varBtn = screen.getByRole('button', { name: /Primeiro nome do solicitante/i })
    fireEvent.click(varBtn)

    const textarea = screen.getByPlaceholderText(/Ex: Olá {primeiro_nome_usuario}/i) as HTMLTextAreaElement
    expect(textarea.value).toContain('{primeiro_nome_usuario}')
  })

  it('alterna para aba de pré-visualização exibindo simulação', async () => {
    render(<MacrosPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Nova resposta/i }))

    const previewTab = screen.getByRole('button', { name: /Pré-visualizar/i })
    fireEvent.click(previewTab)

    expect(screen.getByText(/Atendente • Simulação/i)).toBeTruthy()
    expect(screen.getAllByText(/#INC-000123/i).length).toBeGreaterThan(0)
  })
})
