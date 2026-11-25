import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TaskDrawer } from './TaskDrawer'
import * as tasksService from '@/services/tasksService'
import * as projectsService from '@/services/projectsService'
import { useAuthStore } from '@/store/auth'
import { ProjectRoleProvider } from './projectRole'

vi.mock('@/services/tasksService')
vi.mock('@/services/projectsService')

const task = {
  id: 't1', projectId: 'p1', listId: null, statusId: 's1', parentId: null, seq: 1,
  title: 'Tarefa X', description: null, priority: 'none', assigneeId: null, creatorId: 'u1',
  startDate: null, dueDate: null, isMilestone: false, archivedAt: null,
  tags: [], documents: [],
}

describe('TaskDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(tasksService.getTask).mockResolvedValue(task as any)
    vi.mocked(tasksService.listChecklist).mockResolvedValue([])
    vi.mocked(tasksService.listComments).mockResolvedValue([])
    vi.mocked(tasksService.listTaskAssignees).mockResolvedValue([])
    vi.mocked(projectsService.listProjectStatuses).mockResolvedValue([
      { id: 's1', projectId: 'p1', name: 'A Fazer', color: '#000', category: 'open', position: 0, isActive: true, requiresApproval: false },
    ] as any)
    vi.mocked(projectsService.listMembers).mockResolvedValue([])
    vi.mocked(projectsService.listTags).mockResolvedValue([])
    vi.mocked(projectsService.listProjectDocuments).mockResolvedValue([])
    vi.mocked(projectsService.listAttachments).mockResolvedValue([])
    vi.mocked(projectsService.listTaskTypes).mockResolvedValue([])
    vi.mocked(projectsService.listSprints).mockResolvedValue([])
    vi.mocked(projectsService.listTaskTickets).mockResolvedValue([])
    vi.mocked(projectsService.getTaskTime).mockResolvedValue({ activeMinutes: 0, wallActiveMinutes: 0, running: false, startedAt: null, completedAt: null, byStatus: [], byPerson: [] })
  })

  it('renderiza checklist existente e permite marcar item como feito', async () => {
    vi.mocked(tasksService.listChecklist).mockResolvedValue([
      { id: 'c1', taskId: 't1', text: 'Passo 1', done: false, position: 0 },
    ] as any)
    vi.mocked(tasksService.toggleChecklistItem).mockResolvedValue({ id: 'c1', taskId: 't1', text: 'Passo 1', done: true, position: 0 } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)

    await waitFor(() => expect(tasksService.toggleChecklistItem).toHaveBeenCalledWith('p1', 't1', 'c1', true))
  })

  it('adiciona um novo item de checklist', async () => {
    vi.mocked(tasksService.createChecklistItem).mockResolvedValue({ id: 'c2', taskId: 't1', text: 'Novo passo', done: false, position: 0 } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    const input = await screen.findByPlaceholderText(/novo item/i)
    fireEvent.change(input, { target: { value: 'Novo passo' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(tasksService.createChecklistItem).toHaveBeenCalledWith('p1', 't1', 'Novo passo'))
  })

  it('renderiza comentários existentes e permite adicionar um novo', async () => {
    vi.mocked(tasksService.listComments).mockResolvedValue([
      { id: 'com1', taskId: 't1', authorId: 'u2', body: 'Primeiro comentário', editedAt: null, createdAt: new Date().toISOString() },
    ] as any)
    vi.mocked(tasksService.createComment).mockResolvedValue({ id: 'com2', taskId: 't1', authorId: 'u1', body: 'Resposta', editedAt: null, createdAt: new Date().toISOString() } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    expect(await screen.findByText('Primeiro comentário')).toBeInTheDocument()

    const commentInput = screen.getByPlaceholderText(/escrever um comentário/i)
    fireEvent.change(commentInput, { target: { value: 'Resposta' } })
    fireEvent.click(screen.getByRole('button', { name: /comentar/i }))

    await waitFor(() => expect(tasksService.createComment).toHaveBeenCalledWith('p1', 't1', 'Resposta'))
  })

  it('autor edita o próprio comentário e exclui com confirmação', async () => {
    useAuthStore.setState({ user: { id: 'u1', name: 'Eu', role: 'agent' } as any })
    vi.mocked(tasksService.listComments).mockResolvedValue([
      { id: 'com1', taskId: 't1', authorId: 'u1', body: 'Rascunho', editedAt: null, createdAt: new Date().toISOString() },
    ] as any)
    vi.mocked(tasksService.editComment).mockResolvedValue({ id: 'com1', taskId: 't1', authorId: 'u1', body: 'Versão final', editedAt: new Date().toISOString(), createdAt: new Date().toISOString() } as any)
    vi.mocked(tasksService.deleteComment).mockResolvedValue()

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Editar comentário' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Editar comentário' }), { target: { value: 'Versão final' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(tasksService.editComment).toHaveBeenCalledWith('p1', 't1', 'com1', 'Versão final'))
    expect(await screen.findByText('Versão final')).toBeInTheDocument()
    expect(screen.getByText(/editado/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Excluir comentário' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(tasksService.deleteComment).toHaveBeenCalledWith('p1', 't1', 'com1'))
    await waitFor(() => expect(screen.queryByText('Versão final')).not.toBeInTheDocument())
  })

  it('não oferece editar comentário de outra pessoa', async () => {
    useAuthStore.setState({ user: { id: 'u1', name: 'Eu', role: 'agent' } as any })
    vi.mocked(tasksService.listComments).mockResolvedValue([
      { id: 'com1', taskId: 't1', authorId: 'u2', body: 'Do colega', editedAt: null, createdAt: new Date().toISOString() },
    ] as any)
    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    expect(await screen.findByText('Do colega')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar comentário' })).not.toBeInTheDocument()
  })

  it('renderiza a descrição em markdown e permite editar', async () => {
    vi.mocked(tasksService.getTask).mockResolvedValue({ ...task, description: '**negrito**' } as any)
    vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, description: 'Novo texto' } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    const rendered = await screen.findByText((_, el) => el?.tagName === 'STRONG' && el.textContent === 'negrito')
    expect(rendered).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const textarea = await screen.findByRole('textbox', { name: 'Descrição da task' })
    fireEvent.change(textarea, { target: { value: 'Novo texto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 't1', { description: 'Novo texto' }))
  })

  it('descrição: um Enter quebra a linha e HTML perigoso é removido', async () => {
    vi.mocked(tasksService.getTask).mockResolvedValue({ ...task, description: 'linha 1\nlinha 2\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>' } as any)

    const { container } = render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    await screen.findByText('#1')

    const body = container.querySelector('.markdown-body')!
    expect(body.querySelector('br')).not.toBeNull()
    expect(body.innerHTML).not.toMatch(/onerror|<script/)
  })

  describe('descrição', () => {
    const comTexto = () => vi.mocked(tasksService.getTask).mockResolvedValue({ ...task, description: 'Texto original' } as any)
    const editar = async () => {
      await screen.findByText('Texto original')
      fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
      return screen.getByRole('textbox', { name: 'Descrição da task' }) as HTMLTextAreaElement
    }

    it('clicar no texto não entra em edição: só o botão Editar', async () => {
      comTexto()
      render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
      fireEvent.click(await screen.findByText('Texto original'))
      expect(screen.queryByRole('textbox', { name: 'Descrição da task' })).not.toBeInTheDocument()
    })

    it('a barra formata a seleção e Salvar grava', async () => {
      comTexto()
      vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, description: '**Texto** original' } as any)
      render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
      const campo = await editar()
      campo.setSelectionRange(0, 5)
      fireEvent.click(screen.getByRole('button', { name: 'Negrito' }))
      expect(campo.value).toBe('**Texto** original')
      expect(tasksService.updateTask).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 't1', expect.objectContaining({ description: '**Texto** original' })))
    })

    it('sair do campo não salva e Cancelar descarta', async () => {
      comTexto()
      render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
      const campo = await editar()
      fireEvent.change(campo, { target: { value: 'Mudei' } })
      fireEvent.blur(campo)
      expect(tasksService.updateTask).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(tasksService.updateTask).not.toHaveBeenCalled()
      expect(await screen.findByText('Texto original')).toBeInTheDocument()
    })

    it('fechar o painel no meio da edição não perde o texto', async () => {
      comTexto()
      vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, description: 'Mudei' } as any)
      const onClose = vi.fn()
      render(<TaskDrawer projectId="p1" taskId="t1" onClose={onClose} />)
      const campo = await editar()
      fireEvent.change(campo, { target: { value: 'Mudei' } })
      fireEvent.click(screen.getByTitle('Fechar (Esc)'))
      await waitFor(() => expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 't1', expect.objectContaining({ description: 'Mudei' })))
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('subtarefas: lista, abre no drawer e cria filha com parentId', async () => {
    vi.mocked(tasksService.getTask).mockResolvedValue({
      ...task, listId: 'l1',
      subtasks: [{ id: 'st1', seq: 2, key: null, title: 'Filha 1', statusId: 's1', assigneeId: null, dueDate: null }],
      parent: { id: 'pai', seq: 9, key: 'FEAT-9', title: 'Task mãe' },
    } as any)
    vi.mocked(tasksService.createTask).mockResolvedValue({ ...task, id: 'st2', seq: 3, title: 'Filha 2', parentId: 't1' } as any)
    const onOpenTask = vi.fn()

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} onOpenTask={onOpenTask} />)

    fireEvent.click(await screen.findByRole('button', { name: /abrir subtarefa #2: Filha 1/i }))
    expect(onOpenTask).toHaveBeenCalledWith('st1')
    fireEvent.click(screen.getByRole('button', { name: /subtarefa de FEAT-9/i }))
    expect(onOpenTask).toHaveBeenCalledWith('pai')

    fireEvent.change(screen.getByLabelText('Nova subtarefa'), { target: { value: 'Filha 2' } })
    fireEvent.keyDown(screen.getByLabelText('Nova subtarefa'), { key: 'Enter' })
    await waitFor(() => expect(tasksService.createTask).toHaveBeenCalledWith('p1', { title: 'Filha 2', statusId: 's1', parentId: 't1', listId: 'l1' }))
    expect(await screen.findByText('Filha 2')).toBeInTheDocument()
  })

  it('adiciona e remove uma tag da task', async () => {
    vi.mocked(projectsService.listTags).mockResolvedValue([{ id: 'tag1', projectId: 'p1', name: 'Urgente', color: '#f00' }] as any)
    vi.mocked(tasksService.addTagToTask).mockResolvedValue(undefined)
    vi.mocked(tasksService.removeTagFromTask).mockResolvedValue(undefined)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByTitle(/adicionar tag/i))
    fireEvent.click(screen.getByRole('option', { name: /urgente/i }))

    await waitFor(() => expect(tasksService.addTagToTask).toHaveBeenCalledWith('p1', 't1', 'tag1'))
    expect(await screen.findByRole('button', { name: 'Remover tag Urgente' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remover tag Urgente' }))
    await waitFor(() => expect(tasksService.removeTagFromTask).toHaveBeenCalledWith('p1', 't1', 'tag1'))
  })

  it('atrela um documento do projeto à task', async () => {
    vi.mocked(projectsService.listProjectDocuments).mockResolvedValue([{ id: 'doc1', title: 'Especificação' }])
    vi.mocked(tasksService.linkTaskDocument).mockResolvedValue(undefined)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /atrelar documento/i }))
    fireEvent.change(screen.getByDisplayValue(/escolher documento/i), { target: { value: 'doc1' } })

    await waitFor(() => expect(tasksService.linkTaskDocument).toHaveBeenCalledWith('p1', 't1', 'doc1'))
    expect(await screen.findByText('Especificação')).toBeInTheDocument()
  })

  it('fecha o modal ao pressionar a tecla Escape', async () => {
    const handleClose = vi.fn()
    render(<TaskDrawer projectId="p1" taskId="t1" onClose={handleClose} />)

    await screen.findByText('#1')
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(handleClose).toHaveBeenCalled()
  })

  it('anexa um arquivo pendente ao comentário e envia via uploadAttachment com entityType comment', async () => {
    vi.mocked(tasksService.createComment).mockResolvedValue({
      id: 'c1', taskId: 't1', authorId: 'u1', body: 'Segue o print', editedAt: null, createdAt: new Date().toISOString(),
    } as any)
    vi.mocked(projectsService.uploadAttachment).mockResolvedValue({
      id: 'a1', fileName: 'print.png', mimeType: 'image/png', fileSize: 100, url: 'data:image/png;base64,abc',
      createdAt: new Date().toISOString(), entityType: 'comment', entityId: 'c1',
    } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    await screen.findByPlaceholderText(/escrever um comentário/i)

    const file = new File(['conteudo'], 'print.png', { type: 'image/png' })
    const dropZone = screen.getByTestId('comment-drop-zone')
    fireEvent.drop(dropZone, { dataTransfer: { files: [file], types: ['Files'], getData: () => '' } })

    expect(await screen.findByText('print.png')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/escrever um comentário/i), { target: { value: 'Segue o print' } })
    fireEvent.click(screen.getByRole('button', { name: /comentar/i }))

    await waitFor(() => {
      expect(projectsService.uploadAttachment).toHaveBeenCalledWith('p1', expect.objectContaining({
        entityType: 'comment', entityId: 'c1', fileName: 'print.png',
      }))
    })
  })

  it('exibe attachments do comentário dentro do balão correspondente', async () => {
    vi.mocked(tasksService.listComments).mockResolvedValue([
      { id: 'c1', taskId: 't1', authorId: 'u1', body: 'Segue o print', editedAt: null, createdAt: new Date().toISOString() },
    ] as any)
    vi.mocked(projectsService.listAttachments).mockResolvedValue([
      { id: 'a1', fileName: 'print.png', mimeType: 'image/png', fileSize: 100, url: 'data:image/png;base64,abc', createdAt: new Date().toISOString(), entityType: 'comment', entityId: 'c1' },
    ] as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    expect(await screen.findByText('Segue o print')).toBeInTheDocument()
    // Aparece nos dois lugares: embutido no balão do comentário E na aba
    // "Arquivos" geral da task (visão unificada, Task 8 do plano).
    expect(screen.getAllByText('print.png').length).toBeGreaterThanOrEqual(1)
  })

  it('lista na aba Arquivos tanto anexos da task quanto anexos de comentários, com nota de origem', async () => {
    vi.mocked(tasksService.listComments).mockResolvedValue([
      { id: 'c1', taskId: 't1', authorId: 'u1', body: 'Segue o print', editedAt: null, createdAt: new Date().toISOString() },
    ] as any)
    vi.mocked(projectsService.listAttachments).mockResolvedValue([
      { id: 'a1', fileName: 'geral.pdf', mimeType: 'application/pdf', fileSize: 100, url: 'data:application/pdf;base64,abc', createdAt: new Date().toISOString(), entityType: 'task', entityId: 't1' },
      { id: 'a2', fileName: 'print.png', mimeType: 'image/png', fileSize: 100, url: 'data:image/png;base64,abc', createdAt: new Date().toISOString(), entityType: 'comment', entityId: 'c1' },
    ] as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)

    await screen.findByText('Segue o print')
    const filesHeading = screen.getByText(/^Arquivos/i)
    const filesSection = filesHeading.parentElement!
    expect(within(filesSection).getByText('geral.pdf')).toBeInTheDocument()
    expect(within(filesSection).getByText('print.png')).toBeInTheDocument()
    expect(within(filesSection).getByText(/via comentário/i)).toBeInTheDocument()
  })

  it('ao soltar um Document do projeto no comentário, linka o doc à task e insere marcador no texto', async () => {
    vi.mocked(projectsService.listProjectDocuments).mockResolvedValue([
      { id: 'doc1', title: 'Especificação técnica' },
    ] as any)
    vi.mocked(tasksService.linkTaskDocument).mockResolvedValue(undefined)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    await screen.findByPlaceholderText(/escrever um comentário/i)

    const dropZone = screen.getByTestId('comment-drop-zone')
    fireEvent.drop(dropZone, {
      dataTransfer: { getData: (fmt: string) => (fmt === 'application/x-isa-document-id' ? 'doc1' : ''), files: [], types: ['application/x-isa-document-id'] },
    })

    await waitFor(() => {
      expect(tasksService.linkTaskDocument).toHaveBeenCalledWith('p1', 't1', 'doc1')
    })
    expect((screen.getByPlaceholderText(/escrever um comentário/i) as HTMLTextAreaElement).value).toContain('Especificação técnica')
  })

  it('permite trocar o tipo da task no grid de propriedades', async () => {
    vi.mocked(projectsService.listTaskTypes).mockResolvedValue([
      { id: 'tt-1', projectId: 'p1', name: 'Bug', icon: 'Bug', color: '#dc2626', position: 0 },
    ] as any)
    vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, taskTypeId: 'tt-1' } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    await screen.findByText('#1')

    fireEvent.change(screen.getByLabelText(/^tipo$/i), { target: { value: 'tt-1' } })

    await waitFor(() => expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 't1', { taskTypeId: 'tt-1' }))
  })

  it('permite trocar os story points da task no grid de propriedades', async () => {
    vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, storyPoints: 8 } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    await screen.findByText('#1')

    fireEvent.change(screen.getByLabelText(/story points/i), { target: { value: '8' } })

    await waitFor(() => expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 't1', { storyPoints: 8 }))
  })

  it('avisa a página de cada edição salva, para lista/Kanban não dependerem do socket', async () => {
    vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, storyPoints: 8 } as any)
    const onTaskChange = vi.fn()

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} onTaskChange={onTaskChange} />)
    await screen.findByText('#1')

    fireEvent.change(screen.getByLabelText(/story points/i), { target: { value: '8' } })

    await waitFor(() => expect(onTaskChange).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', storyPoints: 8 })))
  })

  it('marca vários responsáveis no mesmo campo; o primeiro vira o principal', async () => {
    vi.mocked(projectsService.listMembers).mockResolvedValue([
      { userId: 'u1', role: 'member', user: { id: 'u1', name: 'Ana' } },
      { userId: 'u2', role: 'member', user: { id: 'u2', name: 'Bia' } },
    ] as any)
    vi.mocked(tasksService.setTaskAssignees).mockImplementation(async (_p, _t, ids) => ids)
    const onTaskChange = vi.fn()

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} onTaskChange={onTaskChange} />)
    await screen.findByText('#1')

    fireEvent.click(screen.getByRole('button', { name: /responsáveis/i }))
    fireEvent.click(await screen.findByRole('option', { name: /Ana/ }))
    await waitFor(() => expect(tasksService.setTaskAssignees).toHaveBeenLastCalledWith('p1', 't1', ['u1']))
    fireEvent.click(screen.getByRole('option', { name: /Bia/ }))

    await waitFor(() => expect(tasksService.setTaskAssignees).toHaveBeenLastCalledWith('p1', 't1', ['u1', 'u2']))
    expect(onTaskChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 't1', assigneeId: 'u1', multiAssignees: [expect.objectContaining({ userId: 'u1' }), expect.objectContaining({ userId: 'u2' })] }))
  })

  it('permite trocar o sprint da task no grid de propriedades', async () => {
    vi.mocked(projectsService.listSprints).mockResolvedValue([
      { id: 'sp-1', projectId: 'p1', name: 'Sprint 1', status: 'active', startDate: null, endDate: null, position: 0 },
    ] as any)
    vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, sprintId: 'sp-1' } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    await screen.findByText('#1')

    fireEvent.change(screen.getByLabelText(/^sprint$/i), { target: { value: 'sp-1' } })

    await waitFor(() => expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 't1', { sprintId: 'sp-1' }))
  })
  it('colar (Ctrl+V) uma imagem no comentário entra na lista de anexos pendentes', async () => {
    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    const textarea = await screen.findByPlaceholderText(/escrever um comentário/i)

    const file = new File(['png'], 'tela.png', { type: 'image/png' })
    fireEvent.paste(textarea, { clipboardData: { files: [file], items: [], types: ['Files'] } })

    expect(await screen.findByText('tela.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remover anexo' })).toBeInTheDocument()
  })

  it('ponto de controle é um switch que alterna isMilestone', async () => {
    vi.mocked(tasksService.updateTask).mockResolvedValue({ ...task, isMilestone: true } as any)

    render(<TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} />)
    const toggle = await screen.findByRole('switch', { name: /ponto de controle/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)

    await waitFor(() => expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 't1', { isMilestone: true }))
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('visualizador pode seguir e deixar de seguir a task (botão fora do fieldset desabilitado)', async () => {
    useAuthStore.setState({ user: { id: 'u9', name: 'Vera Viewer', role: 'agent' } as any })
    vi.mocked(projectsService.listWatchers).mockResolvedValue([])
    vi.mocked(projectsService.addWatcher).mockResolvedValue({} as any)
    vi.mocked(projectsService.removeWatcher).mockResolvedValue(undefined)

    render(<ProjectRoleProvider value="viewer"><TaskDrawer projectId="p1" taskId="t1" onClose={vi.fn()} /></ProjectRoleProvider>)

    const follow = await screen.findByRole('button', { name: 'Seguir' })
    await waitFor(() => expect(follow).toBeEnabled())
    fireEvent.click(follow)
    await waitFor(() => expect(projectsService.addWatcher).toHaveBeenCalledWith('p1', 't1'))

    fireEvent.click(await screen.findByRole('button', { name: 'Deixar de seguir' }))
    await waitFor(() => expect(projectsService.removeWatcher).toHaveBeenCalledWith('p1', 't1', 'u9'))
    expect(await screen.findByRole('button', { name: 'Seguir' })).toBeInTheDocument()
  })
})

