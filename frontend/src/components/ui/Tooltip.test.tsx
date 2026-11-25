import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { GlobalTooltip, Tooltip } from './Tooltip'

describe('GlobalTooltip and Tooltip component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders Tooltip wrapper with data-tooltip attribute', () => {
    render(
      <Tooltip content="Informação da Fila">
        <button>Fila</button>
      </Tooltip>
    )
    const button = screen.getByText('Fila')
    const wrapper = button.closest('[data-tooltip]')
    expect(wrapper).toHaveAttribute('data-tooltip', 'Informação da Fila')
  })

  it('GlobalTooltip shows floating tooltip on hover of element with data-tooltip', async () => {
    render(
      <div>
        <GlobalTooltip />
        <button data-tooltip="Diagnóstico inicial" data-tooltip-always="true">
          Diagnostico i...
        </button>
      </div>
    )

    const button = screen.getByText('Diagnostico i...')
    fireEvent.mouseOver(button)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Diagnóstico inicial')

    fireEvent.mouseOut(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('GlobalTooltip intercepts title attribute and renders themed tooltip', async () => {
    render(
      <div>
        <GlobalTooltip />
        <span title="Nova mensagem" data-tooltip-always="true">
          🔔
        </span>
      </div>
    )

    const bell = screen.getByText('🔔')
    fireEvent.mouseOver(bell)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Nova mensagem')
  })

  it('GlobalTooltip keeps a long hint inside the viewport near the right edge (360px)', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.getAttribute('role') === 'tooltip'
        ? { left: 0, right: 300, top: 0, bottom: 40, width: 300, height: 40 }
        : { left: 330, right: 350, top: 10, bottom: 30, width: 20, height: 20 }) as DOMRect
    })

    render(
      <div>
        <GlobalTooltip />
        <button data-tooltip="Admin ISA Interna — texto longo de dica que precisa quebrar linha" data-tooltip-always="true">
          Admin
        </button>
      </div>
    )
    fireEvent.mouseOver(screen.getByText('Admin'))
    act(() => { vi.advanceTimersByTime(200) })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.style.width).toBe('max-content')
    expect(tooltip.style.left).toBe(`${360 - 300 - 8}px`)
    expect(tooltip.style.top).toBe(`${30 + 6}px`)
  })
})
