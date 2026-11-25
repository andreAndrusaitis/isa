import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KnowledgeMetricsDashboard } from './KnowledgeMetricsDashboard'
import { aiService } from '@/services/aiService'

vi.mock('@/services/aiService', () => ({ aiService: { getKnowledgeMetrics: vi.fn() } }))

const data = {
  period: { from: '2026-10-07', to: '2026-11-05' },
  resolution: { ai_resolved: 12, team_opened: 28, rate: 0.3, target: 0.35 },
  feedback: { useful: 8, not_useful: 2, rate: 0.8 },
  interactions: { total: 50, answered: 40, bucket: 'day', series: [{ date: '2026-11-04', count: 20 }, { date: '2026-11-05', count: 30 }] },
  top_articles: [{ article_id: 'a1', title: 'Reset de senha', uses: 9 }, { article_id: 'a2', title: 'Manual da VPN', uses: 4 }],
  empty: false,
}
const orgs = [{ id: 'o1', name: 'Acme' }]

describe('KnowledgeMetricsDashboard', () => {
  beforeEach(() => { vi.mocked(aiService.getKnowledgeMetrics).mockReset().mockResolvedValue(data as any) })

  it('mostra a taxa contra a meta e a fórmula com os números do período', async () => {
    render(<KnowledgeMetricsDashboard orgs={orgs} />)
    const meter = await screen.findByRole('meter', { name: 'Chamados resolvidos pela Skadi' })
    expect(meter).toHaveAttribute('aria-valuenow', '30')
    expect(meter).toHaveAttribute('aria-valuetext', '30%, meta de 35%')
    expect(screen.getByText('Faltam 5 pontos para a meta de 35%')).toBeInTheDocument()
    expect(screen.getByText(/12 ÷ \(12 \+ 28\) = 30%/)).toBeInTheDocument()
  })

  it('meta alcançada', async () => {
    vi.mocked(aiService.getKnowledgeMetrics).mockResolvedValue({ ...data, resolution: { ...data.resolution, ai_resolved: 20, team_opened: 20, rate: 0.5 } } as any)
    render(<KnowledgeMetricsDashboard orgs={orgs} />)
    expect(await screen.findByText('Meta de 35% atingida')).toBeInTheDocument()
  })

  it('mostra feedback, interações, artigos e a série', async () => {
    render(<KnowledgeMetricsDashboard orgs={orgs} />)
    expect(await screen.findByText('8 de 10 avaliações')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('40 com resposta')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Artigos mais usados' })).toHaveTextContent('Reset de senha')
    expect(screen.getByRole('table', { name: 'Interações por período' })).toHaveTextContent('30')
  })

  it('sem avaliações nem chamados, a taxa fica em branco em vez de virar 0%', async () => {
    vi.mocked(aiService.getKnowledgeMetrics).mockResolvedValue({
      ...data, resolution: { ...data.resolution, ai_resolved: 0, team_opened: 0, rate: null }, feedback: { useful: 0, not_useful: 0, rate: null },
    } as any)
    render(<KnowledgeMetricsDashboard orgs={orgs} />)
    expect(await screen.findByText('Meta: 35%')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('filtra por período e empresa', async () => {
    render(<KnowledgeMetricsDashboard orgs={orgs} />)
    await screen.findByRole('meter')
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(aiService.getKnowledgeMetrics).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01' })))
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'o1' } })
    await waitFor(() => expect(aiService.getKnowledgeMetrics).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01', org_id: 'o1' })))
  })

  it('estado vazio', async () => {
    vi.mocked(aiService.getKnowledgeMetrics).mockResolvedValue({ ...data, empty: true } as any)
    render(<KnowledgeMetricsDashboard orgs={orgs} />)
    expect(await screen.findByText('Nada no período')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('erro com nova tentativa; 400 mostra a mensagem do backend', async () => {
    vi.mocked(aiService.getKnowledgeMetrics).mockRejectedValueOnce(new Error('x'))
    const { unmount } = render(<KnowledgeMetricsDashboard orgs={orgs} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar')
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(await screen.findByRole('meter')).toBeInTheDocument()
    unmount()

    vi.mocked(aiService.getKnowledgeMetrics).mockRejectedValueOnce({ response: { status: 400, data: { error: 'Data inválida', code: 'INVALID_DATE' } } })
    render(<KnowledgeMetricsDashboard orgs={orgs} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Data inválida')
  })
})
