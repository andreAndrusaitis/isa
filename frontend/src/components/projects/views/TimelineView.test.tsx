import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimelineView } from './TimelineView'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

const status = { id: 's1', name: 'Em Progresso', color: '#3b82f6', category: 'in_progress' as const }

const timeline = {
  tasks: [
    {
      id: 't1', seq: 1, key: 'EPIC-1', title: 'Fase de análise', startDate: '2026-09-01T00:00:00Z',
      dueDate: '2026-09-10T00:00:00Z', isMilestone: false, parentId: null,
      priority: 'normal' as const, progress: 50, status, assignee: null,
    },
    {
      id: 't2', seq: 2, title: 'Release v2.0', startDate: null,
      dueDate: '2026-09-20T00:00:00Z', isMilestone: true, parentId: null,
      priority: 'high' as const, progress: 0, status, assignee: null,
    },
    {
      id: 't3', seq: 3, title: 'Subtarefa', startDate: '2026-09-02T00:00:00Z',
      dueDate: '2026-09-05T00:00:00Z', isMilestone: false, parentId: 't1',
      priority: 'low' as const, progress: 0, status, assignee: null,
    },
  ],
  dependencies: [{ id: 'd1', taskId: 't2', dependsOnId: 't1' }],
}

beforeEach(() => vi.resetAllMocks())

describe('TimelineView', () => {
  it('desenha as tasks datadas, incluindo subtasks, no modo Gantt', async () => {
    vi.mocked(projectsService.getProjectTimeline).mockResolvedValue(timeline as any)

    render(<TimelineView projectId="p1" mode="gantt" onOpenTask={() => {}} />)

    expect(await screen.findByText('Fase de análise')).toBeInTheDocument()
    expect(screen.getByText('Release v2.0')).toBeInTheDocument()
    expect(screen.getByText('Subtarefa')).toBeInTheDocument()
  })

  it('Timeline é a visão executiva: só pontos de controle e épicos', async () => {
    vi.mocked(projectsService.getProjectTimeline).mockResolvedValue(timeline as any)

    render(<TimelineView projectId="p1" mode="timeline" onOpenTask={() => {}} />)

    expect(await screen.findByText('Fase de análise')).toBeInTheDocument() // EPIC-1
    expect(screen.getByText('Release v2.0')).toBeInTheDocument() // ponto de controle
    expect(screen.queryByText('Subtarefa')).not.toBeInTheDocument()
  })

  it('esconde concluídas por padrão e mostra quando pedido', async () => {
    const done = { id: 's9', name: 'Concluído', color: '#16a34a', category: 'done' as const }
    vi.mocked(projectsService.getProjectTimeline).mockResolvedValue({
      ...timeline,
      tasks: [...timeline.tasks, { ...timeline.tasks[2], id: 't4', seq: 4, parentId: null, title: 'Entregue', status: done }],
    } as any)

    render(<TimelineView projectId="p1" mode="gantt" onOpenTask={() => {}} />)

    expect(await screen.findByText('Subtarefa')).toBeInTheDocument()
    expect(screen.queryByText('Entregue')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/mostrar concluídas \(1\)/i))
    expect(screen.getByText('Entregue')).toBeInTheDocument()
  })

  it('mostra o estado vazio quando nenhuma task tem data', async () => {
    vi.mocked(projectsService.getProjectTimeline).mockResolvedValue({ tasks: [], dependencies: [] } as any)

    render(<TimelineView projectId="p1" mode="gantt" onOpenTask={() => {}} />)

    expect(await screen.findByText('Nenhuma task com datas')).toBeInTheDocument()
  })

  it('chama onOpenTask ao clicar no nome de uma task', async () => {
    vi.mocked(projectsService.getProjectTimeline).mockResolvedValue(timeline as any)
    const onOpenTask = vi.fn()

    render(<TimelineView projectId="p1" mode="gantt" onOpenTask={onOpenTask} />)
    fireEvent.click(await screen.findByText('Fase de análise'))

    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })
})

describe('escala do Gantt com datas fora da curva', () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`)
  it('task começando em 2001 não estica o eixo por décadas', async () => {
    const { timelineWindow } = await import('./TimelineView')
    const w = timelineWindow([{ start: d('2001-07-10'), end: d('2026-10-12') }, { start: d('2026-10-01'), end: d('2026-10-20') }])
    expect(w.clipped).toBe(true)
    expect(w.min.getTime()).toBe(d('2026-10-12').getTime() - 180 * 86_400_000)
    expect(w.max.getTime()).toBe(d('2026-10-20').getTime())
  })
  it('projeto normal não corta nada', async () => {
    const { timelineWindow } = await import('./TimelineView')
    const w = timelineWindow([{ start: d('2026-09-01'), end: d('2026-10-01') }, { start: d('2026-10-02'), end: d('2026-12-01') }])
    expect(w).toMatchObject({ clipped: false, min: d('2026-09-01'), max: d('2026-12-01') })
  })
  it('zoom automático e marcas mensais', async () => {
    const { autoZoom, axisTicks } = await import('./TimelineView')
    expect([autoZoom(30), autoZoom(120), autoZoom(400)]).toEqual(['day', 'week', 'month'])
    const ticks = axisTicks(new Date(2026, 0, 1), 89, 'month')
    expect(ticks.map((t) => t.label)).toEqual(['jan/26', 'fev/26', 'mar/26'])
  })
})
