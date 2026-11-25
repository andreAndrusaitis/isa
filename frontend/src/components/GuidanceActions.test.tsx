import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GuidanceActions } from './GuidanceActions'
import { aiService } from '@/services/aiService'
import { toast } from '@/store/toastStore'

vi.mock('@/services/aiService', () => ({ aiService: { getGuidance: vi.fn(), answerGuidance: vi.fn() } }))
vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('GuidanceActions', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(aiService.answerGuidance).mockResolvedValue(undefined) })

  it('sem oferta pendente não aparece', async () => {
    vi.mocked(aiService.getGuidance).mockResolvedValue({ guidance_status: 'declined' })
    const { container } = render(<GuidanceActions ticketId="t1" />)
    await waitFor(() => expect(aiService.getGuidance).toHaveBeenCalledWith('t1'))
    expect(container).toBeEmptyDOMElement()
  })

  it('orientação: "Resolveu meu problema" responde, avisa e some', async () => {
    vi.mocked(aiService.getGuidance).mockResolvedValue({ guidance_status: 'offered' })
    const onAnswered = vi.fn()
    render(<GuidanceActions ticketId="t1" onAnswered={onAnswered} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resolveu meu problema' }))
    await waitFor(() => expect(aiService.answerGuidance).toHaveBeenCalledWith('t1', 'resolved'))
    await waitFor(() => expect(onAnswered).toHaveBeenCalledWith('resolved'))
    expect(toast.success).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Resolveu meu problema' })).toBeNull()
  })

  it('duplicidade: mostra o chamado do solicitante e oferece vincular', async () => {
    vi.mocked(aiService.getGuidance).mockResolvedValue({ guidance_status: 'duplicate_offered', related: { id: 'o1', display_number: 'ISA-10', title: 'VPN cai' } })
    render(<GuidanceActions ticketId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular ao ISA-10' }))
    await waitFor(() => expect(aiService.answerGuidance).toHaveBeenCalledWith('t1', 'link'))
  })

  it('erro mantém os botões e avisa', async () => {
    vi.mocked(aiService.getGuidance).mockResolvedValue({ guidance_status: 'offered' })
    vi.mocked(aiService.answerGuidance).mockRejectedValue(new Error('x'))
    render(<GuidanceActions ticketId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Não resolveu' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Não resolveu' })).not.toBeDisabled()
  })
})
