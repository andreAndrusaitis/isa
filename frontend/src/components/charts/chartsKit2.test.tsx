import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimeSeriesChart } from './TimeSeriesChart'
import { BarList } from './BarList'
import { FunnelBars } from './FunnelBars'
import { HeatmapGrid } from './HeatmapGrid'
import { NestedBars } from './NestedBars'
import { AxisBars } from './AxisBars'

describe('kit de gráficos — componentes de distribuição', () => {
  it('TimeSeriesChart: Enter no ponto ativo dispara o drill-down', () => {
    const onSelect = vi.fn()
    render(<TimeSeriesChart ariaLabel="Volume" onSelect={onSelect} data={[{ x: '2026-10-01', n: 1 }, { x: '2026-10-02', n: 3 }]} series={[{ key: 'n', label: 'N', color: '#000' }]} />)
    const svg = screen.getByRole('img', { name: 'Volume' })
    fireEvent.keyDown(svg, { key: 'End' })
    fireEvent.keyDown(svg, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('BarList: mostra valor e participação e a linha vira botão com onSelect', () => {
    const onSelect = vi.fn()
    render(<BarList ariaLabel="Filas" showShare onSelect={onSelect} items={[{ id: 'a', label: 'Infra', value: 3 }, { id: 'b', label: 'Apps', value: 1 }]} />)
    expect(screen.getByRole('button', { name: /Infra.*3.*75%/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Apps/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  it('FunnelBars: conversão entre etapas e % sobre o início', () => {
    render(<FunnelBars ariaLabel="Funil" steps={[{ id: 'a', label: 'Chamados', value: 200 }, { id: 'b', label: 'Triados', value: 150 }]} />)
    expect(screen.getByText(/75% seguem/)).toBeInTheDocument()
    expect(screen.getAllByText('75% do início')[0]).toBeVisible()
  })

  it('HeatmapGrid: tabela acessível com a matriz e o tooltip da célula em foco', () => {
    const { container } = render(<HeatmapGrid ariaLabel="Demanda" rows={['Seg', 'Ter']} cols={['0h', '1h']} values={[[0, 4], [2, 1]]} />)
    expect(screen.getByRole('table', { name: 'Demanda' })).toHaveTextContent('Seg04')
    fireEvent.focus(container.querySelector('[data-cell="0-1"]')!)
    expect((container.querySelector('[role=status]') as HTMLElement).textContent).toContain('4 chamados')
  })

  it('NestedBars: clicar numa fatia com filhos entra nela (trilha mostra o caminho)', () => {
    render(<NestedBars ariaLabel="Empresas" rootLabel="Todas" data={[
      { id: 'acme', label: 'Acme', children: [{ id: 'q1', label: 'Infra', value: 3 }, { id: 'q2', label: 'Apps', value: 1 }] },
      { id: 'glob', label: 'Globex', value: 2 },
    ]} />)
    fireEvent.click(screen.getByLabelText('Acme: 4'))
    expect(screen.getByRole('button', { name: 'Todas' })).toBeInTheDocument()
    expect(screen.getByLabelText('Infra: 3')).toBeInTheDocument()
    expect(screen.queryByLabelText('Globex: 2')).not.toBeInTheDocument()
  })

  it('AxisBars: eixo sem dado aparece como "—" na tabela acessível', () => {
    render(<AxisBars ariaLabel="Acurácia" axes={[{ id: 'a', label: 'Tipo', value: 0.9 }, { id: 'b', label: 'Categoria', value: 0.5 }, { id: 'c', label: 'Prioridade', value: null }]} />)
    expect(screen.getByRole('table', { name: 'Acurácia' })).toHaveTextContent('Tipo90%Categoria50%Prioridade—')
  })
})
