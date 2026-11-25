import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProjectCatalogPage from './ProjectCatalogPage'
import { Project } from '@/types/projects'

const projects: Project[] = [
  { id: 'p1', name: 'Migração ERP', description: 'Projeto de migração', privacy: 'organization', ownerId: 'u1', startDate: null, targetDate: null, archivedAt: null },
]

describe('ProjectCatalogPage', () => {
  it('lista os projetos existentes como cards', () => {
    render(<MemoryRouter><ProjectCatalogPage projects={projects} onOpenCreate={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('Migração ERP')).toBeInTheDocument()
  })

  it('mostra estado vazio com call-to-action quando não há projetos', () => {
    render(<MemoryRouter><ProjectCatalogPage projects={[]} onOpenCreate={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/nenhum projeto/i)).toBeInTheDocument()
  })

  it('chama onOpenCreate ao clicar em Novo projeto no header', () => {
    const onOpenCreate = vi.fn()
    render(<MemoryRouter><ProjectCatalogPage projects={[]} onOpenCreate={onOpenCreate} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /novo projeto/i }))
    expect(onOpenCreate).toHaveBeenCalled()
  })

  it('enquanto carrega mostra o carregamento, não "Nenhum projeto ainda"', () => {
    render(<MemoryRouter><ProjectCatalogPage projects={[]} loading onOpenCreate={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Carregando projetos…')
    expect(screen.queryByText(/nenhum projeto ainda/i)).not.toBeInTheDocument()
  })

  it('falha da API mostra erro com "Tentar novamente", não estado vazio', () => {
    const onRetry = vi.fn()
    render(<MemoryRouter><ProjectCatalogPage projects={[]} error="Falha de rede." onRetry={onRetry} onOpenCreate={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('Não foi possível carregar os projetos')).toBeInTheDocument()
    expect(screen.queryByText(/nenhum projeto ainda/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(onRetry).toHaveBeenCalled()
  })
})


describe('ProjectCatalogPage — dossiê só com Relatórios de projetos', () => {
  const asUser = async (capabilities: string[]) => {
    const { useAuthStore } = await import('@/store/auth')
    useAuthStore.setState({ user: { id: 'u1', name: 'Pessoa', role: 'agent', capabilities } as any })
  }

  it('Analista sem a liberação não vê "Exportar dossiê"', async () => {
    await asUser(['projects.use'])
    render(<MemoryRouter><ProjectCatalogPage projects={projects} onOpenCreate={vi.fn()} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /exportar dossiê/i })).not.toBeInTheDocument()
  })

  it('com a liberação o botão aparece', async () => {
    await asUser(['projects.use', 'projects.reports'])
    render(<MemoryRouter><ProjectCatalogPage projects={projects} onOpenCreate={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /exportar dossiê/i })).toBeInTheDocument()
  })
})
