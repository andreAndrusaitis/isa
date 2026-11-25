import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CycleTimeByType } from './CycleTimeByType'
import { getCycleTimeByType } from '@/services/projectsService'

vi.mock('@/services/projectsService', () => ({ getCycleTimeByType: vi.fn() }))

beforeEach(() => {
  vi.mocked(getCycleTimeByType).mockReset()
})

describe('CycleTimeByType', () => {
  it('mostra a média por tipo, a mediana e o total de tasks', async () => {
    vi.mocked(getCycleTimeByType).mockResolvedValue({
      days: 90,
      byType: [
        { type: 'Feature', color: '#2563eb', tasks: 3, avgHours: 4, medianHours: 3.5 },
        { type: 'Bug', color: '#dc2626', tasks: 2, avgHours: 1.5, medianHours: 1.5 },
      ],
    })
    render(<CycleTimeByType />)

    expect((await screen.findAllByText('Feature')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('4 h').length).toBeGreaterThan(0)
    expect(screen.getByText('mediana 3,5 h · 3')).toBeTruthy()
    expect(screen.getByText(/5 task\(s\) concluída\(s\) nos últimos 90 dias/)).toBeTruthy()
    expect(getCycleTimeByType).toHaveBeenCalledWith(90)
  })

  it('troca o período', async () => {
    vi.mocked(getCycleTimeByType).mockResolvedValue({ days: 30, byType: [] })
    render(<CycleTimeByType />)
    fireEvent.click(screen.getByRole('button', { name: '30 dias' }))
    await waitFor(() => expect(getCycleTimeByType).toHaveBeenCalledWith(30))
    expect(await screen.findByText('Nenhuma task concluída no período passou por andamento.')).toBeTruthy()
  })

  it('erro de carga vira mensagem, não tela quebrada', async () => {
    vi.mocked(getCycleTimeByType).mockRejectedValue(new Error('500'))
    render(<CycleTimeByType />)
    expect(await screen.findByText(/Não foi possível carregar o tempo por tipo/)).toBeTruthy()
  })
})
