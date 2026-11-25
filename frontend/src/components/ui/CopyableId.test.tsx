import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { CopyableId, copyToClipboard } from './CopyableId'
import { toast } from '@/store/toastStore'

vi.mock('@/store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('copyToClipboard', () => {
  it('copies pure trimmed text to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const ok = await copyToClipboard('  cat-abc-123  ')
    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('cat-abc-123')
  })

  it('returns false when text is empty', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const ok = await copyToClipboard('')
    expect(ok).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('returns false when clipboard access is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const ok = await copyToClipboard('cat-abc-123')
    expect(ok).toBe(false)
  })
})

describe('CopyableId component', () => {
  let writeTextMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: writeTextMock }, configurable: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('renders monospace code with the ID and a copy button', () => {
    render(<CopyableId id="queue-support-01" prefix="ID:" />)

    expect(screen.getByText('ID:')).toBeInTheDocument()
    const codeEl = screen.getByText('queue-support-01')
    expect(codeEl.tagName.toLowerCase()).toBe('code')
    expect(codeEl).toHaveStyle({ fontFamily: 'monospace, monospace' })
  })

  it('copies ID in 1 click and shows "Copiado!" feedback', async () => {
    const onCopied = vi.fn()
    render(<CopyableId id="cat-infra-001" onCopied={onCopied} />)

    const copyBtn = screen.getByRole('button')
    await act(async () => {
      fireEvent.click(copyBtn)
    })

    expect(writeTextMock).toHaveBeenCalledWith('cat-infra-001')
    expect(toast.success).toHaveBeenCalledWith('ID copiado!')
    expect(onCopied).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Copiado!')).toBeInTheDocument()

    // After 2 seconds, reverts from Copiado!
    act(() => {
      vi.advanceTimersByTime(2100)
    })
    expect(screen.queryByText('Copiado!')).not.toBeInTheDocument()
  })

  it('renders in iconOnly mode without rendering the code text', async () => {
    render(<CopyableId id="subcat-printer-99" iconOnly tooltip="ID: subcat-printer-99" />)

    // Code text should not be visible as a separate element
    expect(screen.queryByText('subcat-printer-99')).not.toBeInTheDocument()

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('data-tooltip', 'ID: subcat-printer-99')

    await act(async () => {
      fireEvent.click(button)
    })

    expect(writeTextMock).toHaveBeenCalledWith('subcat-printer-99')
    expect(toast.success).toHaveBeenCalledWith('ID copiado!')
  })

  it('stops click propagation to avoid triggering parent container click handlers', async () => {
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <CopyableId id="cat-test-01" iconOnly />
      </div>
    )

    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.click(button)
    })

    expect(writeTextMock).toHaveBeenCalledWith('cat-test-01')
    expect(parentClick).not.toHaveBeenCalled()
  })
})
