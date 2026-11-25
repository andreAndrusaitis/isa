import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MyAreaPage from './MyAreaPage'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

const payload = {
  counts: { today: 5, overdue: 2, thisWeek: 13, upcoming: 4, noDueDate: 1, approvals: 1 },
  priorities: [
    { id: 't1', seq: 142, title: 'Implementar autenticação', priority: 'critical', projectId: 'p1', project: { id: 'p1', name: 'Atlas' } },
  ],
  agenda: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${20 + i}`, count: i })),
  recentProjects: [
    { id: 'p1', name: 'Atlas', description: null, targetDate: null, totalTasks: 10, doneTasks: 4, overdueTasks: 2, progress: 40 },
  ],
  recentActivity: [
    {
      id: 'a1', type: 'status_changed', fromValue: null, toValue: null,
      createdAt: '2026-09-19T12:00:00Z',
      actor: { id: 'u1', name: 'João', avatar: null },
      task: { id: 't1', seq: 142, title: 'Implementar autenticação' },
    },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(projectsService.getProjectsActivity).mockResolvedValue([{ date: '2026-10-08', count: 3 }])
  vi.mocked(projectsService.getMyCycle).mockResolvedValue({ days: 90, projects: [], current: [], recent: [] })
})

describe('MyAreaPage', () => {
  it('mostra os contadores de trabalho, prioridades e atividade recente', async () => {
    vi.mocked(projectsService.getMyArea).mockResolvedValue(payload as any)

    render(<MemoryRouter><MyAreaPage /></MemoryRouter>)

    expect(await screen.findByText('Atrasadas')).toBeInTheDocument()
    expect(screen.getByText('Aprovações')).toBeInTheDocument()
    expect(screen.getByText('Implementar autenticação')).toBeInTheDocument()
    expect(screen.getByText(/João/)).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('inclui o meu ciclo por projeto, sem precisar de liberação de relatórios', async () => {
    vi.mocked(projectsService.getMyArea).mockResolvedValue(payload as any)

    render(<MemoryRouter><MyAreaPage /></MemoryRouter>)

    expect(await screen.findByText('Meu ciclo por projeto')).toBeInTheDocument()
    expect(await screen.findByText('Nada seu em andamento agora.')).toBeInTheDocument()
    expect(projectsService.getMyCycle).toHaveBeenCalledWith(90)
  })

  it('mostra o estado de erro com a opção de tentar novamente', async () => {
    vi.mocked(projectsService.getMyArea).mockRejectedValue(new Error('boom'))

    render(<MemoryRouter><MyAreaPage /></MemoryRouter>)

    expect(await screen.findByText('Não foi possível carregar')).toBeInTheDocument()

    // Ao tentar de novo, a página precisa refazer a chamada — sem isso o botão
    // é decorativo e o usuário fica preso no erro.
    vi.mocked(projectsService.getMyArea).mockResolvedValue(payload as any)
    fireEvent.click(screen.getByText('Tentar novamente'))

    expect(await screen.findByText('Implementar autenticação')).toBeInTheDocument()
  })
})
