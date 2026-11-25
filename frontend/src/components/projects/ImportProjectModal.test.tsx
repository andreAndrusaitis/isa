import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ImportProjectModal } from './ImportProjectModal'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

const clickup = { source: 'ClickUp', members: [], spaces: [], tasks: [] }

function jsonFile(content: unknown, name = 'export.json') {
  const file = new File([JSON.stringify(content)], name, { type: 'application/json' })
  // jsdom não implementa File.text() em todas as versões
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(content)) })
  return file
}

beforeEach(() => vi.clearAllMocks())

describe('ImportProjectModal', () => {
  it('mostra a prévia e só importa depois de confirmar', async () => {
    vi.mocked(projectsService.previewProjectImport).mockResolvedValue({
      format: 'clickup', totalTasks: 3, peopleFound: ['Ana'], peopleMissing: ['fulano@x.com'], unmappedAssignees: [],
      projects: [{ name: 'MANU PRO', tasks: 3, statuses: ['A Fazer'], lists: [], members: 2 }],
    })
    vi.mocked(projectsService.importProjects).mockResolvedValue({ format: 'clickup', projects: [{ id: 'p9', name: 'MANU PRO', tasks: 3 }] })
    const onImported = vi.fn()

    render(<MemoryRouter><ImportProjectModal isOpen onClose={vi.fn()} onImported={onImported} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/arquivo de backup/i), { target: { files: [jsonFile(clickup)] } })

    expect(await screen.findByText('Export do ClickUp')).toBeInTheDocument()
    expect(screen.getByText('MANU PRO')).toBeInTheDocument()
    expect(screen.getByText(/fulano@x.com/)).toBeInTheDocument()
    expect(projectsService.importProjects).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /importar 1 projeto/i }))
    await waitFor(() => expect(projectsService.importProjects).toHaveBeenCalledWith(clickup))
    expect(onImported).toHaveBeenCalled()
  })

  it('recusa arquivo que não é .json sem chamar o servidor', async () => {
    render(<MemoryRouter><ImportProjectModal isOpen onClose={vi.fn()} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/arquivo de backup/i), { target: { files: [jsonFile({}, 'planilha.xlsx')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Envie um arquivo .json.')
    expect(projectsService.previewProjectImport).not.toHaveBeenCalled()
  })
})
