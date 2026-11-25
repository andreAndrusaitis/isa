import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { OverviewDashboard } from './OverviewDashboard'
import { dashboardService } from '@/services/dashboardService'

vi.mock('@/services/dashboardService', () => ({ dashboardService: { getOverview: vi.fn(), getSlaExpiring: vi.fn().mockResolvedValue({ tickets: [] }) } }))
vi.mock('@/services/adminService', () => ({ adminService: { getOrganizations: vi.fn().mockResolvedValue([]), getQueues: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/services/ticketService', () => ({ ticketService: { getTicketsPage: vi.fn() } }))

const overview = {
  counts: { open: 3, in_progress: 1, pending: 0, resolved: 8, ai_resolved: 6, closed: 2 },
  timeSeries: [{ date: '2026-11', count: 14, aiResolved: 6, tickets: [] }],
  priorityDist: [], queueDist: [], demand: { days: 90, total: 0, matrix: Array.from({ length: 7 }, () => Array(24).fill(0)) },
}

const card = async (label: string) => (await screen.findAllByText(label))[0].parentElement!

describe('OverviewDashboard: total separado', () => {
  beforeEach(() => { vi.mocked(dashboardService.getOverview).mockReset().mockResolvedValue(overview as any) })

  it('"Resolvidos pela Skadi" é um número próprio, ao lado de "Resolvido", e a porcentagem usa o total sem duplicar', async () => {
    render(<OverviewDashboard onNavigate={vi.fn()} />)
    const ai = await card('Resolvidos pela Skadi')
    const team = await card('Resolvido')
    expect(within(ai).getByText('6')).toBeInTheDocument()
    expect(within(ai).getByText('30% do total')).toBeInTheDocument()
    expect(within(team).getByText('8')).toBeInTheDocument()
    expect(within(team).getByText('40% do total')).toBeInTheDocument()
    expect(team.nextElementSibling).toBe(ai)
  })

  it.each([
    ['Resolvidos pela Skadi', 'ai_resolved'],
    ['Resolvido', 'team_resolved'],
    ['Fechado', 'team_closed'],
    ['Aberto', 'open'],
  ])('número %s abre a lista com o mesmo recorte', async (label, status) => {
    const onNavigate = vi.fn()
    render(<OverviewDashboard onNavigate={onNavigate} />)
    fireEvent.click((await screen.findAllByText(label))[0])
    expect(onNavigate).toHaveBeenCalledWith({ view: 'queue_all', filters: { status } })
  })

  it('a série mostra a equipe e a IA separadas', async () => {
    render(<OverviewDashboard />)
    const table = await screen.findByRole('table', { name: 'Chamados abertos por período' })
    expect(table).toHaveTextContent('Resolvidos pela Skadi')
    expect(table).toHaveTextContent('14')
    expect(table).toHaveTextContent('6')
  })
})
