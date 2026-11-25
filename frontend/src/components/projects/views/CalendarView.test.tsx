import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CalendarView } from './CalendarView'

const status = { id: 's1', projectId: 'p1', name: 'A Fazer', color: '#94a3b8', category: 'open' as const, position: 0, isActive: true, requiresApproval: false }
const statusById = new Map([['s1', status]])

const today = new Date()
const todayISO = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).toISOString()

const tasks = [
  { id: 't1', projectId: 'p1', listId: null, statusId: 's1', parentId: null, seq: 1, title: 'Tarefa de hoje', description: null, priority: 'none' as const, assigneeId: null, creatorId: 'u1', startDate: null, dueDate: todayISO, isMilestone: false, archivedAt: null },
]

describe('CalendarView', () => {
  it('mostra o mês atual e a task no dia certo', () => {
    render(<CalendarView tasks={tasks} statusById={statusById} onOpenTask={() => {}} onMoveTask={() => {}} />)
    expect(screen.getByText(/Tarefa de hoje/)).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()
  })

  it('navega para o mês anterior e seguinte', () => {
    render(<CalendarView tasks={tasks} statusById={statusById} onOpenTask={() => {}} onMoveTask={() => {}} />)
    const currentLabel = today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    expect(screen.getByText(currentLabel)).toBeInTheDocument()
  })

  it('chama onOpenTask ao clicar numa task do calendário', () => {
    const onOpenTask = vi.fn()
    render(<CalendarView tasks={tasks} statusById={statusById} onOpenTask={onOpenTask} onMoveTask={() => {}} />)
    fireEvent.click(screen.getByText(/Tarefa de hoje/))
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })
})
