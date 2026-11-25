import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TagManager } from './TagManager'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

describe('TagManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(projectsService.listTags).mockResolvedValue([])
  })

  it('lista as tags existentes do projeto', async () => {
    vi.mocked(projectsService.listTags).mockResolvedValue([
      { id: 'tag1', projectId: 'p1', name: 'Urgente', color: '#ef4444' },
    ] as any)
    render(<TagManager projectId="p1" />)
    expect(await screen.findByText('Urgente')).toBeInTheDocument()
  })

  it('cria uma nova tag', async () => {
    vi.mocked(projectsService.createTag).mockResolvedValue({ id: 'tag2', projectId: 'p1', name: 'Bug', color: '#3b82f6' } as any)
    render(<TagManager projectId="p1" />)

    fireEvent.click(await screen.findByRole('button', { name: /nova tag/i }))
    fireEvent.change(screen.getByPlaceholderText(/urgente/i), { target: { value: 'Bug' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar$/i }))

    await waitFor(() => expect(projectsService.createTag).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Bug' })))
    expect(await screen.findByText('Bug')).toBeInTheDocument()
  })

  describe('excluir', () => {
    const tag = { id: 'tag1', projectId: 'p1', name: 'Urgente', color: '#ef4444', taskCount: 3 }

    beforeEach(() => { vi.mocked(projectsService.listTags).mockResolvedValue([tag] as any) })

    it('avisa quantas tasks usam a tag e só exclui depois de confirmar', async () => {
      vi.mocked(projectsService.deleteTag).mockResolvedValue({ removedFrom: 3 })
      render(<TagManager projectId="p1" />)

      fireEvent.click(await screen.findByRole('button', { name: 'Excluir tag Urgente' }))
      expect(screen.getByText(/está em 3 tasks/)).toBeInTheDocument()
      expect(projectsService.deleteTag).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
      await waitFor(() => expect(projectsService.deleteTag).toHaveBeenCalledWith('p1', 'tag1'))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Excluir tag Urgente' })).not.toBeInTheDocument())
    })

    it('cancelar mantém a tag', async () => {
      render(<TagManager projectId="p1" />)
      fireEvent.click(await screen.findByRole('button', { name: 'Excluir tag Urgente' }))
      fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
      expect(projectsService.deleteTag).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Excluir tag Urgente' })).toBeInTheDocument()
    })

    it('se o servidor recusar, a tag continua na lista', async () => {
      vi.mocked(projectsService.deleteTag).mockRejectedValue(new Error('negado'))
      render(<TagManager projectId="p1" />)
      fireEvent.click(await screen.findByRole('button', { name: 'Excluir tag Urgente' }))
      fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
      await waitFor(() => expect(projectsService.deleteTag).toHaveBeenCalled())
      expect(await screen.findByRole('button', { name: 'Excluir tag Urgente' })).toBeInTheDocument()
    })
  })
})
