import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UserForm } from './UserForm'
import { useAuthStore } from '@/store/auth'

vi.mock('@/hooks/useUserScope', () => ({ useUserScope: () => null }))

// Novo usuário Analista: as abas não podem ficar cortadas e o formulário não abre "com erro".
function renderCreate() {
  useAuthStore.setState({ user: { id: 'adm', name: 'Admin', role: 'admin' } as any })
  const onSubmit = vi.fn()
  render(
    <UserForm
      mode="create"
      currentUserRole="admin"
      currentUserId="adm"
      users={[]}
      orgs={[{ id: 'o1', name: 'ISA Interna' }]}
      queues={[]}
      formData={{ name: '', email: '', role: 'agent', permissions: [] }}
      setFormData={vi.fn()}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      saving={false}
    />,
  )
  return { onSubmit }
}

describe('UserForm — novo Analista', () => {
  it('abas quebram linha (sem rolagem escondida) e todas ficam acessíveis', () => {
    renderCreate()
    const tablist = screen.getByRole('tablist', { name: 'Seções do cadastro' })
    expect(tablist.style.flexWrap).toBe('wrap')
    expect(tablist.style.overflowX).toBe('')
    const tabs = screen.getAllByRole('tab').map(t => t.textContent)
    expect(tabs).toContain('Permissões')
    expect(screen.getByRole('tab', { name: 'Dados pessoais' })).toHaveAttribute('aria-selected', 'true')
  })

  it('empresa obrigatória só aparece depois de tentar salvar', () => {
    const { onSubmit } = renderCreate()
    expect(screen.queryByText('Empresa é obrigatória para este perfil.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))
    expect(onSubmit).toHaveBeenCalled()
    expect(screen.getByText('Empresa é obrigatória para este perfil.')).toBeInTheDocument()
  })
})
