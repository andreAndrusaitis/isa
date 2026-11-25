import { describe, expect, it, vi, beforeEach } from 'vitest'

const teams = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  getContext: vi.fn(async () => ({ app: { theme: 'default' }, page: {} })),
  submit: vi.fn(),
}))
vi.mock('@microsoft/teams-js', () => ({
  app: { initialize: teams.initialize, getContext: teams.getContext },
  dialog: { url: { submit: teams.submit } },
}))

import { readDialogMode, sanitizeDialogText, submitDialog, DIALOG_TITLE_MAX } from './dialog'
import { resetTeamsContext } from './teamsContext'

function at(url: string) {
  sessionStorage.clear()
  window.history.replaceState(null, '', url)
  resetTeamsContext()
}

beforeEach(() => {
  vi.clearAllMocks()
  teams.getContext.mockResolvedValue({ app: { theme: 'default' }, page: {} } as any)
})

describe('sanitizeDialogText', () => {
  it('tira tags e caracteres de controle, normaliza quebras e limita', () => {
    expect(sanitizeDialogText('  <b>Impressora</b>\u0007 parada\r\nlinha 2 ', 100)).toBe('Impressora parada\nlinha 2')
    expect(sanitizeDialogText('<script>alert(1)</script>ok', 100)).toBe('alert(1)ok')
    expect(sanitizeDialogText('x'.repeat(500), DIALOG_TITLE_MAX)).toHaveLength(DIALOG_TITLE_MAX)
    expect(sanitizeDialogText(null, 10)).toBe('')
  })
})

describe('readDialogMode', () => {
  it('no Teams com ?dialog=1 devolve título e descrição da URL', () => {
    at('/solicitacoes/nova?teams=1&dialog=1&titulo=Outlook%20parado&descricao=Desde%20ontem')
    expect(readDialogMode()).toEqual({ title: 'Outlook parado', description: 'Desde ontem' })
  })

  it('sem ?dialog=1, ou fora do Teams, é o wizard normal', () => {
    at('/solicitacoes/nova?teams=1')
    expect(readDialogMode()).toBeNull()
    at('/solicitacoes/nova?dialog=1&titulo=x')
    expect(readDialogMode()).toBeNull()
  })
})

describe('submitDialog', () => {
  it('manda { ticketId, numero } ao bot pelo dialog.url.submit', async () => {
    at('/solicitacoes/nova?teams=1&dialog=1')
    await expect(submitDialog({ ticketId: 't1', numero: 'ISA-1' })).resolves.toBe(true)
    expect(teams.submit).toHaveBeenCalledWith({ ticketId: 't1', numero: 'ISA-1' })
  })

  it('Teams sem resposta: false, para o portal seguir o caminho normal', async () => {
    at('/solicitacoes/nova?teams=1&dialog=1')
    teams.getContext.mockRejectedValueOnce(new Error('sem host'))
    await expect(submitDialog({ ticketId: 't1', numero: 'ISA-1' })).resolves.toBe(false)
    expect(teams.submit).not.toHaveBeenCalled()
  })
})
