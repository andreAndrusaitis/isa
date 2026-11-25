import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuditPanel } from './AuditPanel'
import { adminService } from '@/services/adminService'

vi.mock('@/services/adminService', () => ({ adminService: { getAuditLogs: vi.fn(), getUsers: vi.fn().mockResolvedValue([]) } }))

const log = {
  id: 'a1', created_at: '2026-11-04T12:00:00Z', resource: 'user', action: 'UPDATE_USER',
  user: { name: '=HYPERLINK("http://x","y")', email: 'maria@acme.test' },
  ip: '10.0.0.1', user_agent: '@SUM(1+1)', details: { campo: 'nome' },
}

let csv = ''

beforeEach(() => {
  csv = ''
  vi.mocked(adminService.getAuditLogs).mockResolvedValue({ items: [log], total: 1 } as never)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  vi.stubGlobal('Blob', class { constructor(parts: string[]) { csv = parts.join('') } })
})
afterEach(() => vi.unstubAllGlobals())

describe('Auditoria › Exportar CSV', () => {
  it('nome e User-Agent não viram fórmula; o resto da linha não muda', async () => {
    render(<AuditPanel />)
    fireEvent.click(await screen.findByText('Exportar CSV'))
    await waitFor(() => expect(csv).not.toBe(''))
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csv).toContain(`"'@SUM(1+1)"`)
    expect(csv).toContain('"maria@acme.test","10.0.0.1"')
    expect(csv).toContain('"{""campo"":""nome""}"')
  })
})
