import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { getGlobalSprintOverview, listGlobalSprints, listSprintOwners } from '@/services/projectsService'
import SprintsPanelPage from './SprintsPanelPage'

vi.mock('@/services/projectsService', () => ({
  listSprintOwners: vi.fn(),
  listGlobalSprints: vi.fn(),
  getGlobalSprintOverview: vi.fn(),
  globalSprintApi: vi.fn(),
}))
vi.mock('@/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'u1', role: 'admin', capabilities: [] } }),
}))
vi.mock('@/components/projects/drill/drillContext', () => ({ useDrill: () => ({ open: vi.fn() }) }))

const owner = { id: 'u1', name: 'Gerente' }
const sprint = { id: 's1', name: 'Sprint 1', startDate: null, endDate: null, status: 'active' }

function renderPage() {
  return render(<MemoryRouter initialEntries={['/projetos/sprints']}><SprintsPanelPage /></MemoryRouter>)
}

describe('SprintsPanelPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('enquanto a lista carrega mostra o carregamento, não "Nenhum sprint para mostrar"', async () => {
    vi.mocked(listSprintOwners).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Carregando sprints…')
    expect(screen.queryByText('Nenhum sprint para mostrar')).not.toBeInTheDocument()
  })

  it('calendário sem sprints termina no estado vazio', async () => {
    vi.mocked(listSprintOwners).mockResolvedValue([owner] as never)
    vi.mocked(listGlobalSprints).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('Nenhum sprint para mostrar')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('sem calendários também sai do carregamento', async () => {
    vi.mocked(listSprintOwners).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('Nenhum sprint para mostrar')).toBeInTheDocument()
  })

  it('segue carregando, sem piscar o vazio, até a visão geral da sprint padrão chegar', async () => {
    vi.mocked(listSprintOwners).mockResolvedValue([owner] as never)
    vi.mocked(listGlobalSprints).mockResolvedValue([sprint] as never)
    vi.mocked(getGlobalSprintOverview).mockReturnValue(new Promise(() => {}))
    renderPage()
    await waitFor(() => expect(getGlobalSprintOverview).toHaveBeenCalledWith('s1'))
    expect(screen.getByRole('status')).toHaveTextContent('Carregando sprints…')
    expect(screen.queryByText('Nenhum sprint para mostrar')).not.toBeInTheDocument()
  })
})
