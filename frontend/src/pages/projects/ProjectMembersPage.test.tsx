import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectMembersPage from './ProjectMembersPage'
import * as projectsService from '@/services/projectsService'
import { adminService } from '@/services/adminService'
import { useAuthStore } from '@/store/auth'
import { ProjectRoleProvider, ProjectRole } from '@/components/projects/projectRole'
import { toast } from '@/store/toastStore'

vi.mock('@/services/projectsService')
vi.mock('@/services/adminService', () => ({ adminService: { getUsers: vi.fn() } }))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const members = [
  { userId: 'u1', projectId: 'p1', role: 'owner', user: { id: 'u1', name: 'Ana Owner', avatar: null, role: 'manager' } },
  { userId: 'u2', projectId: 'p1', role: 'member', user: { id: 'u2', name: 'Beto Membro', avatar: null, role: 'agent' } },
]

// O papel efetivo vem do shell (ProjectRoleProvider), não da lista de membros.
const ROLE_OF: Record<string, ProjectRole> = { u1: 'owner', u2: 'member' }

function renderPage(currentUserId = 'u1', role: ProjectRole = ROLE_OF[currentUserId], list: any[] = members) {
  useAuthStore.setState({ user: { id: currentUserId, name: 'Atual', role: 'manager' } as any })
  vi.mocked(projectsService.listMembers).mockResolvedValue(list as any)
  return render(
    <MemoryRouter initialEntries={['/projetos/p1/members']}>
      <ProjectRoleProvider value={role}>
        <Routes><Route path="/projetos/:projectId/members" element={<ProjectMembersPage />} /></Routes>
      </ProjectRoleProvider>
    </MemoryRouter>
  )
}

describe('ProjectMembersPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista os membros com nome e role', async () => {
    renderPage()
    expect(await screen.findByText('Ana Owner')).toBeInTheDocument()
    expect(screen.getByText('Beto Membro')).toBeInTheDocument()
  })

  it('owner consegue remover um membro', async () => {
    vi.mocked(projectsService.removeMember).mockResolvedValue(undefined)
    renderPage('u1')
    await screen.findByText('Beto Membro')
    fireEvent.click(screen.getAllByRole('button', { name: /remover/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    await waitFor(() => expect(projectsService.removeMember).toHaveBeenCalledWith('p1', 'u2'))
  })

  it('owner consegue adicionar um novo membro via busca por nome', async () => {
    vi.mocked(adminService.getUsers).mockResolvedValue([
      { id: 'u3', name: 'Carla Nova' },
    ] as any)
    vi.mocked(projectsService.addProjectMember).mockResolvedValue({} as any)

    renderPage('u1')
    await screen.findByText('Ana Owner')

    fireEvent.click(screen.getByRole('button', { name: /adicionar membro/i }))
    fireEvent.focus(screen.getByPlaceholderText(/buscar por nome/i))
    fireEvent.click(await screen.findByText('Carla Nova'))
    fireEvent.click(screen.getByRole('button', { name: /^adicionar$/i }))

    await waitFor(() => expect(projectsService.addProjectMember).toHaveBeenCalledWith('p1', 'u3', 'member'))
  })

  it('não mostra "Adicionar membro" para quem não gerencia o projeto', async () => {
    // Beto é 'member', sem permissão de gerência.
    renderPage('u2')
    await screen.findByText('Ana Owner')
    expect(screen.queryByRole('button', { name: /adicionar membro/i })).not.toBeInTheDocument()
  })

  it('trocar papel mantém o nome na linha (o PATCH não devolve `user`)', async () => {
    vi.mocked(projectsService.updateMemberRole).mockResolvedValue({ userId: 'u2', projectId: 'p1', role: 'manager' } as any)
    renderPage('u1')
    await screen.findByText('Beto Membro')
    fireEvent.change(screen.getByLabelText('Papel de Beto Membro'), { target: { value: 'manager' } })
    await waitFor(() => expect(projectsService.updateMemberRole).toHaveBeenCalledWith('p1', 'u2', 'manager'))
    await waitFor(() => expect(screen.getByLabelText('Papel de Beto Membro')).toHaveValue('manager'))
    expect(screen.getByText('Beto Membro')).toBeInTheDocument()
  })

  it('erro ao trocar papel mostra a mensagem do backend (ex.: LAST_OWNER)', async () => {
    const twoOwners = [...members, { userId: 'u3', projectId: 'p1', role: 'owner', user: { id: 'u3', name: 'Caio Dono', avatar: null, role: 'agent' } }]
    vi.mocked(projectsService.updateMemberRole).mockRejectedValue({ response: { data: { error: 'O projeto precisa de pelo menos um dono. Defina outro dono antes.', code: 'LAST_OWNER' } } })
    renderPage('u1', 'owner', twoOwners)
    await screen.findByText('Caio Dono')
    fireEvent.change(screen.getByLabelText('Papel de Caio Dono'), { target: { value: 'member' } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O projeto precisa de pelo menos um dono. Defina outro dono antes.'))
    expect(screen.getByLabelText('Papel de Caio Dono')).toHaveValue('owner')
  })

  it('erro ao remover mostra toast e mantém a pessoa na lista', async () => {
    vi.mocked(projectsService.removeMember).mockRejectedValue({ response: { data: { error: 'Sem permissão.' } } })
    renderPage('u1')
    await screen.findByText('Beto Membro')
    fireEvent.click(screen.getAllByRole('button', { name: /remover/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Sem permissão.'))
    expect(screen.getByText('Beto Membro')).toBeInTheDocument()
  })

  it('dono pode trocar papel e remover OUTRO dono; a própria linha fica travada', async () => {
    const twoOwners = [...members, { userId: 'u3', projectId: 'p1', role: 'owner', user: { id: 'u3', name: 'Caio Dono', avatar: null, role: 'agent' } }]
    renderPage('u1', 'owner', twoOwners)
    await screen.findByText('Caio Dono')
    expect(screen.getByLabelText('Papel de Caio Dono')).toBeEnabled()
    expect(screen.getByLabelText('Papel de Ana Owner')).toBeDisabled()
    // Remover: Beto e Caio, não a própria Ana.
    expect(screen.getAllByRole('button', { name: /remover/i })).toHaveLength(2)
  })

  it('admin (dono efetivo, fora da lista de membros) gerencia o projeto', async () => {
    renderPage('admin-1', 'owner')
    await screen.findByText('Ana Owner')
    expect(screen.getByRole('button', { name: /adicionar membro/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Papel de Beto Membro')).toBeEnabled()
  })
})
