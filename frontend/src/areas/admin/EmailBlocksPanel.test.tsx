import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EmailBlocksPanel } from './EmailBlocksPanel'
import { adminService } from '@/services/adminService'
import { toast } from '@/store/toastStore'

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiErrorMessage: vi.fn((err: any, fallback: string) => err?.response?.data?.error ?? fallback),
}))
vi.mock('@/services/adminService', () => ({
  adminService: { getEmailBlocks: vi.fn(), createEmailBlock: vi.fn(), deleteEmailBlock: vi.fn() },
}))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const svc = adminService as unknown as Record<'getEmailBlocks' | 'createEmailBlock' | 'deleteEmailBlock', ReturnType<typeof vi.fn>>
const rows = [
  { id: 'b1', kind: 'domain', value: 'spam.com', reason: 'newsletter', hits: 3, last_hit_at: '2026-10-29T16:00:00Z', created_at: '2026-10-29T10:00:00Z' },
]

beforeEach(() => {
  vi.clearAllMocks()
  svc.getEmailBlocks.mockResolvedValue({ data: rows, system: ['postmaster@ (aviso de não entrega)'] })
  svc.createEmailBlock.mockResolvedValue({ id: 'b2' })
  svc.deleteEmailBlock.mockResolvedValue(undefined)
})

describe('Admin → E-mail → Bloqueios', () => {
  it('lista os bloqueios, o contador e as regras fixas do sistema', async () => {
    render(<EmailBlocksPanel />)
    expect(await screen.findByText('@spam.com')).toBeTruthy()
    expect(screen.getByText('newsletter')).toBeTruthy()
    expect(screen.getByText(/3 vezes/)).toBeTruthy()
    expect(screen.getByText(/postmaster@/)).toBeTruthy()
  })

  it('bloqueia um domínio com motivo e recarrega a lista', async () => {
    render(<EmailBlocksPanel />)
    await screen.findByText('@spam.com')
    fireEvent.change(screen.getByPlaceholderText('exemplo.com'), { target: { value: ' promo.com ' } })
    fireEvent.change(screen.getByPlaceholderText(/Ex\.: spam/), { target: { value: 'spam' } })
    fireEvent.click(screen.getByRole('button', { name: /Bloquear/ }))
    await waitFor(() => expect(svc.createEmailBlock).toHaveBeenCalledWith({ kind: 'domain', value: 'promo.com', reason: 'spam' }))
    await waitFor(() => expect(svc.getEmailBlocks).toHaveBeenCalledTimes(2))
    expect(toast.success).toHaveBeenCalled()
  })

  it('erro do servidor (ex.: já bloqueado) aparece no aviso', async () => {
    svc.createEmailBlock.mockRejectedValueOnce({ response: { data: { error: 'Esse remetente já está bloqueado' } } })
    render(<EmailBlocksPanel />)
    await screen.findByText('@spam.com')
    fireEvent.change(screen.getByPlaceholderText('exemplo.com'), { target: { value: 'spam.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Bloquear/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Esse remetente já está bloqueado'))
  })

  it('liberar pede confirmação e exclui', async () => {
    render(<EmailBlocksPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar spam.com' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar' }))
    await waitFor(() => expect(svc.deleteEmailBlock).toHaveBeenCalledWith('b1'))
  })
})
