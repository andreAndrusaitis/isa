import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportDossierModal } from './ExportDossierModal'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

const projects = [
  { id: 'p1', name: 'Portal', teamOnly: false },
  { id: 'p2', name: 'Migração', teamOnly: true },
] as any

beforeEach(() => vi.clearAllMocks())

describe('ExportDossierModal', () => {
  it('exporta todos os projetos em HTML por padrão', async () => {
    vi.mocked(projectsService.downloadProjectsExport).mockResolvedValue()
    const onClose = vi.fn()
    render(<ExportDossierModal isOpen onClose={onClose} projects={projects} />)
    fireEvent.click(screen.getByRole('button', { name: /gerar/i }))
    await waitFor(() => expect(projectsService.downloadProjectsExport).toHaveBeenCalledWith({ format: 'html', projectIds: undefined, from: undefined, to: undefined }))
    expect(onClose).toHaveBeenCalled()
  })

  it('exporta só os escolhidos, em Excel, com período', async () => {
    vi.mocked(projectsService.downloadProjectsExport).mockResolvedValue()
    render(<ExportDossierModal isOpen onClose={vi.fn()} projects={projects} />)
    fireEvent.click(screen.getByLabelText(/escolher projetos/i))
    fireEvent.click(screen.getByLabelText('Migração'))
    fireEvent.click(screen.getByLabelText(/excel/i))
    fireEvent.change(screen.getByLabelText(/^de$/i), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText(/^até$/i), { target: { value: '2026-09-30' } })
    fireEvent.click(screen.getByRole('button', { name: /gerar/i }))
    await waitFor(() => expect(projectsService.downloadProjectsExport).toHaveBeenCalledWith({ format: 'xlsx', projectIds: ['p2'], from: '2026-09-01', to: '2026-09-30' }))
  })

  it('não gera com escolha vazia', () => {
    render(<ExportDossierModal isOpen onClose={vi.fn()} projects={projects} />)
    fireEvent.click(screen.getByLabelText(/escolher projetos/i))
    expect(screen.getByRole('button', { name: /gerar/i })).toBeDisabled()
  })

  it('já vem com o projeto marcado quando aberto de dentro dele', () => {
    render(<ExportDossierModal isOpen onClose={vi.fn()} projects={projects} initialProjectIds={['p1']} />)
    expect(screen.getByLabelText('Portal')).toBeChecked()
  })
})
