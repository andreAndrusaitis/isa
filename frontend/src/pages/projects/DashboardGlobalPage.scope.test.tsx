import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardGlobalPage from './DashboardGlobalPage'
import * as svc from '@/services/projectsService'

vi.mock('@/services/projectsService')

const project = (id: string, name: string) => ({
  id, name, description: null, privacy: 'organization', ownerId: 'u', startDate: null, targetDate: null, archivedAt: null,
  totalTasks: 4, doneTasks: 1, openTasks: 3, overdueTasks: 0, progress: 25,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(svc.getDashboardGlobal).mockImplementation(async (scope) => ({ totalTasks: scope === 'mine' ? 4 : 40, byStatus: {}, overdueCount: 0, upcomingCount: 0 }))
  vi.mocked(svc.getTeamWorkload).mockResolvedValue([])
  vi.mocked(svc.listProjects).mockResolvedValue([project('p1', 'Meu Projeto'), project('p2', 'Projeto do Colega')] as any)
  vi.mocked(svc.getMyProjectsReport).mockResolvedValue({ days: 90, projects: [{ id: 'p1', name: 'Meu Projeto', color: null, openTasks: 3, doneTasks: 1, overdueTasks: 0, avgCycleHours: 2, membersCount: 3 }] })
  vi.mocked(svc.getPortfolioInsights).mockRejectedValue(new Error('fora do teste'))
  vi.mocked(svc.getCycleTimeByType).mockResolvedValue({ days: 90, byType: [] })
  vi.mocked(svc.getPortfolioTime).mockResolvedValue({ projects: [], byPerson: [] } as any)
  vi.mocked(svc.listLinkedTickets).mockResolvedValue([])
})

describe('DashboardGlobalPage — lente "Meus projetos"', () => {
  it('abre na lente da equipe, como antes', async () => {
    render(<MemoryRouter><DashboardGlobalPage /></MemoryRouter>)
    expect(await screen.findByText('40')).toBeTruthy()
    expect(svc.getDashboardGlobal).toHaveBeenCalledWith(undefined)
    await waitFor(() => expect(svc.getCycleTimeByType).toHaveBeenCalledWith(90))
    expect(svc.getMyProjectsReport).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Projetos da equipe' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('table', { name: 'Meus projetos' })).toBeNull()
    expect(screen.getAllByText('Projeto do Colega').length).toBeGreaterThan(0)
  })

  it('"Meus projetos" troca os indicadores, o tempo por tipo e a matriz, e mostra a tabela', async () => {
    render(<MemoryRouter><DashboardGlobalPage /></MemoryRouter>)
    await screen.findByText('40')
    fireEvent.click(screen.getByRole('button', { name: 'Meus projetos' }))

    expect(await screen.findByRole('table', { name: 'Meus projetos' })).toBeTruthy()
    expect(svc.getDashboardGlobal).toHaveBeenLastCalledWith('mine')
    await waitFor(() => expect(svc.getCycleTimeByType).toHaveBeenLastCalledWith(90, 'mine'))
    expect(await screen.findByText('0 entregues • 4 ativas')).toBeTruthy()
    expect(screen.queryByText('Projeto do Colega')).toBeNull()
    expect(screen.getAllByText('Meu Projeto').length).toBeGreaterThan(0)
  })
})
