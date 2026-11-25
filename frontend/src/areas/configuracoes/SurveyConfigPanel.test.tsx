import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SurveyConfigPanel } from './SurveyConfigPanel'
import { surveyService } from '@/services/surveyService'
import { macroService } from '@/services/macroService'
import { useAuthStore } from '@/store/auth'

vi.mock('@/services/surveyService', () => ({
  surveyService: {
    getTemplates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    setActiveTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
  },
}))

vi.mock('@/services/macroService', () => ({
  macroService: {
    getMacros: vi.fn(),
    getVariables: vi.fn(),
    render: vi.fn(),
  },
}))

const mockVariables = [
  { key: 'link_pesquisa', label: 'Link da pesquisa de satisfação', example: 'https://exemplo.com/survey/abc' },
  { key: 'nome_usuario', label: 'Nome do solicitante', example: 'Maria Souza' },
  { key: 'primeiro_nome_usuario', label: 'Primeiro nome do solicitante', example: 'Maria' },
  { key: 'numero_chamado', label: 'Número do chamado', example: 'INC-000123' },
  { key: 'titulo_chamado', label: 'Título do chamado', example: 'Problema no mouse' },
  { key: 'nome_analista', label: 'Analista que aplica a macro', example: 'João Lima' },
  { key: 'link_chamado', label: 'Link do chamado no portal', example: 'https://exemplo.com/portal' },
]

const mockTemplates = [
  {
    id: 'tpl-1',
    nome: 'Pesquisa Padrão',
    assunto_email: 'Pesquisa #{numero_chamado}',
    corpo_convite_auto: 'Avalie pelo link {link_pesquisa}',
    corpo_convite_macro: 'Responda em {link_pesquisa}',
    ativo: true,
    created_at: new Date().toISOString(),
    questions: [],
  },
]

describe('SurveyConfigPanel — Modal de Criação e Painel de Variáveis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      user: { id: 'usr-admin', name: 'Admin', role: 'admin' } as any,
    })
    vi.mocked(surveyService.getTemplates).mockResolvedValue(mockTemplates as any)
    vi.mocked(macroService.getVariables).mockResolvedValue(mockVariables)
    vi.mocked(macroService.render).mockImplementation(async (content: string) => ({
      content: content.replace(/\{(\w+)\}/g, 'EXEMPLO'),
      unknown: [],
    }))
  })

  it('abre modal com layout de duas colunas, abas e painel de variáveis disponíveis', async () => {
    render(<SurveyConfigPanel />)
    const newBtn = await screen.findByRole('button', { name: /Novo modelo/i })
    fireEvent.click(newBtn)

    // Modal aberto
    expect(screen.getByRole('heading', { name: 'Novo modelo de pesquisa' })).toBeTruthy()
    expect(screen.getByText('Variáveis disponíveis')).toBeTruthy()
    expect(screen.getByPlaceholderText('Buscar variável (ex: nome, sla, link)...')).toBeTruthy()

    // Abas de escrita e prévia
    expect(screen.getByRole('button', { name: /Escrever/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pré-visualizar/i })).toBeTruthy()

    // Barra de inserção rápida
    expect(screen.getByText(/Inserir em/i)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /\+ Link pesquisa/i }).length).toBeGreaterThan(0)

    // Categorias
    expect(screen.getByRole('button', { name: /Todas/i })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Solicitante/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Links/i }).length).toBeGreaterThan(0)
  })

  it('permite filtrar variáveis pela busca', async () => {
    render(<SurveyConfigPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Novo modelo/i }))

    const searchInput = screen.getByPlaceholderText('Buscar variável (ex: nome, sla, link)...')
    fireEvent.change(searchInput, { target: { value: 'portal' } })

    expect(screen.getByText('Link do chamado no portal')).toBeTruthy()
    expect(screen.queryByText('Primeiro nome do solicitante')).toBeNull()
  })

  it('insere variável no campo ativo ao clicar no card de variável', async () => {
    render(<SurveyConfigPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Novo modelo/i }))

    // Selecionar destino "Assunto"
    const subjectTargetBtn = screen.getByRole('button', { name: 'Assunto' })
    fireEvent.click(subjectTargetBtn)

    // Clicar em variável do painel lateral
    const varBtn = screen.getByRole('button', { name: /Primeiro nome do solicitante/i })
    fireEvent.click(varBtn)

    const subjectInput = screen.getByPlaceholderText(/Ex: Pesquisa de satisfação: Chamado {numero_chamado}/i) as HTMLInputElement
    expect(subjectInput.value).toContain('{primeiro_nome_usuario}')
  })

  it('alterna para a aba de pré-visualização exibindo simulações de convite e macro', async () => {
    render(<SurveyConfigPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Novo modelo/i }))

    const previewTab = screen.getByRole('button', { name: /Pré-visualizar/i })
    fireEvent.click(previewTab)

    expect(screen.getByText(/E-mail Automático \/ Notificação/i)).toBeTruthy()
    expect(screen.getByText(/Atendente • Chat do Chamado #INC-000123/i)).toBeTruthy()
  })
})
