import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PwdInp } from './Form'
import { useBackdropClose } from './Modal'

describe('PwdInp — botão "Mostrar senha"', () => {
  it('começa mascarado e alterna para texto ao clicar no olho', async () => {
    const user = userEvent.setup()
    render(<PwdInp defaultValue="Senha@123" aria-label="Senha" />)

    const input = screen.getByLabelText('Senha') as HTMLInputElement
    expect(input.type).toBe('password')

    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    expect(input.type).toBe('text')
    expect(input.value).toBe('Senha@123')

    await user.click(screen.getByRole('button', { name: 'Ocultar senha' }))
    expect(input.type).toBe('password')
  })

  it('mantém o valor digitado ao alternar a visibilidade', async () => {
    const user = userEvent.setup()
    render(<PwdInp aria-label="Senha" />)

    const input = screen.getByLabelText('Senha') as HTMLInputElement
    await user.type(input, 'abc123')
    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))

    expect(input.value).toBe('abc123')
  })
})

function Backdrop({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropClose(onClose)
  return (
    <div data-testid="backdrop" {...backdrop}>
      <div data-testid="painel">
        <input aria-label="Senha" />
      </div>
    </div>
  )
}

describe('useBackdropClose — modal não pode sumir ao arrastar de dentro para fora', () => {
  it('fecha quando o clique começa e termina no backdrop', () => {
    const onClose = vi.fn()
    render(<Backdrop onClose={onClose} />)

    const backdrop = screen.getByTestId('backdrop')
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('NÃO fecha quando a seleção começa dentro do modal e o mouse é solto no backdrop', () => {
    const onClose = vi.fn()
    render(<Backdrop onClose={onClose} />)

    // Seleção de texto no campo de senha arrastada para fora: o `click` resultante
    // tem como alvo o ancestral comum (o backdrop).
    fireEvent.mouseDown(screen.getByLabelText('Senha'))
    fireEvent.click(screen.getByTestId('backdrop'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('não fecha em cliques dentro do modal', () => {
    const onClose = vi.fn()
    render(<Backdrop onClose={onClose} />)

    const painel = screen.getByTestId('painel')
    fireEvent.mouseDown(painel)
    fireEvent.click(painel)

    expect(onClose).not.toHaveBeenCalled()
  })
})
