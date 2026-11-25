import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoardView } from './BoardView'

const statuses = [
  { id: 's1', projectId: 'p1', name: 'A Fazer', color: '#94a3b8', category: 'open' as const, position: 0, isActive: true, requiresApproval: false },
  { id: 's2', projectId: 'p1', name: 'Em Progresso', color: '#3b82f6', category: 'in_progress' as const, position: 1, isActive: true, requiresApproval: false },
]

const tasks = [
  { id: 't1', projectId: 'p1', listId: null, statusId: 's1', parentId: null, seq: 1, title: 'Tarefa 1', description: null, priority: 'high' as const, assigneeId: null, creatorId: 'u1', startDate: null, dueDate: null, isMilestone: false, archivedAt: null },
  { id: 't2', projectId: 'p1', listId: null, statusId: 's2', parentId: null, seq: 2, title: 'Tarefa 2', description: null, priority: 'none' as const, assigneeId: null, creatorId: 'u1', startDate: null, dueDate: null, isMilestone: true, archivedAt: null },
]

describe('BoardView', () => {
  it('agrupa as tasks por status em colunas', () => {
    render(<BoardView statuses={statuses} tasks={tasks} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByText('A Fazer')).toBeInTheDocument()
    expect(screen.getByText('Em Progresso')).toBeInTheDocument()
    expect(screen.getByText('Tarefa 1')).toBeInTheDocument()
    expect(screen.getByText('Tarefa 2')).toBeInTheDocument()
  })

  it('chama onOpenTask ao clicar num card', () => {
    const onOpenTask = vi.fn()
    render(<BoardView statuses={statuses} tasks={tasks} onOpenTask={onOpenTask} onMoveTask={() => {}} />)
    fireEvent.click(screen.getByText('Tarefa 1'))
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })

  it('mostra o contador de tasks por coluna', () => {
    render(<BoardView statuses={statuses} tasks={tasks} onOpenTask={() => {}} onMoveTask={() => {}} />)
    // Cada coluna tem exatamente 1 task no fixture.
    expect(screen.getAllByText('1')).toHaveLength(2)
  })
})

describe('BoardView card metadata', () => {
  it('renderiza chips de tag quando a task tem tags', () => {
    const tasksWithTags = [{
      ...tasks[0],
      tags: [{ taskId: 't1', tagId: 'tag1', tag: { id: 'tag1', projectId: 'p1', name: 'bug', color: '#dc2626' } }],
    }]
    render(<BoardView statuses={statuses} tasks={tasksWithTags} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByText('bug')).toBeInTheDocument()
  })

  it('renderiza contagem de subtarefas e comentários quando presentes', () => {
    const tasksWithCounts = [{ ...tasks[0], subtasksCount: 3, commentsCount: 5 }]
    render(<BoardView statuses={statuses} tasks={tasksWithCounts} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByTitle('Subtarefas')).toHaveTextContent('3')
    expect(screen.getByTitle('Comentários')).toHaveTextContent('5')
  })

  it('renderiza avatar-stack quando há múltiplos assignees', () => {
    const tasksWithAssignees = [{
      ...tasks[0],
      multiAssignees: [
        { taskId: 't1', userId: 'u2', user: { id: 'u2', name: 'Ana Silva', avatar: null } },
        { taskId: 't1', userId: 'u3', user: { id: 'u3', name: 'Bruno Costa', avatar: null } },
      ],
    }]
    render(<BoardView statuses={statuses} tasks={tasksWithAssignees} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByRole('img', { name: 'Responsáveis: Ana Silva, Bruno Costa' })).toBeInTheDocument()
  })

  it('renderiza ícone de bloqueio quando a task depende de outra', () => {
    const tasksBlocked = [{ ...tasks[0], blockedBy: [{ id: 'd1', taskId: 't1', dependsOnId: 't2' }] }]
    render(<BoardView statuses={statuses} tasks={tasksBlocked} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByTitle(/Bloqueada por 1 tarefa/i)).toBeInTheDocument()
  })

  it('agrupa por assignee quando groupBy="assignee"', () => {
    const tasksByAssignee = [
      { ...tasks[0], id: 't1', title: 'Task de Ana', assigneeId: 'u2' },
      { ...tasks[0], id: 't2', title: 'Task sem responsável', assigneeId: null },
    ]
    const members = [
      { userId: 'u2', projectId: 'p1', role: 'member' as const, user: { id: 'u2', name: 'Ana Silva', avatar: null, role: 'agent' } },
    ]
    render(<BoardView statuses={statuses} tasks={tasksByAssignee} onOpenTask={() => {}} onMoveTask={() => {}} members={members} groupBy="assignee" />)
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.getByText('Sem responsável')).toBeInTheDocument()
  })

  it('aplica padding reduzido quando density="compact"', () => {
    const { container } = render(<BoardView statuses={statuses} tasks={[tasks[0]]} onOpenTask={() => {}} onMoveTask={() => {}} density="compact" />)
    const card = container.querySelector('[data-testid="task-card"]') as HTMLElement
    expect(card.style.padding).toBe('8px 0px')
  })

  it('o ID diz o tipo da tarefa quando presente', () => {
    const tasksWithType = [{
      ...tasks[0],
      taskType: { id: 'tt-1', projectId: 'p1', name: 'Bug', icon: 'Bug', color: '#dc2626', position: 0, prefix: 'BUG', nextNumber: 1 },
    }]
    render(<BoardView statuses={statuses} tasks={tasksWithType} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByTitle('Bug')).toBeInTheDocument()
  })

  it('não renderiza ícone de tipo quando a task não tem taskType', () => {
    render(<BoardView statuses={statuses} tasks={[tasks[0]]} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.queryByTitle('Bug')).not.toBeInTheDocument()
  })

  it('renderiza o badge de story points quando presente', () => {
    const tasksWithPoints = [{ ...tasks[0], storyPoints: 5 }]
    render(<BoardView statuses={statuses} tasks={tasksWithPoints} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByTitle('5 story points')).toBeInTheDocument()
  })

  it('não renderiza badge de story points quando ausente', () => {
    render(<BoardView statuses={statuses} tasks={[tasks[0]]} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.queryByTitle(/story points/i)).not.toBeInTheDocument()
  })
})

describe('BoardView WIP limit', () => {
  const statusWithLimit = [
    { id: 's1', projectId: 'p1', name: 'Em Progresso', color: '#3b82f6', category: 'in_progress' as const, position: 0, isActive: true, requiresApproval: false, wipLimit: 1 },
  ]

  it('mostra "N / limite" em cor de alerta quando a coluna excede o WIP limit', () => {
    const twoTasks = [
      { ...tasks[0], id: 't1', statusId: 's1' },
      { ...tasks[0], id: 't2', statusId: 's1' },
    ]
    render(<BoardView statuses={statusWithLimit} tasks={twoTasks} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByText('2 / 1')).toBeInTheDocument()
  })

  it('não mostra alerta quando a coluna está dentro do limite', () => {
    const oneTask = [{ ...tasks[0], id: 't1', statusId: 's1' }]
    render(<BoardView statuses={statusWithLimit} tasks={oneTask} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.queryByText('2 / 1')).not.toBeInTheDocument()
  })
})

describe('BoardView agrupamento por sprint', () => {
  const sprints = [
    { id: 'sp-1', projectId: 'p1', name: 'Sprint 1', status: 'active' as const, startDate: null, endDate: null, position: 0 },
  ]

  it('agrupa por sprint quando groupBy="sprint", incluindo bucket "Sem sprint"', () => {
    const tasksInSprint = [
      { ...tasks[0], id: 't1', title: 'Task na sprint', sprintId: 'sp-1' },
      { ...tasks[0], id: 't2', title: 'Task solta', sprintId: null },
    ]
    render(<BoardView statuses={statuses} tasks={tasksInSprint} onOpenTask={() => {}} onMoveTask={() => {}} sprints={sprints} groupBy="sprint" />)
    expect(screen.getByText('Sprint 1')).toBeInTheDocument()
    expect(screen.getByText('Sem sprint')).toBeInTheDocument()
    expect(screen.getByText('Task na sprint')).toBeInTheDocument()
    expect(screen.getByText('Task solta')).toBeInTheDocument()
  })
})
