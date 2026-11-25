import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectMcpTokensPage from './ProjectMcpTokensPage'
import * as mcpTokensService from '@/services/mcpTokens'

vi.mock('@/services/mcpTokens')

const token = {
  id: 't1', name: 'Claude Desktop', tokenPrefix: 'mcp_abcd', active: true,
  createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projetos/mcp-tokens']}>
      <Routes><Route path="/projetos/mcp-tokens" element={<ProjectMcpTokensPage />} /></Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProjectMcpTokensPage', () => {
  it('mostra estado vazio quando não há tokens', async () => {
    vi.mocked(mcpTokensService.listMcpTokens).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('Nenhum token gerado')).toBeInTheDocument()
  })

  it('gera um token e mostra o valor bruto uma única vez', async () => {
    vi.mocked(mcpTokensService.listMcpTokens).mockResolvedValueOnce([]).mockResolvedValueOnce([token] as any)
    vi.mocked(mcpTokensService.createMcpToken).mockResolvedValue({ ...token, token: 'mcp_abcd1234secretvalue' } as any)

    renderPage()
    await screen.findByText('Nenhum token gerado')

    fireEvent.change(screen.getByPlaceholderText(/Claude Desktop/i), { target: { value: 'Claude Desktop' } })
    fireEvent.click(screen.getByRole('button', { name: /gerar token/i }))

    await waitFor(() => expect(mcpTokensService.createMcpToken).toHaveBeenCalledWith('Claude Desktop'))
    expect(await screen.findByText('mcp_abcd1234secretvalue')).toBeInTheDocument()
  })

  it('lista tokens existentes e revoga um após confirmação', async () => {
    vi.mocked(mcpTokensService.listMcpTokens).mockResolvedValue([token] as any)
    vi.mocked(mcpTokensService.revokeMcpToken).mockResolvedValue(undefined)

    renderPage()
    await screen.findByText('Claude Desktop')

    fireEvent.click(screen.getByRole('button', { name: /revogar/i }))

    const buttons = await screen.findAllByRole('button', { name: /^revogar$/i })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(mcpTokensService.revokeMcpToken).toHaveBeenCalledWith('t1'))
  })

  it('mostra erro com opção de tentar novamente quando a listagem falha', async () => {
    vi.mocked(mcpTokensService.listMcpTokens).mockRejectedValue(new Error('network error'))

    renderPage()

    expect(await screen.findByText('Não foi possível carregar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument()
  })

  it('mostra mensagem de erro se a revogação falhar, sem remover o token da lista', async () => {
    vi.mocked(mcpTokensService.listMcpTokens).mockResolvedValue([token] as any)
    vi.mocked(mcpTokensService.revokeMcpToken).mockRejectedValue(new Error('boom'))

    renderPage()
    await screen.findByText('Claude Desktop')

    fireEvent.click(screen.getByRole('button', { name: /revogar/i }))
    const buttons = await screen.findAllByRole('button', { name: /^revogar$/i })
    fireEvent.click(buttons[buttons.length - 1])

    expect(await screen.findByText(/não foi possível revogar/i)).toBeInTheDocument()
    // o token continua listado, já que a revogação não foi concluída
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument()
  })
})
