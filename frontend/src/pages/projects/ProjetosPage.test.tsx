import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProjetosPage from './ProjetosPage'
import { useAuthStore } from '@/store/auth'

vi.mock('@/services/projectsService', async () => {
  const actual = await vi.importActual<typeof import('@/services/projectsService')>('@/services/projectsService')
  return { ...actual, listProjects: vi.fn(async () => []) }
})

function renderPage(user: Record<string, unknown> = { id: 'u1', name: 'Gerente Teste', role: 'manager' }, path = '/projetos') {
  useAuthStore.setState({ user: user as any })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projetos/*" element={<ProjetosPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProjetosPage', () => {
  it('renderiza sidebar com item "Novo projeto" mesmo sem projetos existentes', async () => {
    renderPage()
    expect((await screen.findAllByText(/Novo projeto/i)).length).toBeGreaterThan(0)
  })

  it('mostra o estado vazio do catálogo na rota index', async () => {
    renderPage()
    expect(await screen.findByText(/nenhum projeto/i)).toBeInTheDocument()
  })
})

// Liberações de Projetos: o menu segue as capacidades da sessão, não o cargo.
describe('ProjetosPage — liberações de Projetos', () => {
  const analista = { id: 'a1', name: 'Analista', role: 'agent', capabilities: ['projects.use'] }

  it('analista sem liberação não vê Equipe, Dashboards nem Webhooks e API; Sprints continua', async () => {
    renderPage(analista)
    expect(await screen.findByText('Sprints')).toBeInTheDocument()
    expect(screen.getAllByText('Equipe')).toHaveLength(1) // só o título da seção
    expect(screen.queryByText('Painel')).toBeNull()
    expect(screen.queryByText('Integrações')).toBeNull()
  })

  it('com as liberações concedidas, os itens aparecem', async () => {
    renderPage({ ...analista, capabilities: ['projects.use', 'projects.reports', 'projects.integrations'] })
    expect(await screen.findByText('Painel')).toBeInTheDocument()
    expect(screen.getByText('Integrações')).toBeInTheDocument()
    expect(screen.getAllByText('Equipe')).toHaveLength(2) // seção + item
  })

  it('link direto para Dashboards e Webhooks sem liberação volta ao catálogo', async () => {
    for (const path of ['/projetos/dashboards', '/projetos/webhooks']) {
      const { unmount } = renderPage(analista, path)
      expect(await screen.findByText(/nenhum projeto/i)).toBeInTheDocument()
      unmount()
    }
  })
})
