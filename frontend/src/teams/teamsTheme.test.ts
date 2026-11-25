import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTheme } from '@/components/ui'
import { applyTeamsTheme, mapTeamsTheme } from './teamsTheme'

describe('tema do Teams', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-contrast')
  })

  it.each([
    ['default', { theme: 'light', highContrast: false }],
    ['dark', { theme: 'dark', highContrast: false }],
    ['contrast', { theme: 'dark', highContrast: true }],
    [undefined, { theme: 'light', highContrast: false }],
  ])('%s → %o', (teams, expected) => {
    expect(mapTeamsTheme(teams)).toEqual(expected)
  })

  it('o tema do Teams vence o salvo no navegador e acompanha a troca', () => {
    localStorage.setItem('isa-theme', 'light')
    applyTeamsTheme('dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    act(() => applyTeamsTheme('default'))
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    act(() => result.current.toggle())
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('isa-theme')).toBe('light')
  })

  it('alto contraste usa o escuro com bordas e foco reforçados', () => {
    applyTeamsTheme('contrast')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-contrast')).toBe('more')

    applyTeamsTheme('dark')
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false)
  })
})
