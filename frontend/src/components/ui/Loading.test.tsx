import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Loading } from './Loading'
import { PageLoader } from './PageLoader'

describe('Loading', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('mostra o texto padrão e o da tela', () => {
    const { rerender } = render(<Loading />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
    rerender(<Loading label="Carregando sprints…" />)
    expect(screen.getByText('Carregando sprints…')).toBeInTheDocument()
  })

  it('é uma região de status ocupada, sem repetir a marca para o leitor de tela', () => {
    render(<Loading label="Carregando chamados…" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Carregando chamados…')
    expect(screen.queryByRole('img', { name: 'ISA' })).not.toBeInTheDocument()
    expect(status.querySelector('svg')).toBeInTheDocument()
  })

  it('só aparece depois de 200 ms, com o texto já no DOM', () => {
    render(<Loading label="Carregando projetos…" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('data-visible', 'false')
    expect(status).toHaveTextContent('Carregando projetos…')
    act(() => { vi.advanceTimersByTime(199) })
    expect(status).toHaveAttribute('data-visible', 'false')
    act(() => { vi.advanceTimersByTime(1) })
    expect(status).toHaveAttribute('data-visible', 'true')
  })

  it('desmontar antes do atraso não deixa o timer pendente', () => {
    const { unmount } = render(<Loading />)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('page traz a marca maior e a barra; compact só a marca menor', () => {
    const { rerender, container } = render(<Loading />)
    expect(screen.getByRole('status')).toHaveAttribute('data-size', 'page')
    expect(container.querySelector('svg')).toHaveAttribute('width', '44')
    expect(container.querySelector('.loading-bar-track')).toBeInTheDocument()

    rerender(<Loading size="compact" />)
    expect(screen.getByRole('status')).toHaveAttribute('data-size', 'compact')
    expect(container.querySelector('svg')).toHaveAttribute('width', '26')
    expect(container.querySelector('.loading-bar-track')).not.toBeInTheDocument()
  })
})

describe('PageLoader', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('usa a mesma marca em tela cheia, fora da árvore, depois de 300 ms', () => {
    const { container } = render(<PageLoader label="Verificando acesso…" />)
    const status = screen.getByRole('status')
    expect(container).toBeEmptyDOMElement()
    expect(status.parentElement).toBe(document.body)
    expect(status).toHaveClass('app-loading', 'page-loader')
    expect(status).toHaveTextContent('Verificando acesso…')
    act(() => { vi.advanceTimersByTime(299) })
    expect(status).toHaveAttribute('data-visible', 'false')
    act(() => { vi.advanceTimersByTime(1) })
    expect(status).toHaveAttribute('data-visible', 'true')
  })
})
