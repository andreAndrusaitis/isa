import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskTypeManager } from './TaskTypeManager'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

const storyType = { id: 'tt-1', projectId: 'p1', name: 'Story', icon: 'BookmarkCheck', color: '#16a34a', position: 0, prefix: 'US', nextNumber: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(projectsService.listTaskTypes).mockResolvedValue([storyType])
})

describe('TaskTypeManager', () => {
  it('lista os tipos existentes', async () => {
    render(<TaskTypeManager projectId="p1" />)
    expect(await screen.findByText('Story')).toBeInTheDocument()
  })

  it('cria um novo tipo', async () => {
    const created = { id: 'tt-2', projectId: 'p1', name: 'Bug', icon: 'Bug', color: '#dc2626', position: 1, prefix: 'BUG', nextNumber: 1 }
    vi.mocked(projectsService.createTaskType).mockResolvedValue(created)

    render(<TaskTypeManager projectId="p1" />)
    await screen.findByText('Story')

    fireEvent.click(screen.getByRole('button', { name: /novo tipo/i }))
    fireEvent.change(screen.getByPlaceholderText(/bug/i), { target: { value: 'Bug' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar$/i }))

    await waitFor(() => expect(projectsService.createTaskType).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Bug' })))
    expect(await screen.findByText('Bug')).toBeInTheDocument()
  })

  it('edita um tipo existente', async () => {
    const updated = { ...storyType, name: 'User Story' }
    vi.mocked(projectsService.updateTaskType).mockResolvedValue(updated)

    render(<TaskTypeManager projectId="p1" />)
    fireEvent.click(await screen.findByTitle(/editar story/i))

    const nameInput = screen.getByDisplayValue('Story')
    fireEvent.change(nameInput, { target: { value: 'User Story' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() => expect(projectsService.updateTaskType).toHaveBeenCalledWith('p1', 'tt-1', expect.objectContaining({ name: 'User Story' })))
    expect(await screen.findByText('User Story')).toBeInTheDocument()
  })

  it('exclui um tipo movendo as tasks para o tipo escolhido', async () => {
    vi.mocked(projectsService.listTaskTypes).mockResolvedValue([
      storyType,
      { id: 'tt-9', projectId: 'p1', name: 'Tarefa', icon: 'CheckSquare', color: '#2563eb', position: 1, prefix: 'TASK', nextNumber: 1 },
    ] as any)
    vi.mocked(projectsService.deleteTaskType).mockResolvedValue(undefined)

    render(<TaskTypeManager projectId="p1" />)
    fireEvent.click(await screen.findByTitle(/editar story/i))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    // abre a confirmação com o destino: nada é apagado antes de confirmar
    expect(projectsService.deleteTaskType).not.toHaveBeenCalled()
    fireEvent.change(await screen.findByLabelText('Tipo de destino'), { target: { value: 'tt-9' } })
    fireEvent.click(screen.getByRole('button', { name: /excluir e mover/i }))

    await waitFor(() => expect(projectsService.deleteTaskType).toHaveBeenCalledWith('p1', 'tt-1', 'tt-9'))
    expect(screen.queryByText('Story')).not.toBeInTheDocument()
  })
})
