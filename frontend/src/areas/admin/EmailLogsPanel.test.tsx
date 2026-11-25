import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EmailLogsPanel } from './EmailLogsPanel'
import { adminService } from '@/services/adminService'

vi.mock('@/services/adminService', () => ({ adminService: { getEmailLogs: vi.fn(), getEmailLog: vi.fn() } }))

const group = {
  ticket: { id: 't1', display_number: '100-1', title: '=HYPERLINK("http://x","y")' },
  total: 3, failed: 0, kinds: { survey: 3 }, last_sent_at: '2026-11-04T12:00:00Z',
}

let csv = ''

beforeEach(() => {
  csv = ''
  vi.mocked(adminService.getEmailLogs).mockResolvedValue({ items: [group], total: 1 } as never)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.stubGlobal('Blob', class { constructor(parts: string[]) { csv = parts.join('') } })
})
afterEach(() => vi.unstubAllGlobals())

describe('Logs de e-mail › Exportar CSV', () => {
  it('título do chamado (assunto do e-mail recebido) não vira fórmula; contagens seguem números', async () => {
    render(<EmailLogsPanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Por chamado' }))
    await screen.findByText(group.ticket.title)
    fireEvent.click(screen.getByText('Exportar CSV'))
    await waitFor(() => expect(csv).not.toBe(''))
    expect(csv).toContain(`"100-1","'=HYPERLINK(""http://x"",""y"")","3","0"`)
  })
})
