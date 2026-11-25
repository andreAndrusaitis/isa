import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntakeFlag } from './IntakeFlag'
import { aiService } from '@/services/aiService'
import { toast } from '@/store/toastStore'

vi.mock('@/services/aiService', () => ({ aiService: { dismissIntake: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn() } }))

describe('IntakeFlag', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(aiService.dismissIntake).mockResolvedValue(undefined) })

  it('só aparece quando o chamado está incompleto', () => {
    const { container } = render(<IntakeFlag ticketId="t1" status="complemented" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('some com o chamado resolvido ou fechado', () => {
    for (const s of ['resolved', 'closed']) {
      const { container, unmount } = render(<IntakeFlag ticketId="t1" status="incomplete" ticketStatus={s} />)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
    render(<IntakeFlag ticketId="t1" status="incomplete" ticketStatus="open" />)
    expect(screen.getByText('Informações incompletas')).toBeInTheDocument()
  })

  it('mostra a marca e, com permissão, dispensa', async () => {
    const onDismissed = vi.fn()
    render(<IntakeFlag ticketId="t1" status="incomplete" canDismiss onDismissed={onDismissed} />)
    expect(screen.getByText('Informações incompletas')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar marca' }))
    await waitFor(() => expect(aiService.dismissIntake).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(onDismissed).toHaveBeenCalled())
  })

  it('sem permissão não mostra o botão', () => {
    render(<IntakeFlag ticketId="t1" status="incomplete" />)
    expect(screen.queryByRole('button', { name: 'Dispensar marca' })).toBeNull()
  })

  it('variante compacta mostra Incompleto', () => {
    render(<IntakeFlag ticketId="t1" status="incomplete" compact />)
    expect(screen.getByText('Incompleto')).toBeInTheDocument()
  })

  it('dispensar não propaga o clique ao pai', async () => {
    const parent = vi.fn()
    render(<div onClick={parent}><IntakeFlag ticketId="t1" status="incomplete" canDismiss /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar marca' }))
    await waitFor(() => expect(aiService.dismissIntake).toHaveBeenCalled())
    expect(parent).not.toHaveBeenCalled()
  })

  it('em falha mostra toast e não chama onDismissed', async () => {
    vi.mocked(aiService.dismissIntake).mockRejectedValueOnce(new Error('x'))
    const onDismissed = vi.fn()
    render(<IntakeFlag ticketId="t1" status="incomplete" canDismiss onDismissed={onDismissed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar marca' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onDismissed).not.toHaveBeenCalled()
  })
})
