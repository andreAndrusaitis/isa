import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectTasksPage from './ProjectTasksPage'
import * as tasksService from '@/services/tasksService'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/tasksService')
vi.mock('@/services/projectsService')

const status = { id: 's1', projectId: 'p1', name: 'A Fazer', color: '#94a3b8', category: 'open' as const, position: 0, isActive: true, requiresApproval: false }
const task = {
  id: 't1', projectId: 'p1', listId: null, statusId: 's1', parentId: null, seq: 1, title: 'Tarefa 1',
  description: null, priority: 'none' as const, assigneeId: null, creatorId: 'u1', startDate: null,
  dueDate: null, isMilestone: false, archivedAt: null,
}

function renderAt(view?: string) {
  const entry = view ? `/projetos/p1/tasks?view=${view}` : '/projetos/p1/tasks'
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/projetos/:projectId/tasks" element={<ProjectTasksPage />} /></Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([status] as any)
  vi.mocked(tasksService.listTasks).mockResolvedValue([task] as any)
  vi.mocked(projectsService.listMembers).mockResolvedValue([])
  vi.mocked(projectsService.listSprints).mockResolvedValue([])
  vi.mocked(projectsService.listTaskTypes).mockResolvedValue([{ id: 'tt-bug', name: 'Bug', prefix: 'BUG' }] as any)
  vi.mocked(projectsService.listTags).mockResolvedValue([])
})

describe('ProjectTasksPage', () => {
  it('mostra o Board por padrão, com a task carregada', async () => {
    renderAt()
    expect(await screen.findByText('Tarefa 1')).toBeInTheDocument()
    expect(screen.getByText('A Fazer')).toBeInTheDocument()
  })

  it('troca para Lista sem refazer a chamada de listTasks (mesma coleção)', async () => {
    renderAt()
    await screen.findByText('Tarefa 1')
    expect(tasksService.listTasks).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('tab', { name: /lista/i }))

    expect(await screen.findByText('Tarefa 1')).toBeInTheDocument()
    // Trocar de view é troca de componente local, não nova navegação/fetch.
    expect(tasksService.listTasks).toHaveBeenCalledTimes(1)
  })

  it('abre direto na view pedida pela querystring', async () => {
    renderAt('calendar')
    // No Calendário a task some da lista simples de linhas — mas o cabeçalho
    // do mês aparece, confirmando que o Calendário (não o Board) renderizou.
    await screen.findByText('Nova task') // botão comum a todas as views, garante que carregou
    expect(screen.getByText('Hoje')).toBeInTheDocument() // botão "Hoje" é exclusivo do CalendarView
  })

  it('desabilita "Nova task" enquanto não há status configurado', async () => {
    vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([])
    renderAt()
    await screen.findByRole('button', { name: /nova task/i })
    expect(screen.getByRole('button', { name: /nova task/i })).toBeDisabled()
  })
})

describe('ProjectTasksPage toolbar de filtros', () => {
  it('filtra tasks pelo texto de busca', async () => {
    vi.mocked(tasksService.listTasks).mockResolvedValue([
      { ...task, id: 't1', title: 'Corrigir login' },
      { ...task, id: 't2', seq: 2, title: 'Atualizar docs' },
    ] as any)

    renderAt()
    expect(await screen.findByText('Corrigir login')).toBeInTheDocument()
    expect(screen.getByText('Atualizar docs')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/buscar por id ou título/i), { target: { value: 'login' } })

    expect(screen.getByText('Corrigir login')).toBeInTheDocument()
    expect(screen.queryByText('Atualizar docs')).not.toBeInTheDocument()
  })

  it('busca também pelo ID do tipo (bug-7 acha BUG-7)', async () => {
    vi.mocked(tasksService.listTasks).mockResolvedValue([
      { ...task, id: 't1', key: 'BUG-7', title: 'Corrigir login' },
      { ...task, id: 't2', seq: 2, key: 'FEAT-1', title: 'Atualizar docs' },
    ] as any)
    renderAt()
    expect(await screen.findByText('Corrigir login')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/buscar por id ou título/i), { target: { value: 'bug-7' } })
    expect(screen.getByText('Corrigir login')).toBeInTheDocument()
    expect(screen.queryByText('Atualizar docs')).not.toBeInTheDocument()
  })

  it('na Lista, o checkbox do status seleciona todas dele e a edição em massa envia o lote', async () => {
    vi.mocked(tasksService.listTasks).mockResolvedValue([
      { ...task, id: 't1', key: 'TASK-1', title: 'Uma' },
      { ...task, id: 't2', seq: 2, key: 'TASK-2', title: 'Duas' },
    ] as any)
    vi.mocked(projectsService.listTags).mockResolvedValue([])
    vi.mocked(projectsService.listTaskTypes).mockResolvedValue([])
    vi.mocked(projectsService.bulkAction).mockResolvedValue({ succeeded: ['t1', 't2'], failed: [] })

    renderAt('list')
    expect(await screen.findByText('Uma')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /edição em massa/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Selecionar todas as 2 tasks de A Fazer'))
    expect(await screen.findByRole('region', { name: /edição em massa/i })).toBeInTheDocument()
    expect(screen.getByText('2 selecionadas')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Ação em massa'), { target: { value: 'due_date' } })
    fireEvent.change(screen.getByLabelText('Como mudar a data'), { target: { value: 'shift' } })
    fireEvent.change(screen.getByLabelText('Dias (negativo antecipa)'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /aplicar em 2/i }))

    await vi.waitFor(() => expect(projectsService.bulkAction).toHaveBeenCalledWith('p1', { taskIds: ['t1', 't2'], action: 'due_date', shiftDays: 3 }))
  })

  it('troca agrupamento ao selecionar "Prioridade"', async () => {
    renderAt()
    await screen.findByText('Tarefa 1')

    fireEvent.change(screen.getByLabelText(/agrupar por/i), { target: { value: 'priority' } })

    expect((screen.getByLabelText(/agrupar por/i) as HTMLSelectElement).value).toBe('priority')
  })
})

describe('ProjectTasksPage — mover e carregar', () => {
  const doing = { ...status, id: 's2', name: 'Fazendo', category: 'in_progress' as const, position: 1 }
  const tagged = {
    ...task, key: 'TASK-1', title: 'Com tag',
    tags: [{ taskId: 't1', tagId: 'tg1', tag: { id: 'tg1', projectId: 'p1', name: 'Urgente', color: '#ef4444' } }],
    commentsCount: 3,
  }

  it('mover não perde as relações do card (a resposta do PATCH vem sem tags)', async () => {
    vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([status, doing] as any)
    vi.mocked(tasksService.listTasks).mockResolvedValue([tagged] as any)
    // Resposta crua do backend: sem tags/contadores.
    vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, statusId: 's2' } as any)

    renderAt('list')
    expect(await screen.findByText('Urgente')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Avançar para Fazendo' }))

    await waitFor(() => expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 't1', { statusId: 's2' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Status: Fazendo/ })).toBeInTheDocument())
    expect(screen.getByText('Urgente')).toBeInTheDocument()
  })

  it('falha ao carregar mostra erro com "Tentar novamente" (não um board vazio)', async () => {
    vi.mocked(tasksService.listTasks).mockRejectedValueOnce({ response: { data: { error: 'Projeto indisponível.' } } })
    renderAt()
    expect(await screen.findByText('Não foi possível carregar as tasks')).toBeInTheDocument()
    expect(screen.getByText('Projeto indisponível.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByText('Tarefa 1')).toBeInTheDocument()
  })

  it('?list= mostra só as tasks daquela lista', async () => {
    vi.mocked(tasksService.listTasks).mockResolvedValue([
      { ...task, id: 't1', listId: 'l1', title: 'Na lista' },
      { ...task, id: 't2', seq: 2, listId: null, title: 'Fora da lista' },
    ] as any)
    vi.mocked(projectsService.listLists).mockResolvedValue([{ id: 'l1', name: 'Sprint Backlog' }] as any)
    render(
      <MemoryRouter initialEntries={['/projetos/p1/tasks?view=list&list=l1']}>
        <Routes><Route path="/projetos/:projectId/tasks" element={<ProjectTasksPage />} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('Na lista')).toBeInTheDocument()
    expect(screen.queryByText('Fora da lista')).not.toBeInTheDocument()
    expect(await screen.findByText(/Lista: Sprint Backlog/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mostrar todas as listas/i }))
    expect(await screen.findByText('Fora da lista')).toBeInTheDocument()
  })
})
