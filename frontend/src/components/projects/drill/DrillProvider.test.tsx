import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { DrillProvider } from './DrillProvider'
import { useDrill } from './drillContext'
import { ClickableRow, DrillLink } from './drillUi'
import * as service from '@/services/drillService'

vi.mock('@/services/drillService', () => ({
  getProjectDrill: vi.fn(),
  getPersonDrill: vi.fn(),
  getTaskDrill: vi.fn(),
  getTaskListDrill: vi.fn(),
}))
vi.mock('@/components/charts/TimeSeriesChart', () => ({ TimeSeriesChart: () => null }))

const row = { taskId: 't1', projectId: 'p1', projectName: 'Atlas', projectColor: null, key: 'BUG-7', seq: 7, title: 'Corrigir login', status: { name: 'Backlog', color: '#999', category: 'open' }, priority: 'high', dueDate: '2026-11-01T12:00:00Z', assignee: { id: 'u1', name: 'Ana' }, overdue: true, activeMinutes: 90, running: false, startedAt: null, completedAt: null, cycleHours: null }

const project = {
  project: { id: 'p1', name: 'Atlas', description: 'Portal', color: null, privacy: 'organization', startDate: null, targetDate: null, owner: { id: 'u0', name: 'Dono' } },
  totals: { total: 5, open: 3, done: 2, cancelled: 0, overdue: 1, upcoming: 0, running: 0, pendingApprovals: 0, progress: 40, activeMinutes: 120, linkedTickets: 0, avgCycleHours: 4, medianCycleHours: 3 },
  sprint: null, byStatus: [{ statusId: 's1', name: 'Backlog', color: '#999', count: 3 }], byPriority: { high: 3 }, weekly: [],
  people: [{ userId: 'u1', name: 'Ana', avatar: null, open: 3, overdue: 1, running: 0, done: 2 }],
  overdue: [row], upcoming: [], running: [], milestones: [], recentActivity: [],
}

const task = {
  id: 't1', projectId: 'p1', project: { id: 'p1', name: 'Atlas' }, key: 'BUG-7', seq: 7, title: 'Corrigir login', description: null, priority: 'high',
  status: { id: 's1', name: 'Backlog', category: 'open', color: '#999' }, taskType: null, list: null, sprint: null, parent: null,
  assignees: [{ id: 'u1', name: 'Ana' }], creator: { id: 'u0', name: 'Dono' }, createdAt: '2026-10-01T12:00:00Z', startDate: null, dueDate: null,
  isMilestone: false, storyPoints: null, archivedAt: null, tags: [], checklist: [], subtasks: [], blockedBy: [], blocks: [], tickets: [], documents: [], commentsCount: 0, comments: [],
  time: null, timeline: [{ id: 'e1', type: 'status_changed', createdAt: '2026-11-03T14:32:00', actor: { id: 'u1', name: 'André' }, from: 'Em Andamento', to: 'QA' }],
}

function Page() {
  const { open } = useDrill()
  const { pathname } = useLocation()
  return (
    <>
      <span data-testid="path">{pathname}</span>
      <table><tbody>
        <ClickableRow onOpen={() => open({ kind: 'project', projectId: 'p1', title: 'Atlas' })}>
          <td><DrillLink onClick={() => open({ kind: 'project', projectId: 'p1', title: 'Atlas' })}>Atlas</DrillLink></td>
          <td>30%</td>
          <td><button type="button">Outra ação</button></td>
        </ClickableRow>
      </tbody></table>
    </>
  )
}

const renderIt = () => render(<MemoryRouter initialEntries={['/projetos/dashboards']}><DrillProvider><Page /></DrillProvider></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(service.getProjectDrill).mockResolvedValue(project as never)
  vi.mocked(service.getTaskDrill).mockResolvedValue(task as never)
})

describe('modal de detalhe', () => {
  it('clicar em qualquer ponto da linha abre o projeto; outro botão da linha, não', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Outra ação' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByText('30%'))
    const dialog = await screen.findByRole('dialog', { name: 'Atlas' })
    expect(await within(dialog).findByText('Horas no projeto')).toBeTruthy()
    expect(service.getProjectDrill).toHaveBeenCalledWith('p1')
  })

  it('navega do projeto até a task e volta pelo mesmo caminho', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Atlas' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: /Atenção/ }))
    fireEvent.click(await within(dialog).findByRole('button', { name: /BUG-7/ }))

    expect(await screen.findByRole('dialog', { name: 'BUG-7 Corrigir login' })).toBeTruthy()
    await waitFor(() => expect(service.getTaskDrill).toHaveBeenCalledWith('p1', 't1'))
    expect((await screen.findByText(/moveu de/)).textContent).toContain('Em Andamento')

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('dialog', { name: 'Atlas' })).toBeTruthy()
  })

  it('o rodapé leva à tela completa e fecha o modal', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Atlas' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Visão geral' }))
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/projetos/p1/overview'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sem acesso, explica e deixa tentar de novo', async () => {
    vi.mocked(service.getProjectDrill).mockRejectedValueOnce(new Error('403'))
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Atlas' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Horas no projeto')).toBeTruthy()
  })
})
