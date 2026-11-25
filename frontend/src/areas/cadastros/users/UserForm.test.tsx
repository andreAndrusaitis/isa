import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UserForm } from './UserForm'
import { useAuthStore } from '@/store/auth'

vi.mock('@/hooks/useUserScope', () => ({ useUserScope: () => null }))

function renderForm(formData: Record<string, unknown>) {
  useAuthStore.setState({ user: { id: 'adm', name: 'Admin', role: 'admin' } as any })
  render(
    <UserForm
      mode="edit"
      currentUserRole="admin"
      currentUserId="adm"
      users={[]}
      orgs={[]}
      queues={[]}
      formData={{ id: 'a1', name: 'Ana', email: 'ana@t.local', role: 'agent', permissions: [], ...formData }}
      setFormData={vi.fn()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      saving={false}
    />,
  )
  fireEvent.click(screen.getByText('Permissões'))
}

// Liberações de Projetos ficam num bloco próprio, separado das áreas de chamados.
describe('UserForm — liberações de Projetos', () => {
  it('com o módulo Projetos ligado, mostra o bloco Projetos com as três liberações', () => {
    renderForm({ module_projects: true })
    expect(screen.getByText('Relatórios de projetos')).toBeInTheDocument()
    expect(screen.getByText('Integrações de projetos')).toBeInTheDocument()
    expect(screen.getByText('Calendário de sprints e pastas')).toBeInTheDocument()
  })

  it('com o módulo Projetos desligado, o bloco não aparece', () => {
    renderForm({ module_projects: false })
    expect(screen.queryByText('Relatórios de projetos')).toBeNull()
  })

  it('as liberações de Projetos não entram nos blocos de chamados', () => {
    renderForm({ module_projects: false })
    expect(screen.getByText('Painel')).toBeInTheDocument()
    expect(screen.queryByText('Integrações de projetos')).toBeNull()
  })
})
