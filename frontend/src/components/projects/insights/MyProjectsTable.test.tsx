import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MyProjectsTable } from './MyProjectsTable'

const renderIt = (props: Parameters<typeof MyProjectsTable>[0]) => render(<MemoryRouter><MyProjectsTable {...props} /></MemoryRouter>)

describe('MyProjectsTable', () => {
  it('uma linha por projeto com abertas, concluídas, atrasadas, ciclo e membros', () => {
    renderIt({
      days: 90,
      rows: [
        { id: 'p1', name: 'Atlas', color: '#2563eb', openTasks: 5, doneTasks: 12, overdueTasks: 2, avgCycleHours: 7.5, membersCount: 4 },
        { id: 'p2', name: 'Portal', color: null, openTasks: 1, doneTasks: 0, overdueTasks: 0, avgCycleHours: null, membersCount: 2 },
      ],
    })
    const rows = within(screen.getByRole('table', { name: 'Meus projetos' })).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Atlas', '5', '12', '2', '7,5 h', '4', 'Visão geral'])
    expect(within(rows[2]).getAllByRole('cell')[4].textContent).toBe('—')
  })

  it('sem projetos geridos e com erro, mensagens claras', () => {
    const { unmount } = renderIt({ days: 90, rows: [] })
    expect(screen.getByText('Você ainda não é dono nem gerente de nenhum projeto ativo.')).toBeTruthy()
    unmount()
    renderIt({ days: 90, rows: null, error: true })
    expect(screen.getByText(/Não foi possível carregar os seus projetos/)).toBeTruthy()
  })
})
