import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ListView } from './ListView'
import { ProjectStatus, Task } from '@/types/projects'

const statuses: ProjectStatus[] = [
  { id: 's1', projectId: 'p1', name: 'A Fazer', color: '#94a3b8', category: 'open', position: 0, isActive: true, requiresApproval: false },
  { id: 's2', projectId: 'p1', name: 'Em Progresso', color: '#f59e0b', category: 'in_progress', position: 1, isActive: true, requiresApproval: false },
]
const done: ProjectStatus = { id: 's3', projectId: 'p1', name: 'Concluído', color: '#22c55e', category: 'done', position: 2, isActive: true, requiresApproval: false }

function makeTask(id: string, statusId: string, title: string): Task {
  return {
    id, projectId: 'p1', listId: null, statusId, parentId: null, seq: 1, title,
    description: null, priority: 'none', assigneeId: null, creatorId: 'u1',
    startDate: null, dueDate: null, isMilestone: false, archivedAt: null,
  }
}

describe('ListView', () => {
  beforeEach(() => localStorage.clear())

  describe('ordenação', () => {
    const task = (id: string, extra: Partial<Task>) => ({ ...makeTask(id, 's1', `Tarefa ${id}`), ...extra })
    const titulos = () => screen.getAllByText(/^Tarefa /).map((el) => el.textContent)
    const ordenar = (nome: string) => fireEvent.click(screen.getByRole('button', { name: nome }))

    const tasks = [
      task('B', { seq: 2, priority: 'low', dueDate: '2026-11-20T00:00:00.000Z' }),
      task('C', { seq: 3, priority: 'none', dueDate: null }),
      task('A', { seq: 1, priority: 'critical', dueDate: '2026-11-10T00:00:00.000Z' }),
    ]

    it('sem ordenação, mantém a ordem recebida', () => {
      render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)
      expect(titulos()).toEqual(['Tarefa B', 'Tarefa C', 'Tarefa A'])
    })

    it('alterna crescente, decrescente e volta à ordem do projeto', () => {
      render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)
      ordenar('ID')
      expect(titulos()).toEqual(['Tarefa A', 'Tarefa B', 'Tarefa C'])
      ordenar('ID')
      expect(titulos()).toEqual(['Tarefa C', 'Tarefa B', 'Tarefa A'])
      ordenar('ID')
      expect(titulos()).toEqual(['Tarefa B', 'Tarefa C', 'Tarefa A'])
    })

    it('prioridade começa pela urgente e tarefa sem valor fica sempre no fim', () => {
      render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)
      ordenar('Prioridade')
      expect(titulos()).toEqual(['Tarefa A', 'Tarefa B', 'Tarefa C'])
      ordenar('Prazo')
      ordenar('Prazo')
      expect(titulos()).toEqual(['Tarefa B', 'Tarefa A', 'Tarefa C'])
    })

    it('ordena dentro de cada status, sem misturar os grupos', () => {
      const dois = [task('Z', { seq: 9 }), { ...task('Y', { seq: 8 }), statusId: 's2' }, task('X', { seq: 1 })]
      render(<ListView statuses={statuses} tasks={dois} onOpenTask={vi.fn()} />)
      ordenar('ID')
      expect(titulos()).toEqual(['Tarefa X', 'Tarefa Z', 'Tarefa Y'])
    })

    it('lembra a escolha do projeto ao voltar', () => {
      const { unmount } = render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)
      ordenar('ID')
      unmount()
      render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)
      expect(titulos()).toEqual(['Tarefa A', 'Tarefa B', 'Tarefa C'])
    })

    it('ignora valor salvo inválido', () => {
      localStorage.setItem('projetos:lista-ordem:p1', '{"key":"inexistente","dir":1}')
      render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)
      expect(titulos()).toEqual(['Tarefa B', 'Tarefa C', 'Tarefa A'])
    })
  })

  it('agrupa as tasks por status, cada uma sob seu cabeçalho', async () => {
    const tasks = [makeTask('t1', 's1', 'Tarefa A'), makeTask('t2', 's2', 'Tarefa B')]
    render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)

    // Cada nome aparece no cabeçalho do grupo e na etiqueta de status da linha.
    expect(await screen.findAllByText('A Fazer')).toHaveLength(2)
    expect(screen.getAllByText('Em Progresso')).toHaveLength(2)
    expect(screen.getByText('Tarefa A')).toBeInTheDocument()
    expect(screen.getByText('Tarefa B')).toBeInTheDocument()
  })

  it('coluna Resp. mostra a foto de todos os responsáveis, principal primeiro', async () => {
    const task = {
      ...makeTask('t1', 's1', 'Tarefa A'), assigneeId: 'u3',
      multiAssignees: [
        { taskId: 't1', userId: 'u2', user: { id: 'u2', name: 'Ana Silva', avatar: null } },
        { taskId: 't1', userId: 'u3', user: { id: 'u3', name: 'Bruno Costa', avatar: null } },
      ],
    }
    render(<ListView statuses={statuses} tasks={[task]} onOpenTask={vi.fn()} />)

    expect(await screen.findByRole('img', { name: 'Responsáveis: Bruno Costa, Ana Silva' })).toBeInTheDocument()
  })

  it('recolhe e expande um grupo de status ao clicar no cabeçalho', async () => {
    const tasks = [makeTask('t1', 's1', 'Tarefa A')]
    render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)

    expect(await screen.findByText('Tarefa A')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^A Fazer/ }))
    expect(screen.queryByText('Tarefa A')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^A Fazer/ }))
    expect(screen.getByText('Tarefa A')).toBeInTheDocument()
  })

  it('chama onOpenTask ao clicar numa linha', async () => {
    const onOpenTask = vi.fn()
    render(<ListView statuses={statuses} tasks={[makeTask('t1', 's1', 'Tarefa A')]} onOpenTask={onOpenTask} />)

    fireEvent.click(await screen.findByText('Tarefa A'))
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })

  it('renderiza corretamente data de início, prazo, prioridade, tags e marco', async () => {
    const richTask: Task = {
      ...makeTask('t3', 's1', 'Tarefa Completa'),
      priority: 'critical',
      startDate: '2026-09-10T10:00:00Z',
      dueDate: '2026-09-25T18:00:00Z',
      isMilestone: true,
      tags: [
        { taskId: 't3', tagId: 'tag1', tag: { id: 'tag1', projectId: 'p1', name: 'Frontend', color: '#6366f1' } },
        { taskId: 't3', tagId: 'tag2', tag: { id: 'tag2', projectId: 'p1', name: 'UI/UX', color: '#10b981' } },
      ],
    }

    render(<ListView statuses={statuses} tasks={[richTask]} onOpenTask={vi.fn()} />)

    expect(await screen.findByText('Tarefa Completa')).toBeInTheDocument()
    expect(screen.getByText('Urgente')).toBeInTheDocument()
    expect(screen.getByLabelText('Marco')).toBeInTheDocument()
    expect(screen.getByText('Frontend')).toBeInTheDocument()
    expect(screen.getByText('UI/UX')).toBeInTheDocument()
    expect(screen.getByText('Demanda')).toBeInTheDocument()
    expect(screen.getByText('Início')).toBeInTheDocument()
    expect(screen.getByText('Prazo')).toBeInTheDocument()
  })

  it('etiqueta de status: seta avança para o próximo; nome abre a lista para escolher', async () => {
    const onStatusChange = vi.fn()
    render(<ListView statuses={statuses} tasks={[makeTask('t1', 's1', 'Tarefa A')]} onOpenTask={vi.fn()} onStatusChange={onStatusChange} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Avançar para Em Progresso' }))
    expect(onStatusChange).toHaveBeenCalledWith('t1', 's2')

    fireEvent.click(screen.getByRole('button', { name: 'Status: A Fazer. Alterar status' }))
    fireEvent.click(screen.getByRole('option', { name: 'Em Progresso' }))
    expect(onStatusChange).toHaveBeenCalledTimes(2)
  })

  it('sem onStatusChange a etiqueta é só leitura (sem seta)', async () => {
    render(<ListView statuses={statuses} tasks={[makeTask('t1', 's1', 'Tarefa A')]} onOpenTask={vi.fn()} />)
    await screen.findByText('Tarefa A')
    expect(screen.queryByRole('button', { name: /Avançar para/ })).not.toBeInTheDocument()
  })

  it('grupos concluídos começam recolhidos; os demais abertos', async () => {
    const tasks = [makeTask('t1', 's1', 'Tarefa A'), makeTask('t3', 's3', 'Tarefa Feita')]
    render(<ListView statuses={[...statuses, done]} tasks={tasks} onOpenTask={vi.fn()} />)

    expect(await screen.findByText('Tarefa A')).toBeInTheDocument()
    expect(screen.queryByText('Tarefa Feita')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Concluído/ })).toHaveAttribute('aria-expanded', 'false')
    // Grupo vazio fica recolhido e inerte.
    expect(screen.getByRole('button', { name: /^Em Progresso/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /^Concluído/ }))
    expect(screen.getByText('Tarefa Feita')).toBeInTheDocument()
  })

  it('Expandir tudo / Recolher tudo', async () => {
    const tasks = [makeTask('t1', 's1', 'Tarefa A'), makeTask('t3', 's3', 'Tarefa Feita')]
    render(<ListView statuses={[...statuses, done]} tasks={tasks} onOpenTask={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Expandir tudo' }))
    expect(screen.getByText('Tarefa A')).toBeInTheDocument()
    expect(screen.getByText('Tarefa Feita')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher tudo' }))
    expect(screen.queryByText('Tarefa A')).not.toBeInTheDocument()
    expect(screen.queryByText('Tarefa Feita')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expandir tudo' })).toBeInTheDocument()
  })

  it('persiste o estado aberto/fechado por projeto no localStorage', async () => {
    const tasks = [makeTask('t1', 's1', 'Tarefa A')]
    const { unmount } = render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^A Fazer/ }))
    expect(JSON.parse(localStorage.getItem('projetos:lista-grupos:p1')!)).toEqual({ s1: false })
    unmount()

    render(<ListView statuses={statuses} tasks={tasks} onOpenTask={vi.fn()} />)
    expect(screen.queryByText('Tarefa A')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^A Fazer/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('sem localStorage disponível a lista funciona (só não persiste)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    render(<ListView statuses={statuses} tasks={[makeTask('t1', 's1', 'Tarefa A')]} onOpenTask={vi.fn()} />)
    expect(await screen.findByText('Tarefa A')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^A Fazer/ }))
    expect(screen.queryByText('Tarefa A')).not.toBeInTheDocument()
    spy.mockRestore(); set.mockRestore()
  })

  it('ação rápida Abrir abre a task sem depender do clique na linha', async () => {
    const onOpenTask = vi.fn()
    render(<ListView statuses={statuses} tasks={[makeTask('t1', 's1', 'Tarefa A')]} onOpenTask={onOpenTask} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Abrir / }))
    expect(onOpenTask).toHaveBeenCalledTimes(1)
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })
})
