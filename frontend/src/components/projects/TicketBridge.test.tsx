import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TicketProjectLink, CreateTaskFromTicketModal, LinkTicketToTaskModal, canOfferTaskLink, isForecastOverdue } from './TicketProjectLink'
import { TaskTicketsSection, splitTicketRefs } from './TaskTicketsSection'
import * as projectsService from '@/services/projectsService'
import { toast } from '@/store/toastStore'

vi.mock('@/services/projectsService', () => ({
  listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Inovação' }]),
  listProjectStatuses: vi.fn().mockResolvedValue([{ id: 's-open', category: 'open' }, { id: 's-done', category: 'done' }, { id: 's-cancel', category: 'cancelled' }]),
  listTaskTypes: vi.fn().mockResolvedValue([{ id: 'tt1', name: 'Bug', prefix: 'BUG', nextNumber: 7 }]),
  listMembers: vi.fn().mockResolvedValue([{ userId: 'u1', role: 'member', user: { id: 'u1', name: 'Daniel' } }]),
  createTaskFromTicket: vi.fn().mockResolvedValue({ task: { id: 't1' } }),
  linkTicketToTask: vi.fn(),
  unlinkTicketFromTask: vi.fn(),
  listTaskTickets: vi.fn().mockResolvedValue([]),
  linkTicketsBulk: vi.fn(),
}))
vi.mock('@/services/tasksService', () => ({ listTasks: vi.fn().mockResolvedValue([
  { id: 't-open', key: 'BUG-1', title: 'Aberta', statusId: 's-open', archivedAt: null, dueDate: '2099-01-01T12:00:00.000Z' },
  { id: 't-done', key: 'BUG-2', title: 'Concluída', statusId: 's-done', archivedAt: null, dueDate: '2099-01-01T12:00:00.000Z' },
  { id: 't-cancel', key: 'BUG-3', title: 'Cancelada', statusId: 's-cancel', archivedAt: null, dueDate: '2099-01-01T12:00:00.000Z' },
  { id: 't-arch', key: 'BUG-4', title: 'Arquivada', statusId: 's-open', archivedAt: '2026-01-01T00:00:00.000Z', dueDate: '2099-01-01T12:00:00.000Z' },
]) }))
vi.mock('@/services/ticketService', () => ({ ticketService: { getTicket: vi.fn().mockResolvedValue({ id: 'tk1' }) } }))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const ticket = { id: 'tk1', title: 'Erro ao exportar relatório', status: 'in_progress', pendingReason: null, project_task: null } as any

beforeEach(() => vi.clearAllMocks())

describe('criar task a partir do chamado', () => {
  it('exige projeto, tipo e prazo; cria com o título do chamado e o prazo ao meio-dia UTC', async () => {
    const onCreated = vi.fn()
    render(<CreateTaskFromTicketModal ticket={ticket} onClose={vi.fn()} onCreated={onCreated} />)
    const submit = screen.getByText('Criar e vincular').closest('button')!
    expect(submit.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Projeto'))
    fireEvent.click(await screen.findByRole('option', { name: 'Inovação' }))
    await screen.findByRole('option', { name: 'BUG · Bug' }, { timeout: 4000 })
    fireEvent.change(screen.getByLabelText('Tipo da task'), { target: { value: 'tt1' } })
    expect(screen.getByText('O ID será gerado automaticamente: BUG-7')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Prazo da task'), { target: { value: '2099-12-20' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => expect(projectsService.createTaskFromTicket).toHaveBeenCalledWith('p1', {
      ticket: 'tk1', title: 'Erro ao exportar relatório', taskTypeId: 'tt1', dueDate: '2099-12-20T12:00:00.000Z', assigneeId: null,
    }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })

  it('não deixa escolher prazo vencido', async () => {
    render(<CreateTaskFromTicketModal ticket={ticket} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Projeto'))
    fireEvent.click(await screen.findByRole('option', { name: 'Inovação' }))
    fireEvent.change(screen.getByLabelText('Prazo da task'), { target: { value: '2020-01-01' } })
    expect(screen.getByRole('alert').textContent).toMatch(/prazo já passou/)
  })

  it('sem task vinculada o card Projeto não aparece; criar/vincular só com módulo e chamado ativo', () => {
    const { container } = render(<TicketProjectLink ticket={ticket} canUseProjects onChanged={vi.fn()} />)
    expect(container.textContent).toBe('')
    expect(canOfferTaskLink(ticket, true)).toBe(true)
    expect(canOfferTaskLink(ticket, false)).toBe(false)
    expect(canOfferTaskLink({ ...ticket, status: 'resolved' }, true)).toBe(false)
    expect(canOfferTaskLink({ ...ticket, status: 'pending', pendingReason: 'pending_project' }, true)).toBe(false)
  })

  it('chamado em projeto com previsão passada mostra o selo e a orientação', () => {
    const linked = { ...ticket, status: 'pending', pendingReason: 'pending_project', project_task: { id: 't1', project_id: 'p1', key: 'BUG-3', title: 'Corrigir', due_date: '2020-01-10T12:00:00.000Z', project: { name: 'Inovação' }, status: { name: 'Em andamento', category: 'in_progress' } } }
    render(<MemoryRouter><TicketProjectLink ticket={linked} canUseProjects onChanged={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('Previsão vencida')).toBeTruthy()
    expect(screen.getByText(/previsão 10\/01\/2020/)).toBeTruthy()
  })
})

describe('vincular o chamado a uma task', () => {
  it('lista só tasks abertas: concluída, cancelada e arquivada ficam de fora', async () => {
    render(<LinkTicketToTaskModal ticketId="tk1" onClose={vi.fn()} onLinked={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Projeto'))
    fireEvent.click(await screen.findByRole('option', { name: 'Inovação' }))
    await waitFor(() => expect(screen.getByLabelText('Task')).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('Task'))
    expect(await screen.findByRole('option', { name: /BUG-1 Aberta/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Concluída|Cancelada|Arquivada/ })).toBeNull()
  })
})

describe('vincular vários chamados à task', () => {
  it('separa os números, vincula em lote e deixa no campo só os que falharam', async () => {
    vi.mocked(projectsService.linkTicketsBulk).mockResolvedValue({
      linked: ['ISA-1'], failed: [{ ref: 'ISA-9', error: 'Chamado não encontrado' }],
      tickets: [{ id: 'a', displayNumber: 'ISA-1', title: 'A', status: 'pending', pendingReason: 'pending_project', slaDeadline: '', org: null }],
    })
    render(<TaskTicketsSection projectId="p1" taskId="t1" hasDueDate canEdit />)
    fireEvent.change(screen.getByLabelText('Números dos chamados'), { target: { value: 'ISA-1, ISA-9' } })
    fireEvent.click(screen.getByText('Vincular 2'))
    await waitFor(() => expect(projectsService.linkTicketsBulk).toHaveBeenCalledWith('p1', 't1', ['ISA-1', 'ISA-9']))
    expect(await screen.findByText('ISA-9 — Chamado não encontrado')).toBeTruthy()
    expect((screen.getByLabelText('Números dos chamados') as HTMLInputElement).value).toBe('ISA-9')
    expect(screen.getByText('ISA-1')).toBeTruthy()
  })
})

describe('conclusão da task', () => {
  it('ao mudar o status, recarrega os chamados e avisa os que foram resolvidos', async () => {
    const t = (status: string) => ({ id: 'a', displayNumber: 'INC-1', title: 'A', status, pendingReason: status === 'pending' ? 'pending_project' : null, slaDeadline: '', org: null })
    vi.mocked(projectsService.listTaskTickets).mockResolvedValueOnce([t('pending')] as any).mockResolvedValueOnce([t('resolved')] as any)
    const { rerender } = render(<TaskTicketsSection projectId="p1" taskId="t1" hasDueDate canEdit refreshKey="s-open" />)
    expect(await screen.findByText('Em projeto')).toBeTruthy()
    rerender(<TaskTicketsSection projectId="p1" taskId="t1" hasDueDate canEdit refreshKey="s-done" />)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Chamado INC-1 resolvido com a conclusão da task.'))
    expect(screen.queryByText('Em projeto')).toBeNull()
  })
})

describe('utilitários da ponte', () => {
  it('splitTicketRefs aceita vírgula, espaço, ponto e vírgula e quebra de linha, sem repetir', () => {
    expect(splitTicketRefs('ISA-1, ISA-2;ISA-3\nISA-1  ')).toEqual(['ISA-1', 'ISA-2', 'ISA-3'])
  })
  it('isForecastOverdue compara só o dia', () => {
    const now = new Date(2026, 9, 9, 10)
    expect(isForecastOverdue('2026-10-09T00:00:00.000Z', now)).toBe(false)
    expect(isForecastOverdue('2026-10-08T12:00:00.000Z', now)).toBe(true)
    expect(isForecastOverdue(null, now)).toBe(false)
  })
})
