import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { TaskDrawerHost } from './TaskDrawerHost'
import { useProjectRole } from './projectRole'
import { DrillProvider } from './drill/DrillProvider'
import { useDrill } from './drill/drillContext'
import MyTasksPage from '@/pages/projects/MyTasksPage'
import MyAreaPage from '@/pages/projects/MyAreaPage'
import api from '@/services/api'
import * as projectsService from '@/services/projectsService'
import * as drillService from '@/services/drillService'

// O drawer de verdade faz uma dúzia de chamadas; aqui só importa quem abre, com que papel e como fecha.
vi.mock('./TaskDrawer', () => ({
  TaskDrawer: (props: { projectId: string; taskId: string; projectName?: string; onClose: () => void; onOpenProject?: () => void; onOpenTask?: (id: string) => void }) => {
    const { canEdit } = useProjectRole()
    return (
      <div role="dialog" aria-label="drawer da task">
        <span data-testid="drawer-task">{props.projectId}/{props.taskId}</span>
        <span data-testid="drawer-can-edit">{String(canEdit)}</span>
        <button type="button" onClick={props.onOpenProject}>{props.projectName}</button>
        <button type="button" onClick={() => props.onOpenTask?.('t2')}>Subtarefa</button>
        <button type="button" onClick={props.onClose}>Fechar drawer</button>
      </div>
    )
  },
}))
vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), put: vi.fn() },
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
}))
vi.mock('@/services/projectsService')
vi.mock('@/services/drillService', () => ({
  getProjectDrill: vi.fn(), getPersonDrill: vi.fn(), getTaskDrill: vi.fn(), getTaskListDrill: vi.fn(),
}))
vi.mock('@/components/charts/TimeSeriesChart', () => ({ TimeSeriesChart: () => null }))

const myTask = {
  id: 't1', seq: 7, key: 'BUG-7', title: 'Corrigir login', description: null, priority: 'high', statusId: 's1',
  status: { id: 's1', name: 'Backlog', color: '#999', category: 'open' }, project: { id: 'p1', name: 'Atlas' },
  tags: [], dueDate: null, startDate: null, createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z',
}

const myArea = {
  counts: { today: 0, overdue: 0, thisWeek: 0, upcoming: 0, noDueDate: 0, approvals: 0 },
  priorities: [{ id: 't1', seq: 7, key: 'BUG-7', title: 'Corrigir login', priority: 'critical', projectId: 'p1', project: { id: 'p1', name: 'Atlas' } }],
  agenda: [], recentProjects: [], recentActivity: [],
}

const taskDrill = {
  id: 't1', projectId: 'p1', project: { id: 'p1', name: 'Atlas' }, key: 'BUG-7', seq: 7, title: 'Corrigir login', description: null, priority: 'high',
  status: { id: 's1', name: 'Backlog', category: 'open', color: '#999' }, taskType: null, list: null, sprint: null, parent: null,
  assignees: [], creator: { id: 'u0', name: 'Dono' }, createdAt: '2026-10-01T12:00:00Z', startDate: null, dueDate: null,
  isMilestone: false, storyPoints: null, archivedAt: null, tags: [], checklist: [], subtasks: [], blockedBy: [], blocks: [], tickets: [], documents: [], commentsCount: 0, comments: [],
  time: null, timeline: [],
}

function Probe() {
  const { pathname, search } = useLocation()
  return <span data-testid="url">{pathname}{search}</span>
}
const url = () => screen.getByTestId('url').textContent ?? ''
const pathname = () => url().split('?')[0]
const params = () => new URLSearchParams(url().split('?')[1] ?? '')

function DrillPage() {
  const { open } = useDrill()
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => open({ kind: 'task', projectId: 'p1', taskId: 't1', title: 'BUG-7 Corrigir login' })}>Ver detalhe</button>
      <button type="button" onClick={() => navigate(-1)}>Voltar do navegador</button>
    </>
  )
}

function renderAt(entry: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TaskDrawerHost>
        <DrillProvider>
          <Routes>
            <Route path="/projetos/my-tasks" element={<MyTasksPage />} />
            <Route path="/projetos/my-area" element={<MyAreaPage />} />
            <Route path="/projetos/dashboards" element={<DrillPage />} />
            <Route path="/projetos/:projectId/tasks" element={<span>página do projeto</span>} />
          </Routes>
        </DrillProvider>
        <Probe />
      </TaskDrawerHost>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.get).mockImplementation(async (path: string) => ({ data: { data: path === '/my-tasks' ? [myTask] : [] } }) as never)
  vi.mocked(api.put).mockResolvedValue({ data: {} } as never)
  vi.mocked(projectsService.getProject).mockResolvedValue({ id: 'p1', name: 'Atlas', myRole: 'member' } as never)
  vi.mocked(projectsService.getMyArea).mockResolvedValue(myArea as never)
  vi.mocked(projectsService.getProjectsActivity).mockResolvedValue([])
  vi.mocked(projectsService.getMyCycle).mockResolvedValue({ days: 90, projects: [], current: [], recent: [] } as never)
  vi.mocked(drillService.getTaskDrill).mockResolvedValue(taskDrill as never)
})

describe('task aberta sobre a tela atual', () => {
  it('Minhas tarefas: clicar na task abre o drawer sem trocar de página, e fechar recarrega a lista', async () => {
    renderAt('/projetos/my-tasks?filter=no_due')
    fireEvent.click(await screen.findByText('Corrigir login'))

    expect(await screen.findByTestId('drawer-task')).toHaveTextContent('p1/t1')
    expect(pathname()).toBe('/projetos/my-tasks')
    expect(params().get('task')).toBe('t1')
    expect(params().get('taskProject')).toBe('p1')
    expect(screen.queryByText('página do projeto')).toBeNull()
    const loads = vi.mocked(api.get).mock.calls.filter(([p]) => p === '/my-tasks').length

    fireEvent.click(screen.getByRole('button', { name: 'Fechar drawer' }))
    await waitFor(() => expect(screen.queryByTestId('drawer-task')).toBeNull())
    expect(url()).toBe('/projetos/my-tasks?filter=no_due') // mesmo filtro de antes
    // A lista continua na tela (sem "carregando") e é buscada de novo para refletir as edições.
    expect(screen.getByText('Corrigir login')).toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([p]) => p === '/my-tasks').length).toBe(loads + 1))
  })

  it('Minha área: clicar numa prioridade abre o drawer na própria Minha área', async () => {
    renderAt('/projetos/my-area')
    fireEvent.click(await screen.findByText('Corrigir login'))

    expect(await screen.findByTestId('drawer-task')).toHaveTextContent('p1/t1')
    expect(pathname()).toBe('/projetos/my-area')
    expect(projectsService.getProject).toHaveBeenCalledWith('p1')
  })

  it('o papel no projeto da task vale dentro do drawer', async () => {
    vi.mocked(projectsService.getProject).mockResolvedValue({ id: 'p1', name: 'Atlas', myRole: 'viewer' } as never)
    renderAt('/projetos/my-area?task=t1&taskProject=p1')
    expect(await screen.findByTestId('drawer-can-edit')).toHaveTextContent('false')
  })

  it('link direto abre o drawer; fechar só tira a task da URL', async () => {
    renderAt('/projetos/my-tasks?filter=done&task=t1&taskProject=p1')
    expect(await screen.findByTestId('drawer-task')).toHaveTextContent('p1/t1')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar drawer' }))
    await waitFor(() => expect(screen.queryByTestId('drawer-task')).toBeNull())
    expect(url()).toBe('/projetos/my-tasks?filter=done')
  })

  it('trocar de task no drawer fica na mesma tela; o atalho do projeto leva à página dele', async () => {
    renderAt('/projetos/my-area?task=t1&taskProject=p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Subtarefa' }))
    await waitFor(() => expect(screen.getByTestId('drawer-task')).toHaveTextContent('p1/t2'))
    expect(pathname()).toBe('/projetos/my-area')

    fireEvent.click(screen.getByRole('button', { name: 'Atlas' }))
    expect(await screen.findByText('página do projeto')).toBeInTheDocument()
    expect(url()).toBe('/projetos/p1/tasks?task=t2')
  })

  it('"Abrir task" do modal de detalhe abre o drawer ali mesmo e, ao fechar, o modal volta', async () => {
    renderAt('/projetos/dashboards')
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhe' }))
    const detail = await screen.findByRole('dialog', { name: 'BUG-7 Corrigir login' })
    fireEvent.click(within(detail).getByRole('button', { name: 'Abrir task' }))

    expect(await screen.findByTestId('drawer-task')).toHaveTextContent('p1/t1')
    expect(pathname()).toBe('/projetos/dashboards')
    expect(screen.queryByRole('dialog', { name: 'BUG-7 Corrigir login' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar drawer' }))
    expect(await screen.findByRole('dialog', { name: 'BUG-7 Corrigir login' })).toBeInTheDocument()
    expect(pathname()).toBe('/projetos/dashboards')
    await waitFor(() => expect(drillService.getTaskDrill).toHaveBeenCalledTimes(2)) // recarregou o detalhe
  })

  it('o voltar do navegador fecha o drawer sem sair da tela', async () => {
    renderAt('/projetos/dashboards')
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhe' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'BUG-7 Corrigir login' })).getByRole('button', { name: 'Abrir task' }))
    expect(await screen.findByTestId('drawer-task')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Voltar do navegador' }))
    await waitFor(() => expect(screen.queryByTestId('drawer-task')).toBeNull())
    expect(url()).toBe('/projetos/dashboards')
    expect(await screen.findByRole('dialog', { name: 'BUG-7 Corrigir login' })).toBeInTheDocument()
  })
})
