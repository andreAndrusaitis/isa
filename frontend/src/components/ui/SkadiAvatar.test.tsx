import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SkadiAvatar } from './SkadiAvatar'

describe('SkadiAvatar', () => {
  it('mostra o rosto com nome, tamanho fixo e carga preguiçosa', () => {
    render(<SkadiAvatar size={48} />)
    const img = screen.getByRole('img', { name: 'Skadi' })
    expect(img).toHaveAttribute('src', '/skadi/skadi-avatar.svg')
    expect(img).toHaveAttribute('width', '48')
    expect(img).toHaveAttribute('height', '48')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('cai para a inicial quando a imagem falha, sem perder o nome', () => {
    render(<SkadiAvatar size={48} />)
    fireEvent.error(screen.getByRole('img', { name: 'Skadi' }))
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByRole('img', { name: 'Skadi' })).toHaveTextContent('S')
  })

  it('decorativo: some da árvore de acessibilidade, com ou sem imagem', () => {
    render(<SkadiAvatar decorative />)
    expect(screen.queryByRole('img')).toBeNull()
    fireEvent.error(document.querySelector('img')!)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('S')).toHaveAttribute('aria-hidden', 'true')
  })
})
