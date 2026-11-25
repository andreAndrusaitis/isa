import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UserMenu } from './UserMenu'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const user = {
  id: '1', name: 'João', email: 'joao@t.com', role: 'agent' as const,
  orgId: null, queues: [], avatar: '',
}

describe('UserMenu', () => {
  it('navega para /perfil ao clicar em "Meu perfil" (não abre mais popup)', () => {
    render(<MemoryRouter><UserMenu user={user} /></MemoryRouter>)

    fireEvent.click(screen.getByText('João'))
    fireEvent.click(screen.getByText('Meu perfil'))

    expect(mockNavigate).toHaveBeenCalledWith('/perfil')
    expect(screen.queryByText('Editar Perfil')).not.toBeInTheDocument()
  })
})
