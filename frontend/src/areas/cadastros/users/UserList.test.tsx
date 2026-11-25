import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UserList } from './UserList'

const mockUsers = Array.from({ length: 30 }, (_, i) => ({
  id: `user-${i + 1}`,
  name: `Usuário ${i + 1}`,
  email: `usuario${i + 1}@empresa.com`,
  role: 'agent',
  active: true,
}))

const mockOrgs = [
  { id: 'org-1', name: 'Empresa Alpha' },
]

describe('UserList — Paginação e Toolbar', () => {
  it('renderiza o componente de paginação em estilo toolbar com a contagem correta', () => {
    render(
      <UserList
        users={mockUsers}
        orgs={mockOrgs}
        selectedUser={null}
        onSelectUser={vi.fn()}
        onOpenNew={vi.fn()}
        currentUserRole="admin"
      />
    )

    // Intervalo e total: 1–25 de 30
    expect(screen.getByText('1–25 de 30')).toBeInTheDocument()
    // Itens por página
    expect(screen.getByText('Por página')).toBeInTheDocument()
    // Botão da página 2
    expect(screen.getByRole('button', { name: 'Página 2' })).toBeInTheDocument()
  })

  it('permite navegar para a página 2 e exibe os usuários correspondentes', () => {
    render(
      <UserList
        users={mockUsers}
        orgs={mockOrgs}
        selectedUser={null}
        onSelectUser={vi.fn()}
        onOpenNew={vi.fn()}
        currentUserRole="admin"
      />
    )

    // Usuário 1 está na página 1, Usuário 26 está na página 2
    expect(screen.getByText('Usuário 1')).toBeInTheDocument()
    expect(screen.queryByText('Usuário 26')).not.toBeInTheDocument()

    // Clica na página 2
    fireEvent.click(screen.getByRole('button', { name: 'Página 2' }))

    // Agora Usuário 26 deve estar visível e Usuário 1 não
    expect(screen.getByText('26–30 de 30')).toBeInTheDocument()
    expect(screen.getByText('Usuário 26')).toBeInTheDocument()
    expect(screen.queryByText('Usuário 1')).not.toBeInTheDocument()
  })
})
