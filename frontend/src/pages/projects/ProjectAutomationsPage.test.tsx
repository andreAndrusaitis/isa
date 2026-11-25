import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectAutomationsPage from './ProjectAutomationsPage'
import * as automationsService from '@/services/automationsService'
import * as projectsService from '@/services/projectsService'
import { toast } from '@/store/toastStore'

vi.mock('@/services/automationsService')
vi.mock('@/services/projectsService')
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const members = [
  { userId: 'u1', projectId: 'p1', role: 'owner', user: { id: 'u1', name: 'Ana Owner', avatar: null, role: 'manager' } },
  { userId: 'u2', projectId: 'p1', role: 'member', user: { id: 'u2', name: 'Beto Membro', avatar: null, role: 'agent' } },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projetos/p1/automations']}>
      <Routes><Route path="/projetos/:projectId/automations" element={<ProjectAutomationsPage />} /></Routes>
    </MemoryRouter>
  )
}

function fillForm() {
  fireEvent.change(screen.getByPlaceholderText(/notificar equipe/i), { target: { value: 'Avisar Beto' } })
  fireEvent.change(screen.getByPlaceholderText(/pronta para revisão/i), { target: { value: 'Mudou o status' } })
}

describe('ProjectAutomationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(automationsService.listAutomations).mockResolvedValue([])
    vi.mocked(projectsService.listMembers).mockResolvedValue(members as any)
  })

  it('exige o destinatário antes de salvar e envia o userId escolhido', async () => {
    vi.mocked(automationsService.createAutomation).mockResolvedValue({
      id: 'a1', name: 'Avisar Beto', trigger: 'status_changed', isActive: true,
      actions: [{ type: 'send_notification', userId: 'u2', message: 'Mudou o status' }],
    })
    renderPage()
    await screen.findByText('Nova regra de automação')
    await screen.findByRole('option', { name: 'Beto Membro' })
    fillForm()

    const save = screen.getByRole('button', { name: /criar automação/i })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Notificar quem'), { target: { value: 'u2' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(automationsService.createAutomation).toHaveBeenCalledWith('p1', {
      name: 'Avisar Beto',
      trigger: 'status_changed',
      actions: [{ type: 'send_notification', userId: 'u2', message: 'Mudou o status' }],
    }))
    expect(await screen.findByText(/enviar notificação para Beto Membro/)).toBeInTheDocument()
  })

  it('erro ao criar mostra toast com a mensagem do backend', async () => {
    vi.mocked(automationsService.createAutomation).mockRejectedValue({ response: { data: { error: 'Ação inválida.' } } })
    renderPage()
    await screen.findByRole('option', { name: 'Beto Membro' })
    fillForm()
    fireEvent.change(screen.getByLabelText('Notificar quem'), { target: { value: 'u2' } })
    fireEvent.click(screen.getByRole('button', { name: /criar automação/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ação inválida.'))
  })

  it('erro ao ativar/desativar mostra toast', async () => {
    vi.mocked(automationsService.listAutomations).mockResolvedValue([
      { id: 'a1', name: 'Regra 1', trigger: 'task_created', isActive: true, actions: [{ type: 'add_comment', body: 'oi' }] },
    ])
    vi.mocked(automationsService.setAutomationActive).mockRejectedValue(new Error('rede'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Não foi possível desativar a automação.'))
  })

  it('falha ao carregar mostra estado de erro com "Tentar novamente"', async () => {
    vi.mocked(automationsService.listAutomations).mockRejectedValueOnce(new Error('rede'))
    renderPage()
    expect(await screen.findByText('Não foi possível carregar')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma regra cadastrada')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByText('Nenhuma regra cadastrada')).toBeInTheDocument()
    expect(automationsService.listAutomations).toHaveBeenCalledTimes(2)
  })
})
