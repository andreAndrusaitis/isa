import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimeSeriesChart } from './TimeSeriesChart'
import { CalendarHeatmap } from './CalendarHeatmap'

const data = [
  { x: '2026-10-01', hours: 4, done: 1 },
  { x: '2026-10-02', hours: 6, done: 0 },
  { x: '2026-10-03', hours: 2, done: 3 },
]

describe('TimeSeriesChart', () => {
  it('teclado percorre os pontos e o tooltip mostra os valores, inclusive a série só de tooltip e o evento', () => {
    const { container } = render(<TimeSeriesChart ariaLabel="Horas" data={data}
      events={[{ x: '2026-10-03', label: 'EPIC-1 concluído', detail: 'Plataforma' }]}
      series={[{ key: 'hours', label: 'Horas', color: '#000', type: 'bar' }, { key: 'done', label: 'Concluídas', color: '#0f0', tooltipOnly: true }]} />)
    const svg = screen.getByRole('img', { name: 'Horas' })
    fireEvent.keyDown(svg, { key: 'End' })
    const tip = () => container.querySelector('[role=status]') as HTMLElement
    expect(tip().textContent).toContain('Horas2')
    expect(tip().textContent).toContain('Concluídas3')
    expect(tip().textContent).toContain('EPIC-1 concluído')
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(tip().textContent).toContain('Horas6')
    fireEvent.keyDown(svg, { key: 'Escape' })
    expect(tip().style.opacity).toBe('0')
  })

  it('série tracejada não normaliza o comprimento do traço, que senão cobriria a linha inteira', () => {
    const { container } = render(<TimeSeriesChart ariaLabel="Tracejado" data={data} series={[
      { key: 'hours', label: 'Horas', color: '#111' },
      { key: 'done', label: 'Feitas', color: '#222', type: 'line', dashed: true },
    ]} />)
    const dashed = container.querySelector('path[stroke="#222"]')!
    expect(dashed).toHaveAttribute('stroke-dasharray', '5 5')
    expect(dashed).not.toHaveAttribute('pathLength')
    expect(container.querySelector('path[stroke="#111"]')).toHaveAttribute('pathLength', '1')
  })

  it('sem valores mostra o estado vazio', () => {
    render(<TimeSeriesChart ariaLabel="Vazio" data={[{ x: '2026-10-01', v: 0 }]} series={[{ key: 'v', label: 'V', color: '#000' }]} emptyText="Nada aqui" />)
    expect(screen.getByText('Nada aqui')).toBeTruthy()
  })
})

describe('CalendarHeatmap', () => {
  it('mapa de calor soma o período', () => {
    const today = new Date().toLocaleDateString('en-CA')
    render(<CalendarHeatmap ariaLabel="Atividade" days={[{ date: today, count: 5 }]} />)
    expect(screen.getByText('5 atividades em 53 semanas')).toBeTruthy()
  })
})
