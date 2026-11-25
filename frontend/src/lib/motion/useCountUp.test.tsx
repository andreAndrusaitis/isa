import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render } from '@testing-library/react'
import type { RefObject } from 'react'

// anime.js mockado — não queremos rAF real no jsdom
vi.mock('animejs', () => ({
  animate: vi.fn(() => ({ revert: vi.fn() })),
}))

import { animate } from 'animejs'
import { useCountUp } from './useCountUp'

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

function Counter({ value }: { value: number }) {
  const ref = useCountUp(value, { format: (n) => `${n}%` })
  return <span data-testid="v" ref={ref as RefObject<HTMLSpanElement>} />
}

beforeEach(() => {
  ;(animate as unknown as Mock).mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCountUp', () => {
  it('escreve o valor final imediatamente sob reduced-motion (sem animar)', () => {
    mockMatchMedia(true)
    const { getByTestId } = render(<Counter value={100} />)
    expect(getByTestId('v').textContent).toBe('100%')
    expect(animate).not.toHaveBeenCalled()
  })

  it('dispara a animação quando o movimento é permitido', () => {
    mockMatchMedia(false)
    render(<Counter value={42} />)
    expect(animate).toHaveBeenCalledTimes(1)
  })
})
