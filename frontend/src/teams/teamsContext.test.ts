import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getContext: vi.fn(),
  openLink: vi.fn(),
}))

vi.mock('@microsoft/teams-js', () => ({
  app: { initialize: mocks.initialize, getContext: mocks.getContext, openLink: mocks.openLink },
}))

import { getTeamsContext, isTeamsHost, openInTeams, resetTeamsContext, useInTeams } from './teamsContext'

const teamsContext = { app: { theme: 'dark' }, page: { id: 'isa-home', subPageId: '' } }

function setFramed(framed: boolean) {
  Object.defineProperty(window, 'top', { configurable: true, value: framed ? {} : window })
}

describe('teamsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    setFramed(false)
    resetTeamsContext()
  })
  afterEach(() => setFramed(false))

  it('fora do Teams não carrega o SDK e mantém o layout normal', async () => {
    await expect(getTeamsContext()).resolves.toBeNull()
    expect(mocks.initialize).not.toHaveBeenCalled()
    expect(isTeamsHost()).toBe(false)
    expect(document.documentElement.hasAttribute('data-host')).toBe(false)
    await expect(openInTeams('https://blob.example/a.pdf')).resolves.toBe(false)
  })

  it('dentro do Teams inicializa uma vez e marca o anfitrião', async () => {
    setFramed(true)
    mocks.initialize.mockResolvedValue(undefined)
    mocks.getContext.mockResolvedValue(teamsContext)
    const { result } = renderHook(() => useInTeams())
    expect(result.current).toBe(false)

    await act(async () => {
      await expect(getTeamsContext()).resolves.toBe(teamsContext)
      await getTeamsContext()
    })

    expect(mocks.initialize).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
    expect(document.documentElement.getAttribute('data-host')).toBe('teams')
  })

  it('o ?teams=1 do contentUrl liga o modo Teams antes do SDK responder', () => {
    window.history.replaceState(null, '', '/?teams=1')
    resetTeamsContext()
    window.history.replaceState(null, '', '/chamados')
    resetTeamsContext()
    expect(isTeamsHost()).toBe(true)
  })

  it('se o Teams não responder, volta ao modo navegador e esquece o ?teams=1', async () => {
    window.history.replaceState(null, '', '/?teams=1')
    resetTeamsContext()
    mocks.initialize.mockRejectedValue(new Error('no host'))

    await expect(getTeamsContext()).resolves.toBeNull()

    expect(isTeamsHost()).toBe(false)
    expect(sessionStorage.getItem('isa-teams')).toBeNull()
  })

  it('abre links pelo Teams com endereço absoluto', async () => {
    setFramed(true)
    mocks.initialize.mockResolvedValue(undefined)
    mocks.getContext.mockResolvedValue(teamsContext)
    mocks.openLink.mockResolvedValue(undefined)
    await getTeamsContext()

    await expect(openInTeams('/api/files/1')).resolves.toBe(true)
    expect(mocks.openLink).toHaveBeenCalledWith(`${window.location.origin}/api/files/1`)
  })
})
