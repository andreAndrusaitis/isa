import { describe, it, expect } from 'vitest'
import { niceTicks, linePath, nearestIndex, placeTooltip, linear, chartTone, CHART_COLORS } from './chartUtils'

describe('kit de gráficos — funções puras', () => {
  it('niceTicks arredonda o topo e gera marcas regulares', () => {
    expect(niceTicks(87)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] })
    expect(niceTicks(0).max).toBe(1)
    expect(Math.max(...niceTicks(7).ticks)).toBeGreaterThanOrEqual(7)
  })

  it('linePath liga os pontos em linha reta', () => {
    expect(linePath([{ x: 0, y: 100 }, { x: 10, y: 50 }])).toBe('M0,100L10,50')
    expect(linePath([])).toBe('')
  })

  it('chartTone usa a cor informada ou a da paleta', () => {
    expect(chartTone('var(--danger)')).toBe('var(--danger)')
    expect(chartTone('var(--text-3)', 2)).toBe('var(--text-3)')
    expect(chartTone('#ff00aa', 1)).toBe('#ff00aa')
    expect(chartTone(undefined, 1)).toBe(CHART_COLORS[1])
  })

  it('nearestIndex e linear', () => {
    expect(nearestIndex([0, 10, 20, 30], 14)).toBe(1)
    expect(nearestIndex([0, 10, 20, 30], 26)).toBe(3)
    expect(linear(0, 10, 0, 100)(5)).toBe(50)
  })

  it('placeTooltip vira para a esquerda perto da borda e não sai do contêiner', () => {
    const box = { w: 400, h: 200 }, size = { w: 120, h: 60 }
    expect(placeTooltip({ x: 50, y: 100 }, size, box)).toEqual({ left: 62, top: 70 })
    expect(placeTooltip({ x: 380, y: 100 }, size, box).left).toBe(380 - 12 - 120)
    expect(placeTooltip({ x: 380, y: 5 }, size, box).top).toBe(0)
    expect(placeTooltip({ x: 380, y: 199 }, size, box).top).toBe(140)
  })
})
