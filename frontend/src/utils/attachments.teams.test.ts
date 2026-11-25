import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ inTeams: false, openInTeams: vi.fn() }))

vi.mock('@/teams/teamsContext', () => ({
  isTeamsHost: () => mocks.inTeams,
  openInTeams: mocks.openInTeams,
}))

import { downloadAttachment, openAttachment } from './attachments'

const url = 'https://isa.blob.core.windows.net/anexos/relatorio.pdf?sv=1&sig=x'

describe('anexos dentro do Teams', () => {
  const fetchMock = vi.fn()
  const openMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.inTeams = false
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'open').mockImplementation(openMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('no Teams o download sai pelo app.openLink, sem fetch no iframe', async () => {
    mocks.inTeams = true
    mocks.openInTeams.mockResolvedValue(true)

    await downloadAttachment(url, 'relatorio.pdf')

    expect(mocks.openInTeams).toHaveBeenCalledWith(url)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no Teams o "Ver" também abre pelo Teams', async () => {
    mocks.inTeams = true
    mocks.openInTeams.mockResolvedValue(true)

    openAttachment(url)
    await Promise.resolve()

    expect(mocks.openInTeams).toHaveBeenCalledWith(url)
    expect(openMock).not.toHaveBeenCalled()
  })

  it('se o Teams recusar, volta ao caminho do navegador', async () => {
    mocks.inTeams = true
    mocks.openInTeams.mockResolvedValue(false)

    openAttachment(url)
    await vi.waitFor(() => expect(openMock).toHaveBeenCalledWith(url, '_blank', 'noopener'))
  })

  it('no navegador nada muda: baixa por fetch e abre nova aba direto', async () => {
    fetchMock.mockResolvedValue({ blob: async () => new Blob(['x']) })
    URL.createObjectURL = vi.fn(() => 'blob:local')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadAttachment(url, 'relatorio.pdf')
    openAttachment(url)

    expect(mocks.openInTeams).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(url)
    expect(click).toHaveBeenCalled()
    expect(openMock).toHaveBeenCalledWith(url, '_blank', 'noopener')
  })
})
