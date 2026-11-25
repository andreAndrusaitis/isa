import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AiTriageDashboard, fmtMinutes } from './AiTriageDashboard'
import { aiService } from '@/services/aiService'

vi.mock('@/services/aiService', () => ({ aiService: { getInsights: vi.fn() } }))
vi.mock('@/services/adminService', () => ({ adminService: { getCategories: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Rede' }]) } }))

const data = {
  period: { from: '2026-09-08', to: '2026-10-07' }, tickets: 120, triaged: 100, automatic: 60, manual: 40, automatic_rate: 0.6,
  reclassified: 6, reclassification_rate: 0.1,
  accuracy: [
    { field: 'type', total: 20, correct: 18, rate: 0.9 }, { field: 'category', total: 0, correct: 0, rate: 0 },
    { field: 'subcategory', total: 10, correct: 5, rate: 0.5 }, { field: 'priority', total: 10, correct: 7, rate: 0.7 },
  ],
  time_to_assign: { triaged: { count: 100, median_minutes: 80, p90_minutes: 240 }, not_triaged: { count: 20, median_minutes: null, p90_minutes: null } },
  intake: { incomplete: 8, complemented: 5 }, guidance: { deflected: 3, linked: 2 }, empty: false,
}
const orgs = [{ id: 'o1', name: 'Acme' }]

describe('AiTriageDashboard', () => {
  beforeEach(() => { vi.mocked(aiService.getInsights).mockReset().mockResolvedValue(data as any) })

  it('mostra KPIs, acurácia e tempo até a atribuição', async () => {
    render(<AiTriageDashboard orgs={orgs} />)
    expect(await screen.findByText('de 120 chamados')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getByText('5 complementados')).toBeInTheDocument()
    expect(screen.getByText('2 vinculados a duplicado')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Acurácia da IA por campo' })).toHaveTextContent('90%')
    expect(screen.getByRole('table', { name: 'Tempo até a atribuição com e sem triagem IA' })).toHaveTextContent('1h 20min')
    expect(screen.getByRole('table', { name: 'Tempo até a atribuição com e sem triagem IA' })).toHaveTextContent('4h')
  })

  it('filtra por empresa e categoria', async () => {
    render(<AiTriageDashboard orgs={orgs} />)
    await screen.findByText('de 120 chamados')
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'o1' } })
    await waitFor(() => expect(aiService.getInsights).toHaveBeenLastCalledWith(expect.objectContaining({ org_id: 'o1' })))
    fireEvent.change(await screen.findByLabelText('Categoria'), { target: { value: 'c1' } })
    await waitFor(() => expect(aiService.getInsights).toHaveBeenLastCalledWith(expect.objectContaining({ org_id: 'o1', category_id: 'c1' })))
  })

  it('estado vazio quando não há chamados', async () => {
    vi.mocked(aiService.getInsights).mockResolvedValue({ ...data, empty: true } as any)
    render(<AiTriageDashboard orgs={orgs} />)
    expect(await screen.findByText('Nenhum chamado no período')).toBeInTheDocument()
    expect(screen.queryByText('Chamados triados')).not.toBeInTheDocument()
  })

  it('erro com nova tentativa', async () => {
    vi.mocked(aiService.getInsights).mockRejectedValueOnce(new Error('x'))
    render(<AiTriageDashboard orgs={orgs} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar')
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(await screen.findByText('de 120 chamados')).toBeInTheDocument()
  })

  it('400 mostra a mensagem do backend', async () => {
    vi.mocked(aiService.getInsights).mockRejectedValueOnce({ response: { status: 400, data: { error: 'Data inválida', code: 'INVALID_DATE' } } })
    render(<AiTriageDashboard orgs={orgs} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Data inválida')
  })

  it('formata minutos', () => {
    expect(fmtMinutes(null)).toBe('—')
    expect(fmtMinutes(45)).toBe('45 min')
    expect(fmtMinutes(80)).toBe('1h 20min')
  })
})
