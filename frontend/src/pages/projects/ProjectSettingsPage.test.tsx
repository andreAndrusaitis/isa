import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectSettingsPage from './ProjectSettingsPage'
import * as projectsService from '@/services/projectsService'
import { toast } from '@/store/toastStore'
import { ProjectRoleProvider } from '@/components/projects/projectRole'

vi.mock('@/services/projectsService')
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

function renderSettings(role?: 'owner' | 'manager' | 'member' | 'viewer') {
  return render(
    <MemoryRouter initialEntries={['/projetos/p1/settings']}>
      <ProjectRoleProvider value={role}>
        <Routes>
          <Route path="/projetos/:projectId/settings" element={<ProjectSettingsPage />} />
          <Route path="/projetos" element={<div>Lista de projetos</div>} />
        </Routes>
      </ProjectRoleProvider>
    </MemoryRouter>
  )
}

const project = { id: 'p1', name: 'Projeto X', description: 'desc', privacy: 'organization', ownerId: 'u1', startDate: null, targetDate: null, archivedAt: null }

describe('ProjectSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(projectsService.getProject).mockResolvedValue(project as any)
    vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([])
    vi.mocked(projectsService.listTags).mockResolvedValue([])
    vi.mocked(projectsService.listTaskTypes).mockResolvedValue([])
    vi.mocked(projectsService.listSprints).mockResolvedValue([])
    vi.mocked(projectsService.listSprintOwners).mockResolvedValue([])
  })

  it('renderiza a seção de Sprints com o SprintManager', async () => {
    vi.mocked(projectsService.listSprints).mockResolvedValue([
      { id: 'sp-1', projectId: 'p1', name: 'Sprint 1', status: 'planned', startDate: null, endDate: null, position: 0 },
    ])
    render(
      <MemoryRouter initialEntries={['/projetos/p1/settings']}>
        <Routes><Route path="/projetos/:projectId/settings" element={<ProjectSettingsPage />} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('Sprints')).toBeInTheDocument()
    expect(await screen.findByText('Sprint 1')).toBeInTheDocument()
  })

  it('renderiza a seção de Tipos de tarefa com o TaskTypeManager', async () => {
    vi.mocked(projectsService.listTaskTypes).mockResolvedValue([
      { id: 'tt-1', projectId: 'p1', name: 'Story', icon: 'BookmarkCheck', color: '#16a34a', position: 0, prefix: 'US', nextNumber: 1 },
    ])
    render(
      <MemoryRouter initialEntries={['/projetos/p1/settings']}>
        <Routes><Route path="/projetos/:projectId/settings" element={<ProjectSettingsPage />} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('Tipos de tarefa')).toBeInTheDocument()
    expect(await screen.findByText('Story')).toBeInTheDocument()
  })

  it('salva alterações de nome via updateProject', async () => {
    vi.mocked(projectsService.updateProject).mockResolvedValue({ ...project, name: 'Novo Nome' } as any)
    render(
      <MemoryRouter initialEntries={['/projetos/p1/settings']}>
        <Routes><Route path="/projetos/:projectId/settings" element={<ProjectSettingsPage />} /></Routes>
      </MemoryRouter>
    )
    const input = await screen.findByDisplayValue('Projeto X')
    fireEvent.change(input, { target: { value: 'Novo Nome' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(projectsService.updateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Novo Nome' })))
  })

  it('arquiva o projeto após confirmação', async () => {
    vi.mocked(projectsService.archiveProject).mockResolvedValue(undefined)
    render(
      <MemoryRouter initialEntries={['/projetos/p1/settings']}>
        <Routes><Route path="/projetos/:projectId/settings" element={<ProjectSettingsPage />} /></Routes>
      </MemoryRouter>
    )
    await screen.findByDisplayValue('Projeto X')
    fireEvent.click(screen.getByRole('button', { name: /arquivar projeto/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    await waitFor(() => expect(projectsService.archiveProject).toHaveBeenCalledWith('p1'))
  })

  it('erro ao salvar mostra toast com a mensagem do backend', async () => {
    vi.mocked(projectsService.updateProject).mockRejectedValue({ response: { data: { error: 'Nome já usado.' } } })
    renderSettings()
    await screen.findByDisplayValue('Projeto X')
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nome já usado.'))
    expect(screen.queryByText(/salvo com sucesso/i)).not.toBeInTheDocument()
  })

  it('salva datas de início e alvo ao meio-dia UTC', async () => {
    vi.mocked(projectsService.getProject).mockResolvedValue({ ...project, startDate: '2026-11-01T12:00:00.000Z' } as any)
    vi.mocked(projectsService.updateProject).mockResolvedValue(project as any)
    renderSettings()
    expect(await screen.findByLabelText('Data de início')).toHaveValue('2026-11-01')
    fireEvent.change(screen.getByLabelText('Data alvo'), { target: { value: '2026-12-15' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(projectsService.updateProject).toHaveBeenCalledWith('p1', expect.objectContaining({
      startDate: '2026-11-01T12:00:00.000Z', targetDate: '2026-12-15T12:00:00.000Z',
    })))
  })

  it('falha ao carregar mostra erro com "Tentar novamente"', async () => {
    vi.mocked(projectsService.getProject).mockRejectedValueOnce(new Error('rede'))
    renderSettings()
    expect(await screen.findByText('Não foi possível carregar')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByDisplayValue('Projeto X')).toBeInTheDocument()
  })

  it('erro ao arquivar mostra toast e não sai da página', async () => {
    vi.mocked(projectsService.archiveProject).mockRejectedValue({ response: { data: { error: 'Sem permissão.' } } })
    const onChanged = vi.fn()
    window.addEventListener('projects:changed', onChanged)
    renderSettings()
    await screen.findByDisplayValue('Projeto X')
    fireEvent.click(screen.getByRole('button', { name: /arquivar projeto/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Sem permissão.'))
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.queryByText('Lista de projetos')).not.toBeInTheDocument()
    window.removeEventListener('projects:changed', onChanged)
  })

  it('arquivar com sucesso avisa a lista (projects:changed) e volta para /projetos', async () => {
    vi.mocked(projectsService.archiveProject).mockResolvedValue(undefined)
    const onChanged = vi.fn()
    window.addEventListener('projects:changed', onChanged)
    renderSettings()
    await screen.findByDisplayValue('Projeto X')
    fireEvent.click(screen.getByRole('button', { name: /arquivar projeto/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(await screen.findByText('Lista de projetos')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect((onChanged.mock.calls[0][0] as CustomEvent).detail).toEqual({ projectId: 'p1' })
    window.removeEventListener('projects:changed', onChanged)
  })

  it('membro vê o fluxo de status sem alças de arrastar', async () => {
    vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([
      { id: 's1', projectId: 'p1', name: 'Fazendo', color: '#888', category: 'in_progress', position: 0, isActive: true, requiresApproval: false },
    ] as any)
    renderSettings('member')
    expect(await screen.findByText('Fazendo')).toBeInTheDocument()
    expect(screen.queryByLabelText('Arrastar Fazendo')).not.toBeInTheDocument()
  })
})

