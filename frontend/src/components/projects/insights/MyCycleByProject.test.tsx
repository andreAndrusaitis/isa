import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MyCycleByProject } from './MyCycleByProject'
import { getMyCycle } from '@/services/projectsService'

vi.mock('@/services/projectsService', () => ({ getMyCycle: vi.fn() }))

const renderIt = () => render(<MemoryRouter><MyCycleByProject /></MemoryRouter>)

beforeEach(() => {
  vi.mocked(getMyCycle).mockReset()
})

describe('MyCycleByProject (Minha área)', () => {
  it('mostra o ciclo médio por projeto, o que está em andamento e as últimas entregas', async () => {
    vi.mocked(getMyCycle).mockResolvedValue({
      days: 90,
      projects: [
        { projectId: 'p1', name: 'Atlas', color: '#2563eb', done: 3, avgCycleHours: 6, medianCycleHours: 4.5, open: 2, inProgress: 1 },
        { projectId: 'p2', name: 'Portal', color: null, done: 0, avgCycleHours: null, medianCycleHours: null, open: 1, inProgress: 0 },
      ],
      current: [{ taskId: 't9', projectId: 'p1', key: 'FEAT-9', seq: 9, title: 'Tela de login', projectName: 'Atlas', statusName: 'Em andamento', startedAt: '2026-10-30T13:00:00Z', hoursSoFar: 12.5 }],
      recent: [
        { taskId: 't1', projectId: 'p1', key: null, seq: 1, title: 'Ajustar e-mail', projectName: 'Atlas', startedAt: '2026-10-01T13:00:00Z', completedAt: '2026-10-02T13:00:00Z', cycleHours: 9 },
        { taskId: 't2', projectId: 'p1', key: 'BUG-2', seq: 2, title: 'Corrigir filtro', projectName: 'Atlas', startedAt: null, completedAt: '2026-10-03T13:00:00Z', cycleHours: null },
      ],
    })
    renderIt()

    expect(await screen.findByText('mediana 4,5 h · 3')).toBeTruthy()
    expect(screen.getAllByText('6 h').length).toBeGreaterThan(0)
    expect(screen.queryByText('Portal')).toBeNull() // sem conclusão medida, não vira barra
    expect(screen.getByText(/3 concluída\(s\) nos últimos 90 dias/)).toBeTruthy()
    expect(screen.getByText('Tela de login')).toBeTruthy()
    expect(screen.getByText('12,5 h úteis')).toBeTruthy()
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('9 h')).toBeTruthy()
    expect(screen.getByTitle('Concluída sem passar por andamento').textContent).toBe('—')
    expect(getMyCycle).toHaveBeenCalledWith(90)
  })

  it('sem nada no período: mensagens em português, e troca de período', async () => {
    vi.mocked(getMyCycle).mockResolvedValue({ days: 30, projects: [], current: [], recent: [] })
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: '30 dias' }))
    await waitFor(() => expect(getMyCycle).toHaveBeenCalledWith(30))
    expect(await screen.findByText('Nenhuma task sua concluída neste período passou por andamento.')).toBeTruthy()
    expect(screen.getByText('Nada seu em andamento agora.')).toBeTruthy()
    expect(screen.getByText('Você não concluiu tasks nos últimos 30 dias.')).toBeTruthy()
  })

  it('erro de carga vira mensagem', async () => {
    vi.mocked(getMyCycle).mockRejectedValue(new Error('500'))
    renderIt()
    expect(await screen.findByText(/Não foi possível carregar o seu ciclo/)).toBeTruthy()
  })
})
