import { describe, it, expect, vi, afterEach } from 'vitest'
import { prefersReducedMotion } from './reducedMotion'

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefersReducedMotion', () => {
  it('retorna true quando o usuário pede menos movimento', () => {
    mockMatchMedia(true)
    expect(prefersReducedMotion()).toBe(true)
  })

  it('retorna false quando o usuário não pede', () => {
    mockMatchMedia(false)
    expect(prefersReducedMotion()).toBe(false)
  })

  it('retorna false quando matchMedia não existe', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
