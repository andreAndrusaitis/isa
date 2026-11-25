import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateTaskModal } from './CreateTaskModal'
import * as tasksService from '@/services/tasksService'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/tasksService')
vi.mock('@/services/projectsService')

const statuses = [{ id: 's1', projectId: 'p1', name: 'A Fazer', color: '#000', category: 'open', position: 0, isActive: true, requiresApproval: false }]

const member = { userId: 'u2', projectId: 'p1', role: 'member' as const, user: { id: 'u2', name: 'João Silva', avatar: null, role: 'agent' } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(projectsService.listMembers).mockResolvedValue([member] as any)
  vi.mocked(projectsService.listTaskTypes).mockResolvedValue([
    { id: 'tt-1', projectId: 'p1', name: 'Bug', icon: 'Bug', color: '#dc2626', position: 0, prefix: 'BUG', nextNumber: 7 },
  ] as any)
  vi.mocked(projectsService.listSprints).mockResolvedValue([
    { id: 'sp-1', projectId: 'p1', name: 'Sprint 1', status: 'active', startDate: null, endDate: null, position: 0 },
  ] as any)
})

// Tipo é obrigatório: escolhe o Bug (BUG) depois que a lista carrega.
async function selectType() {
  await screen.findByRole('option', { name: 'Bug (BUG)' })
  fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'tt-1' } })
}

describe('CreateTaskModal', () => {
  it('chama createTask com título e status selecionado', async () => {
    const created = { id: 't1', projectId: 'p1', listId: null, statusId: 's1', parentId: null, seq: 1, title: 'Nova task', description: null, priority: 'none', assigneeId: null, creatorId: 'u1', startDate: null, dueDate: null, isMilestone: false, archivedAt: null }
    vi.mocked(tasksService.createTask).mockResolvedValue(created as any)
    const onCreated = vi.fn()

    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={onCreated} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)
    fireEvent.change(screen.getByPlaceholderText(/configurar ambiente/i), { target: { value: 'Nova task' } })
    await selectType()
    fireEvent.click(screen.getByRole('button', { name: /criar task/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    expect(tasksService.createTask).toHaveBeenCalledWith('p1', expect.objectContaining({ title: 'Nova task', statusId: 's1' }))
  })

  it('não submete sem tipo e mostra o ID que será gerado', async () => {
    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)
    fireEvent.change(screen.getByPlaceholderText(/configurar ambiente/i), { target: { value: 'Sem tipo' } })
    expect(screen.getByRole('button', { name: /criar task/i })).toBeDisabled()
    await selectType()
    expect(screen.getByText('BUG-7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /criar task/i })).toBeEnabled()
  })

  it('modo subtarefa: traz o título rápido, herda sprint e envia parentId + lista da mãe', async () => {
    vi.mocked(tasksService.createTask).mockResolvedValue({ id: 'st1', title: 'Filha' } as any)
    const parent = { id: 'pai', label: 'FEAT-9', title: 'Task mãe', listId: 'l1', sprintId: 'sp-1' }

    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" parent={parent} initialTitle="Filha" />)

    expect(screen.getByText('FEAT-9')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/configurar ambiente/i)).toHaveValue('Filha')
    await selectType()
    fireEvent.click(screen.getByRole('button', { name: /criar subtarefa/i }))

    await waitFor(() => expect(tasksService.createTask).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'Filha', parentId: 'pai', listId: 'l1', sprintId: 'sp-1',
    })))
  })

  it('não submete com título vazio', () => {
    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)
    expect(screen.getByRole('button', { name: /criar task/i })).toBeDisabled()
  })

  it('envia descrição, prioridade, responsável, datas e milestone', async () => {
    const created = { id: 't1', projectId: 'p1', statusId: 's1', seq: 1, title: 'Completa' }
    vi.mocked(tasksService.createTask).mockResolvedValue(created as any)

    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)

    fireEvent.change(screen.getByPlaceholderText(/configurar ambiente/i), { target: { value: 'Completa' } })
    fireEvent.change(screen.getByPlaceholderText(/detalhes, critérios/i), { target: { value: 'Descrição detalhada' } })
    expect(await screen.findByText('João Silva')).toBeInTheDocument()

    await selectType()
    fireEvent.click(screen.getByRole('button', { name: /criar task/i }))

    await waitFor(() => expect(tasksService.createTask).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'Completa', description: 'Descrição detalhada', priority: 'none', assigneeId: null, isMilestone: false,
    })))
  })

  it('reseta o formulário toda vez que o modal é reaberto', async () => {
    const created = { id: 't1', projectId: 'p1', statusId: 's1', seq: 1, title: 'Primeira' }
    vi.mocked(tasksService.createTask).mockResolvedValue(created as any)
    const { rerender } = render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)
    await screen.findByText('João Silva')

    fireEvent.change(screen.getByPlaceholderText(/configurar ambiente/i), { target: { value: 'Primeira' } })

    rerender(<CreateTaskModal isOpen={false} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)
    rerender(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)
    await screen.findByText('João Silva')

    expect(screen.getByPlaceholderText(/configurar ambiente/i)).toHaveValue('')
  })

  it('mostra erro do backend sem fechar o modal', async () => {
    vi.mocked(tasksService.createTask).mockRejectedValue({ response: { data: { error: 'Status inválido' } } })
    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)

    fireEvent.change(screen.getByPlaceholderText(/configurar ambiente/i), { target: { value: 'Falha' } })
    await selectType()
    fireEvent.click(screen.getByRole('button', { name: /criar task/i }))

    expect(await screen.findByText('Status inválido')).toBeInTheDocument()
  })

  it('envia taskTypeId quando um tipo é selecionado', async () => {
    const created = { id: 't1', projectId: 'p1', statusId: 's1', seq: 1, title: 'Com tipo' }
    vi.mocked(tasksService.createTask).mockResolvedValue(created as any)

    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)

    fireEvent.change(screen.getByPlaceholderText(/configurar ambiente/i), { target: { value: 'Com tipo' } })
    await selectType()
    fireEvent.click(screen.getByRole('button', { name: /criar task/i }))

    await waitFor(() => expect(tasksService.createTask).toHaveBeenCalledWith('p1', expect.objectContaining({ taskTypeId: 'tt-1' })))
  })

  it('envia storyPoints quando selecionado', async () => {
    const created = { id: 't1', projectId: 'p1', statusId: 's1', seq: 1, title: 'Com pontos' }
    vi.mocked(tasksService.createTask).mockResolvedValue(created as any)

    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)

    fireEvent.change(screen.getByPlaceholderText(/configurar ambiente/i), { target: { value: 'Com pontos' } })
    fireEvent.change(screen.getByLabelText(/story points/i), { target: { value: '5' } })
    await selectType()
    fireEvent.click(screen.getByRole('button', { name: /criar task/i }))

    await waitFor(() => expect(tasksService.createTask).toHaveBeenCalledWith('p1', expect.objectContaining({ storyPoints: 5 })))
  })

  it('envia sprintId quando selecionado', async () => {
    const created = { id: 't1', projectId: 'p1', statusId: 's1', seq: 1, title: 'Na sprint' }
    vi.mocked(tasksService.createTask).mockResolvedValue(created as any)

    render(<CreateTaskModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} projectId="p1" statuses={statuses as any} defaultStatusId="s1" />)

    fireEvent.change(screen.getByPlaceholderText(/configurar ambiente/i), { target: { value: 'Na sprint' } })
    await screen.findByText('Sprint 1')
    fireEvent.change(screen.getByLabelText(/^sprint$/i), { target: { value: 'sp-1' } })
    await selectType()
    fireEvent.click(screen.getByRole('button', { name: /criar task/i }))

    await waitFor(() => expect(tasksService.createTask).toHaveBeenCalledWith('p1', expect.objectContaining({ sprintId: 'sp-1' })))
  })
})
