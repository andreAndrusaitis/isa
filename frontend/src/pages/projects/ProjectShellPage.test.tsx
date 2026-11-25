import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectShellPage from './ProjectShellPage'
import * as projectsService from '@/services/projectsService'
import * as tasksService from '@/services/tasksService'
import { useAuthStore } from '@/store/auth'

vi.mock('@/services/projectsService')
vi.mock('@/services/tasksService')

describe('ProjectShellPage', () => {
  it('mostra a barra de abas e navega entre Tasks e Membros', async () => {
    useAuthStore.setState({ user: { id: 'u1', name: 'Atual', role: 'manager' } as any })
    vi.mocked(projectsService.getProject).mockResolvedValue({ id: 'p1', name: 'Projeto X', members: [] } as any)
    vi.mocked(projectsService.listFolders).mockResolvedValue([])
    vi.mocked(projectsService.listLists).mockResolvedValue([])
    vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([])
    vi.mocked(projectsService.listMembers).mockResolvedValue([])
    vi.mocked(projectsService.listSprints).mockResolvedValue([])
    vi.mocked(projectsService.listTaskTypes).mockResolvedValue([])
    vi.mocked(projectsService.listTags).mockResolvedValue([])
    vi.mocked(tasksService.listTasks).mockResolvedValue([])

    render(
      <MemoryRouter initialEntries={['/projetos/p1/tasks']}>
        <Routes><Route path="/projetos/:projectId/*" element={<ProjectShellPage />} /></Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Visão geral')).toBeInTheDocument()

    // Todas as telas do projeto ficam à mostra; Board/Lista/Calendário/Gantt/Timeline
    // são modos dentro de Tasks, não abas próprias.
    fireEvent.click(screen.getByText('Membros'))
    expect(await screen.findByText(/pessoa\(s\) neste projeto/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Membros' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('ProjectShellPage — carga do projeto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 'u1', name: 'Atual', role: 'manager' } as any })
    vi.mocked(projectsService.listFolders).mockResolvedValue([])
    vi.mocked(projectsService.listLists).mockResolvedValue([])
    vi.mocked(projectsService.listMembers).mockResolvedValue([])
  })

  function renderShell(path = '/projetos/p1/members') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/projetos/:projectId/*" element={<ProjectShellPage />} /></Routes>
      </MemoryRouter>
    )
  }

  it('só 404 vira "Projeto não encontrado"', async () => {
    vi.mocked(projectsService.getProject).mockRejectedValue({ response: { status: 404 } })
    renderShell()
    expect(await screen.findByText('Projeto não encontrado')).toBeInTheDocument()
  })

  it('outros erros mostram "Tentar novamente" e recarregam', async () => {
    vi.mocked(projectsService.getProject)
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ id: 'p1', name: 'Projeto X', members: [] } as any)
    renderShell()
    expect(await screen.findByText('Não foi possível carregar o projeto')).toBeInTheDocument()
    expect(screen.queryByText('Projeto não encontrado')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByText('Projeto X')).toBeInTheDocument()
  })

  it('itens do painel "Listas" filtram as tasks pela lista', async () => {
    vi.mocked(projectsService.getProject).mockResolvedValue({ id: 'p1', name: 'Projeto X', members: [] } as any)
    vi.mocked(projectsService.listLists).mockResolvedValue([{ id: 'l1', name: 'Backlog', folderId: null }] as any)
    vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([])
    vi.mocked(projectsService.listMembers).mockResolvedValue([])
    vi.mocked(projectsService.listSprints).mockResolvedValue([])
    vi.mocked(projectsService.listTaskTypes).mockResolvedValue([])
    vi.mocked(projectsService.listTags).mockResolvedValue([])
    vi.mocked(tasksService.listTasks).mockResolvedValue([])
    renderShell('/projetos/p1/tasks')
    fireEvent.click(await screen.findByRole('button', { name: 'Backlog' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Backlog' })).toHaveAttribute('aria-pressed', 'true'))
    expect(await screen.findByText(/Lista: Backlog/)).toBeInTheDocument()
  })
})
