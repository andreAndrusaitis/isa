import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateProjectModal } from './CreateProjectModal'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

describe('CreateProjectModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('chama createProject com o nome preenchido e onCreated com o resultado', async () => {
    const created = { id: 'p1', name: 'Projeto X', description: null, privacy: 'organization', ownerId: 'u1', startDate: null, targetDate: null, archivedAt: null }
    vi.mocked(projectsService.createProject).mockResolvedValue(created as any)
    const onCreated = vi.fn()

    render(<CreateProjectModal isOpen={true} onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText(/nome do projeto/i), { target: { value: 'Projeto X' } })
    fireEvent.click(screen.getByRole('button', { name: /criar projeto/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    expect(projectsService.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Projeto X' }))
  })

  it('não submete com nome vazio', () => {
    render(<CreateProjectModal isOpen={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByRole('button', { name: /criar projeto/i })).toBeDisabled()
  })
})
