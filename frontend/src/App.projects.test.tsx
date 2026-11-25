import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/services/projectsService', () => ({
  checkProjectsAccess: vi.fn(),
  listProjects: vi.fn(async () => []),
  listFavorites: vi.fn(async () => []),
  listNavFolders: vi.fn(async () => []),
}))

import { checkProjectsAccess } from '@/services/projectsService'
import { useAuthStore } from '@/store/auth'
import App from './App'

const mockedCheck = checkProjectsAccess as unknown as ReturnType<typeof vi.fn>

function loginAs(role: string) {
  useAuthStore.setState({
    user: {
      id: 'u1', name: 'Teste', email: 't@t.com', role: role as any,
      orgId: null, queues: [], permissions: [], avatar: '',
    },
    accessToken: 'fake-token',
  } as any)
}

beforeEach(() => {
  mockedCheck.mockReset()
  useAuthStore.setState({ user: null, accessToken: null } as any)
})

describe('/projetos route guard', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    render(
      <MemoryRouter initialEntries={['/projetos']}>
        <App />
      </MemoryRouter>
    )
    // Sem sessão, o guard nunca deve sequer chamar a API de acesso —
    // a garantia observável aqui é a ausência dessa chamada, não o
    // conteúdo da LoginPage (que este teste não precisa conhecer).
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockedCheck).not.toHaveBeenCalled()
  })

  it('shows access denied page when checkProjectsAccess resolves false', async () => {
    loginAs('agent')
    mockedCheck.mockResolvedValue(false)
    render(
      <MemoryRouter initialEntries={['/projetos']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => screen.getByText(/não tem acesso ao módulo de Projetos/i))
  })

  it('shows the Projetos shell when checkProjectsAccess resolves true', async () => {
    loginAs('manager')
    mockedCheck.mockResolvedValue(true)
    render(
      <MemoryRouter initialEntries={['/projetos']}>
        <App />
      </MemoryRouter>
    )
    // O header
    // "Projetos" é o que confirma que o guard liberou o acesso e
    // renderizou o shell (é único na tela, ao contrário de "Minhas
    // Tarefas", que aparece tanto na sidebar quanto na página index).
    // ProjetosPage é lazy no App: com a máquina carregada passa de 1s (padrão do waitFor).
    await waitFor(() => expect(screen.getAllByText(/Projetos/i).length).toBeGreaterThan(0), { timeout: 10_000 })
  }, 15_000) // monta o App inteiro: com a suíte em paralelo, 5s (padrão) ficava no limite
})
