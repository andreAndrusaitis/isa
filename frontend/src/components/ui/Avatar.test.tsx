import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('renderiza as iniciais quando não recebe src', () => {
    render(<Avatar name="João Duarte" />)
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('renderiza a imagem quando recebe src', () => {
    render(<Avatar name="João Duarte" src="https://example.com/avatar.png" />)
    const img = screen.getByRole('img', { name: 'João Duarte' })
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.png')
    expect(screen.queryByText('JD')).not.toBeInTheDocument()
  })

  it('usa iniciais quando avatar não é URL (ex.: iniciais ou blob cru)', () => {
    render(<Avatar name="Lucas Lima" src="avatars/2026/10/x.png" />)
    expect(screen.getByText('LL')).toBeInTheDocument()
  })
})
