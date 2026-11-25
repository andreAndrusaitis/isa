import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTeamsContext: vi.fn(),
  registerOnThemeChangeHandler: vi.fn(),
  applyTeamsTheme: vi.fn(),
}))

vi.mock('./teamsContext', () => ({ getTeamsContext: mocks.getTeamsContext }))
vi.mock('./teamsTheme', () => ({ applyTeamsTheme: mocks.applyTeamsTheme }))
vi.mock('@microsoft/teams-js', () => ({
  app: { registerOnThemeChangeHandler: mocks.registerOnThemeChangeHandler },
}))

import { TeamsBridge, resetTeamsBridge } from './TeamsBridge'
import { teamsTicketDeepLink, ticketPathFromSubEntity } from './deepLink'

function Where() {
  const location = useLocation()
  return <div data-testid="path">{location.pathname}</div>
}

function renderBridge(start = '/') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <TeamsBridge />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  )
}

describe('link profundo do Teams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTeamsBridge()
  })

  it('monta o link profundo da aba com o chamado no subEntityId', () => {
    const link = teamsTicketDeepLink('INC-2026-000123')
    expect(link).toBe(
      'https://teams.microsoft.com/l/entity/00000000-0000-0000-0000-000000000000/isa-home?context='
      + encodeURIComponent('{"subEntityId":"INC-2026-000123"}'),
    )
    const context = JSON.parse(new URL(link).searchParams.get('context')!)
    expect(context).toEqual({ subEntityId: 'INC-2026-000123' })
  })

  it('só aceita ids de chamado no subEntityId', () => {
    expect(ticketPathFromSubEntity(' INC-1 ')).toBe('/c/INC-1')
    expect(ticketPathFromSubEntity('')).toBeNull()
    expect(ticketPathFromSubEntity(undefined)).toBeNull()
    expect(ticketPathFromSubEntity('../admin')).toBeNull()
  })

  it('abre o chamado do subEntityId e segue o tema do Teams', async () => {
    mocks.getTeamsContext.mockResolvedValue({ app: { theme: 'contrast' }, page: { subPageId: 'INC-42' } })
    renderBridge('/')

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/c/INC-42'))
    expect(mocks.applyTeamsTheme).toHaveBeenCalledWith('contrast')

    const onThemeChange = mocks.registerOnThemeChangeHandler.mock.calls[0][0]
    onThemeChange('dark')
    expect(mocks.applyTeamsTheme).toHaveBeenLastCalledWith('dark', true)
  })

  it('o subEntityId só vale na abertura da aba', async () => {
    mocks.getTeamsContext.mockResolvedValue({ app: { theme: 'default' }, page: { subPageId: 'INC-42' } })
    const first = renderBridge('/')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/c/INC-42'))
    first.unmount()

    renderBridge('/chamados')
    await waitFor(() => expect(mocks.applyTeamsTheme).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('path')).toHaveTextContent('/chamados')
  })

  it('fora do Teams não navega nem mexe no tema', async () => {
    mocks.getTeamsContext.mockResolvedValue(null)
    renderBridge('/chamados')
    await waitFor(() => expect(mocks.getTeamsContext).toHaveBeenCalled())
    expect(screen.getByTestId('path')).toHaveTextContent('/chamados')
    expect(mocks.applyTeamsTheme).not.toHaveBeenCalled()
  })
})
