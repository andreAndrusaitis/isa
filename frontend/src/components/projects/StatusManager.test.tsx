import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StatusManager } from './StatusManager'
import * as projectsService from '@/services/projectsService'

vi.mock('@/services/projectsService')

const backlog = { id: 's1', projectId: 'p1', name: 'Backlog', color: '#888', category: 'backlog', position: 0, isActive: true, requiresApproval: false }
const done = { id: 's2', projectId: 'p1', name: 'Concluído', color: '#0a0', category: 'done', position: 1, isActive: true, requiresApproval: false }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([backlog, done] as any)
})

describe('StatusManager', () => {
  it('lista os status existentes com nome e categoria', async () => {
    // O nome do status "Backlog" coincide de propósito com o rótulo da
    // categoria "backlog" — usa getAllByText para não colidir com o span do
    // rótulo de categoria, que mostra o mesmo texto.
    render(<StatusManager projectId="p1" />)
    expect(await screen.findAllByText('Backlog')).toHaveLength(2)
    expect(await screen.findAllByText('Concluído')).toHaveLength(2)
  })

  it('cria um novo status ao final da lista', async () => {
    const created = { id: 's3', projectId: 'p1', name: 'QA', color: '#f0a', category: 'in_review', position: 2, isActive: true, requiresApproval: false }
    vi.mocked(projectsService.createStatusFull).mockResolvedValue(created as any)

    render(<StatusManager projectId="p1" />)
    await screen.findAllByText('Backlog')

    fireEvent.click(screen.getByRole('button', { name: /novo status/i }))
    fireEvent.change(screen.getByPlaceholderText('QA'), { target: { value: 'QA' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar$/i }))

    await waitFor(() => expect(projectsService.createStatusFull).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'QA', afterId: undefined })))
    expect(await screen.findByText('QA')).toBeInTheDocument()
  })

  it('cria um status com limite de WIP', async () => {
    const created = { id: 's3', projectId: 'p1', name: 'QA', color: '#f0a', category: 'in_review', position: 2, isActive: true, requiresApproval: false, wipLimit: 3 }
    vi.mocked(projectsService.createStatusFull).mockResolvedValue(created as any)

    render(<StatusManager projectId="p1" />)
    await screen.findAllByText('Backlog')

    fireEvent.click(screen.getByRole('button', { name: /novo status/i }))
    fireEvent.change(screen.getByPlaceholderText('QA'), { target: { value: 'QA' } })
    fireEvent.change(screen.getByLabelText(/limite de wip/i), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar$/i }))

    await waitFor(() => expect(projectsService.createStatusFull).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'QA', wipLimit: 3 })))
  })

  it('insere um status entre dois existentes usando o botão + da junção', async () => {
    const created = { id: 's3', projectId: 'p1', name: 'QA', color: '#f0a', category: 'in_review', position: 1, isActive: true, requiresApproval: false }
    vi.mocked(projectsService.createStatusFull).mockResolvedValue(created as any)

    render(<StatusManager projectId="p1" />)
    await screen.findAllByText('Backlog')

    // O botão "+" logo após a linha do Backlog insere depois dele.
    fireEvent.click(screen.getByTitle('Adicionar status depois de "Backlog"'))
    fireEvent.change(screen.getByPlaceholderText('QA'), { target: { value: 'QA' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar$/i }))

    await waitFor(() => expect(projectsService.createStatusFull).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'QA', afterId: 's1' })))
  })

  it('edita um status existente', async () => {
    const updated = { ...backlog, name: 'A Fazer' }
    vi.mocked(projectsService.updateStatus).mockResolvedValue(updated as any)

    render(<StatusManager projectId="p1" />)
    await screen.findAllByText('Backlog')

    fireEvent.click(screen.getAllByRole('button', { name: /editar/i })[0])
    // getByDisplayValue('Backlog') colidiria com o <select> de categoria
    // (que também tem a opção "Backlog" selecionada) — o campo de nome é o
    // único <input type="text">.
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'A Fazer' } })
    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(projectsService.updateStatus).toHaveBeenCalledWith('p1', 's1', expect.objectContaining({ name: 'A Fazer' })))
    expect(await screen.findByText('A Fazer')).toBeInTheDocument()
  })

  it('exige escolher destino antes de excluir, e move as tasks', async () => {
    vi.mocked(projectsService.deleteStatus).mockResolvedValue({ movedTaskCount: 3 } as any)

    render(<StatusManager projectId="p1" />)
    await screen.findAllByText('Backlog')

    fireEvent.click(screen.getAllByRole('button', { name: /excluir/i })[0])
    expect(await screen.findByText(/mover tasks para/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /excluir e mover tasks/i }))

    await waitFor(() => expect(projectsService.deleteStatus).toHaveBeenCalledWith('p1', 's1', 's2'))
    await waitFor(() => expect(screen.queryAllByText('Backlog')).toHaveLength(0))
  })

  it('impede excluir o único status restante', async () => {
    vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([backlog] as any)

    render(<StatusManager projectId="p1" />)
    await screen.findAllByText('Backlog')

    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    expect(await screen.findByText(/único status do projeto/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /excluir e mover tasks/i })).toBeDisabled()
  })

  it('readOnly: sem alça de arrastar nem botões de editar/criar/excluir', async () => {
    const { container } = render(<StatusManager projectId="p1" readOnly />)
    await screen.findAllByText('Backlog')
    expect(screen.queryByLabelText(/arrastar/i)).not.toBeInTheDocument()
    // Nenhum elemento com os atributos do dnd-kit (listeners/role de alça).
    expect(container.querySelector('[aria-roledescription="sortable"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /excluir/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /novo status/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /adicionar status depois/i })).not.toBeInTheDocument()
  })

  it('editável: mostra a alça de arrastar de cada status', async () => {
    render(<StatusManager projectId="p1" />)
    await screen.findAllByText('Backlog')
    expect(screen.getByLabelText('Arrastar Backlog')).toBeInTheDocument()
    expect(screen.getByLabelText('Arrastar Concluído')).toBeInTheDocument()
  })
})

