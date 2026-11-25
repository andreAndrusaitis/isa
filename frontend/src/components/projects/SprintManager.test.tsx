import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SprintManager, projectSprintApi } from './SprintManager'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

const sprint1 = { id: 'sp-1', projectId: 'p1', name: 'Sprint 1', status: 'planned' as const, startDate: null, endDate: null, position: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(projectsService.listSprints).mockResolvedValue([sprint1])
})

describe('SprintManager', () => {
  it('lista os sprints existentes com o status', async () => {
    render(<SprintManager api={projectSprintApi('p1')} />)
    expect(await screen.findByText('Sprint 1')).toBeInTheDocument()
  })

  it('cria um novo sprint', async () => {
    const created = { id: 'sp-2', projectId: 'p1', name: 'Sprint 2', status: 'planned' as const, startDate: null, endDate: null, position: 1 }
    vi.mocked(projectsService.createSprint).mockResolvedValue(created)

    render(<SprintManager api={projectSprintApi('p1')} />)
    await screen.findByText('Sprint 1')

    fireEvent.click(screen.getByRole('button', { name: /novo sprint/i }))
    fireEvent.change(screen.getByPlaceholderText(/sprint 1/i), { target: { value: 'Sprint 2' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar$/i }))

    await waitFor(() => expect(projectsService.createSprint).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Sprint 2' })))
    expect(await screen.findByText('Sprint 2')).toBeInTheDocument()
  })

  it('inicia um sprint planned', async () => {
    vi.mocked(projectsService.startSprint).mockResolvedValue({ ...sprint1, status: 'active' })

    render(<SprintManager api={projectSprintApi('p1')} />)
    await screen.findByText('Sprint 1')
    fireEvent.click(screen.getByRole('button', { name: /iniciar/i }))

    await waitFor(() => expect(projectsService.startSprint).toHaveBeenCalledWith('p1', 'sp-1'))
  })

  it('encerra um sprint ativo', async () => {
    vi.mocked(projectsService.listSprints).mockResolvedValue([{ ...sprint1, status: 'active' }])
    vi.mocked(projectsService.completeSprint).mockResolvedValue({ ...sprint1, status: 'completed' })

    render(<SprintManager api={projectSprintApi('p1')} />)
    await screen.findByText('Sprint 1')
    fireEvent.click(screen.getByRole('button', { name: /encerrar/i }))

    await waitFor(() => expect(projectsService.completeSprint).toHaveBeenCalledWith('p1', 'sp-1'))
  })

  it('exclui um sprint existente', async () => {
    vi.mocked(projectsService.deleteSprint).mockResolvedValue(undefined)

    render(<SprintManager api={projectSprintApi('p1')} />)
    await screen.findByText('Sprint 1')
    fireEvent.click(screen.getByTitle(/editar sprint 1/i))
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    // abre o ConfirmModal: nada é apagado antes de confirmar
    expect(projectsService.deleteSprint).not.toHaveBeenCalled()
    const confirmar = await screen.findAllByRole('button', { name: /^excluir$/i })
    fireEvent.click(confirmar[confirmar.length - 1])

    await waitFor(() => expect(projectsService.deleteSprint).toHaveBeenCalledWith('p1', 'sp-1'))
  })
})
