import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { KnowledgeBasePanel } from './KnowledgeBasePanel'
import { knowledgeService } from '@/services/knowledgeService'
import { adminService } from '@/services/adminService'
import { toast } from '@/store/toastStore'

vi.mock('@/services/knowledgeService', () => ({
  knowledgeService: {
    list: vi.fn(), gaps: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), remove: vi.fn(), importFile: vi.fn(),
  },
}))
vi.mock('@/services/adminService', () => ({ adminService: { getCategories: vi.fn() } }))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const service = vi.mocked(knowledgeService)

const article = (extra: object = {}) => ({
  id: 'a1', title: 'Como trocar a senha', status: 'draft', source_filename: null, created_by_id: 'u1', updated_by_id: 'u1',
  published_at: null, deleted_at: null, created_at: '2026-11-01T12:00:00.000Z', updated_at: '2026-11-02T12:00:00.000Z',
  categories: [{ id: 'c1', name: 'Infra', active: true }], ...extra,
})
const page = (data: object[], total = data.length) => ({ data, total, page: 1, pageSize: 25 })
const apiError = (status: number, error: string) => ({ response: { status, data: { error } } })

const NO_CATEGORY = 'O artigo precisa de ao menos uma categoria ativa para ficar publicado'
const AI_DOWN = 'Não foi possível indexar o artigo agora. Nada foi alterado: tente de novo em instantes.'

beforeEach(() => {
  vi.clearAllMocks()
  service.list.mockReset()
  service.list.mockResolvedValue(page([
    article(),
    article({ id: 'a2', title: 'Manual da VPN', status: 'published', source_filename: 'vpn.pdf', categories: [{ id: 'c2', name: 'Redes', active: true }] }),
  ]) as any)
  vi.mocked(adminService.getCategories).mockResolvedValue([
    { id: 'c1', name: 'Infra', active: true }, { id: 'c2', name: 'Redes', active: true }, { id: 'c3', name: 'Legado', active: false },
  ] as any)
})

const openNew = async () => {
  render(<KnowledgeBasePanel />)
  await screen.findByText('Como trocar a senha')
  fireEvent.click(screen.getByRole('button', { name: 'Novo artigo' }))
  return screen.findByRole('dialog', { name: 'Novo artigo' })
}
const fillForm = () => {
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: ' Reset de MFA ' } })
  fireEvent.change(screen.getByLabelText('Conteúdo'), { target: { value: 'Passo a passo.' } })
}
const openExisting = async (title: string, full: object) => {
  service.get.mockResolvedValue(full as any)
  render(<KnowledgeBasePanel />)
  await screen.findByText(title)
  fireEvent.click(screen.getByRole('button', { name: `Editar ${title}` }))
  return screen.findByRole('dialog', { name: 'Editar artigo' })
}
const pickFile = (file: File) => fireEvent.change(screen.getByLabelText('Arquivo para importar'), { target: { files: [file] } })

describe('KnowledgeBasePanel: lista', () => {
  it('mostra título, categorias, status, atualização e arquivo de origem', async () => {
    render(<KnowledgeBasePanel />)
    const row = (await screen.findByText('Manual da VPN')).closest('tr')!
    expect(within(row).getByText('Redes')).toBeInTheDocument()
    expect(within(row).getByText('Publicado')).toBeInTheDocument()
    expect(within(row).getByText('vpn.pdf')).toBeInTheDocument()
    expect(within(row).getByText(new Date('2026-11-02T12:00:00.000Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))).toBeInTheDocument()
    expect(within(screen.getByText('Como trocar a senha').closest('tr')!).getByText('Rascunho')).toBeInTheDocument()
  })

  it('filtra por status e por categoria, voltando à primeira página', async () => {
    service.list.mockResolvedValue(page([article()], 60) as any)
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    fireEvent.click(screen.getByRole('button', { name: 'Página 2' }))
    await waitFor(() => expect(service.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))

    fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'published' } })
    await waitFor(() => expect(service.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'published', categoryId: undefined }))

    await screen.findByRole('option', { name: 'Redes' })
    fireEvent.change(screen.getByLabelText('Filtrar por categoria'), { target: { value: 'c2' } })
    await waitFor(() => expect(service.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'published', categoryId: 'c2' }))
  })

  it('mostra o carregamento antes da primeira resposta', async () => {
    service.list.mockReturnValue(new Promise(() => {}))
    render(<KnowledgeBasePanel />)
    expect(await screen.findByRole('status')).toHaveTextContent('Carregando')
  })

  it('base vazia convida a criar o primeiro artigo', async () => {
    service.list.mockResolvedValue(page([]) as any)
    render(<KnowledgeBasePanel />)
    expect(await screen.findByText('Nenhum artigo na base')).toBeInTheDocument()
  })

  it('filtro sem resultado oferece limpar os filtros', async () => {
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    service.list.mockResolvedValue(page([]) as any)
    fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'draft' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Limpar filtros' }))
    await waitFor(() => expect(screen.getByLabelText('Filtrar por status')).toHaveValue(''))
  })

  it('erro da API aparece com a mensagem do servidor e permite tentar de novo', async () => {
    service.list.mockRejectedValueOnce(apiError(500, 'Banco indisponível'))
    render(<KnowledgeBasePanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Banco indisponível')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Como trocar a senha')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('resposta antiga não sobrescreve a do filtro mais novo', async () => {
    let answerOld: (v: any) => void = () => {}
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    service.list.mockReturnValueOnce(new Promise(r => { answerOld = r }))
    fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'draft' } })
    service.list.mockResolvedValueOnce(page([article({ id: 'a9', title: 'Resposta nova' })]) as any)
    fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'published' } })
    await screen.findByText('Resposta nova')
    answerOld(page([article({ id: 'a8', title: 'Resposta velha' })]))
    await new Promise(r => setTimeout(r))
    expect(screen.queryByText('Resposta velha')).not.toBeInTheDocument()
    expect(screen.getByText('Resposta nova')).toBeInTheDocument()
  })

  it('página que deixou de existir recua para a última com artigos', async () => {
    service.list.mockImplementation(async ({ page: p }: any) => ({ data: p === 3 ? [] : [article()], total: p === 1 ? 51 : 50, page: p, pageSize: 25 }) as any)
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    fireEvent.click(screen.getByRole('button', { name: 'Página 3' }))
    await waitFor(() => expect(service.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
  })
})

describe('KnowledgeBasePanel: formulário', () => {
  it('cria rascunho com as categorias marcadas', async () => {
    service.create.mockResolvedValue({ ...article({ id: 'a3', title: 'Reset de MFA' }), content: 'Passo a passo.' } as any)
    await openNew()
    fillForm()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Redes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(service.create).toHaveBeenCalledWith({ title: 'Reset de MFA', content: 'Passo a passo.', categoryIds: ['c2'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(service.publish).not.toHaveBeenCalled()
    expect(service.list).toHaveBeenCalledTimes(2)
  })

  it('oferece só categorias ativas', async () => {
    await openNew()
    await screen.findByRole('checkbox', { name: 'Infra' })
    expect(screen.queryByRole('checkbox', { name: /Legado/ })).not.toBeInTheDocument()
  })

  it('mantém categoria inativa já vinculada ao editar, para o salvar não desfazer o vínculo', async () => {
    await openExisting('Como trocar a senha', { ...article({ categories: [{ id: 'c3', name: 'Legado', active: false }] }), content: 'Texto.' })
    expect(await screen.findByRole('checkbox', { name: /Legado/ })).toBeChecked()
    service.update.mockResolvedValue({ ...article(), content: 'Texto.' } as any)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a1', expect.objectContaining({ categoryIds: ['c3'] })))
  })

  it('exige título e conteúdo antes de chamar a API', async () => {
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    expect(await screen.findByText('Informe o título')).toBeInTheDocument()
    expect(screen.getByText('Informe o conteúdo')).toBeInTheDocument()
    expect(screen.getByLabelText('Título')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Título')).toHaveFocus()
    expect(service.create).not.toHaveBeenCalled()
  })

  it('publica um artigo novo: cria e depois publica', async () => {
    service.create.mockResolvedValue({ ...article({ id: 'a3' }), content: 'Passo a passo.' } as any)
    service.publish.mockResolvedValue({ ...article({ id: 'a3', status: 'published' }), content: 'Passo a passo.' } as any)
    await openNew()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => expect(service.publish).toHaveBeenCalledWith('a3'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('publicar sem categoria mostra a mensagem do backend e o retry não duplica o artigo', async () => {
    service.create.mockResolvedValue({ ...article({ id: 'a3', categories: [] }), content: 'Passo a passo.' } as any)
    service.update.mockResolvedValue({ ...article({ id: 'a3' }), content: 'Passo a passo.' } as any)
    service.publish.mockRejectedValueOnce(apiError(422, NO_CATEGORY))
    await openNew()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(NO_CATEGORY)
    expect(screen.getByRole('dialog', { name: 'Editar artigo' })).toBeInTheDocument()

    service.publish.mockResolvedValue({ ...article({ id: 'a3', status: 'published' }), content: 'Passo a passo.' } as any)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Infra' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a3', expect.objectContaining({ categoryIds: ['c1'] })))
    await waitFor(() => expect(service.publish).toHaveBeenCalledTimes(2))
    expect(service.create).toHaveBeenCalledTimes(1)
  })

  it('falha de IA ao publicar deixa claro que o artigo segue como rascunho', async () => {
    service.update.mockResolvedValue({ ...article(), content: 'Texto.' } as any)
    service.publish.mockRejectedValue(apiError(503, AI_DOWN))
    await openExisting('Como trocar a senha', { ...article(), content: 'Texto.' })
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('segue como rascunho')
    expect(alert).toHaveTextContent(AI_DOWN)
    expect(screen.getByRole('dialog', { name: 'Editar artigo' })).toBeInTheDocument()
  })

  it('artigo publicado avisa da reindexação e não oferece salvar como rascunho', async () => {
    service.update.mockResolvedValue({ ...article({ status: 'published' }), content: 'Novo.' } as any)
    await openExisting('Manual da VPN', { ...article({ id: 'a2', title: 'Manual da VPN', status: 'published' }), content: 'Texto.' })
    expect(screen.getByText(/será reindexado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Conteúdo'), { target: { value: 'Novo.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(service.update).toHaveBeenCalledWith('a2', expect.objectContaining({ content: 'Novo.' })))
  })

  it('falha de IA ao salvar publicado diz que a versão anterior continua no ar', async () => {
    service.update.mockRejectedValue(apiError(503, AI_DOWN))
    await openExisting('Manual da VPN', { ...article({ id: 'a2', title: 'Manual da VPN', status: 'published' }), content: 'Texto.' })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('segue publicado com o texto anterior')
  })

  it('pede confirmação antes de descartar o que foi digitado', async () => {
    await openNew()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    const confirm = await screen.findByRole('dialog', { name: 'Descartar alterações?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Continuar editando' }))
    expect(screen.getByLabelText('Título')).toHaveValue(' Reset de MFA ')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Descartar alterações?' })).getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('leva o foco ao título ao abrir e fecha com Esc quando não há o que perder', async () => {
    const dialog = await openNew()
    expect(screen.getByLabelText('Título')).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('KnowledgeBasePanel: importar', () => {
  const sized = (name: string, size: number) => {
    const file = new File(['x'], name)
    Object.defineProperty(file, 'size', { value: size })
    return file
  }

  it('recusa arquivo acima de 10 MB sem chamar a API', async () => {
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    pickFile(sized('manual.pdf', 10 * 1024 * 1024 + 1))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('10 MB')))
    expect(service.importFile).not.toHaveBeenCalled()
  })

  it('aceita o arquivo de exatamente 10 MB', async () => {
    service.importFile.mockResolvedValue({ ...article({ id: 'a4', source_filename: 'manual.pdf', categories: [] }), content: 'Extraído.' } as any)
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    const limit = sized('manual.pdf', 10 * 1024 * 1024)
    pickFile(limit)
    await waitFor(() => expect(service.importFile).toHaveBeenCalledWith(limit))
  })

  it('recusa tipo não suportado sem chamar a API', async () => {
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    pickFile(new File(['x'], 'planilha.xlsx'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('PDF, DOCX, TXT')))
    expect(service.importFile).not.toHaveBeenCalled()
  })

  it('abre o rascunho criado para revisão', async () => {
    service.importFile.mockResolvedValue({ ...article({ id: 'a4', title: 'manual', source_filename: 'manual.md', categories: [] }), content: 'Texto extraído.' } as any)
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    pickFile(new File(['# oi'], 'manual.md'))
    const dialog = await screen.findByRole('dialog', { name: 'Editar artigo' })
    expect(within(dialog).getByLabelText('Conteúdo')).toHaveValue('Texto extraído.')
    expect(within(dialog).getByText('manual.md')).toBeInTheDocument()
    expect(service.get).not.toHaveBeenCalled()
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2))
  })

  it('mostra o erro do servidor quando o arquivo não pode ser lido', async () => {
    service.importFile.mockRejectedValue(apiError(422, 'O PDF não tem texto para extrair'))
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    pickFile(new File(['x'], 'scan.pdf'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O PDF não tem texto para extrair'))
  })
})

describe('KnowledgeBasePanel: despublicar e excluir', () => {
  it('só exclui depois de confirmar', async () => {
    service.remove.mockResolvedValue(undefined as any)
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Como trocar a senha' }))
    const first = await screen.findByRole('dialog', { name: 'Excluir artigo' })
    expect(first).toHaveTextContent('Como trocar a senha')
    expect(service.remove).not.toHaveBeenCalled()
    fireEvent.click(within(first).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(service.remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Como trocar a senha' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Excluir artigo' })).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(service.remove).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2))
  })

  it('despublica só artigo publicado', async () => {
    service.unpublish.mockResolvedValue({ ...article({ id: 'a2' }), content: 'x' } as any)
    render(<KnowledgeBasePanel />)
    await screen.findByText('Manual da VPN')
    expect(screen.queryByRole('button', { name: 'Despublicar Como trocar a senha' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Despublicar Manual da VPN' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Despublicar artigo' })).getByRole('button', { name: 'Despublicar' }))
    await waitFor(() => expect(service.unpublish).toHaveBeenCalledWith('a2'))
  })

  it('mostra o erro da API ao excluir', async () => {
    service.remove.mockRejectedValue(apiError(404, 'Artigo não encontrado'))
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Como trocar a senha' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Excluir artigo' })).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Artigo não encontrado'))
  })
})

describe('KnowledgeBasePanel: lacunas', () => {
  const gap = (i: number) => ({ example: `Pergunta ${i}\nDescrição ${i}`, title: `Pergunta ${i}`, count: 20 - i, last_at: '2026-11-03T12:00:00.000Z' })
  const result = (extra: object = {}) => ({ days: 30, gaps: Array.from({ length: 10 }, (_, i) => gap(i + 1)), analyzed: 120, truncated: false, grouped_by: 'subject', ...extra })
  const openGaps = async () => {
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    fireEvent.click(screen.getByRole('tab', { name: 'Lacunas' }))
  }

  beforeEach(() => { service.gaps.mockReset(); service.gaps.mockResolvedValue(result() as any) })

  it('só busca as lacunas ao abrir a aba, e a lista de artigos sai de cena', async () => {
    render(<KnowledgeBasePanel />)
    await screen.findByText('Como trocar a senha')
    expect(service.gaps).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Lacunas' }))
    await screen.findByRole('table', { name: 'Perguntas mais frequentes sem resposta' })
    expect(service.gaps).toHaveBeenCalledWith(30)
    expect(screen.queryByText('Como trocar a senha')).not.toBeInTheDocument()
  })

  it('mostra as dez perguntas com quantidade e última ocorrência', async () => {
    await openGaps()
    const table = await screen.findByRole('table', { name: 'Perguntas mais frequentes sem resposta' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(10)
    expect(within(rows[0]).getByText(/Pergunta 1/)).toBeInTheDocument()
    expect(within(rows[0]).getByText('19')).toBeInTheDocument()
    expect(within(rows[0]).getByText(new Date('2026-11-03T12:00:00.000Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))).toBeInTheDocument()
  })

  it('"Criar artigo a partir disso" abre o formulário novo com o título sugerido', async () => {
    await openGaps()
    fireEvent.click(await screen.findByRole('button', { name: 'Criar artigo a partir disso: Pergunta 3' }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo artigo' })
    expect(within(dialog).getByLabelText('Título')).toHaveValue('Pergunta 3')
    expect(within(dialog).getByLabelText('Conteúdo')).toHaveValue('')
  })

  it('"Novo artigo" depois disso volta a abrir em branco', async () => {
    await openGaps()
    fireEvent.click(await screen.findByRole('button', { name: 'Criar artigo a partir disso: Pergunta 3' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Novo artigo' })).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Novo artigo' }))
    expect(within(await screen.findByRole('dialog', { name: 'Novo artigo' })).getByLabelText('Título')).toHaveValue('')
  })

  it('troca o período', async () => {
    await openGaps()
    await screen.findByRole('table', { name: 'Perguntas mais frequentes sem resposta' })
    fireEvent.change(screen.getByLabelText('Período das lacunas'), { target: { value: '90' } })
    await waitFor(() => expect(service.gaps).toHaveBeenLastCalledWith(90))
  })

  it('avisa quando agrupou só por texto e quando analisou parte das interações', async () => {
    service.gaps.mockResolvedValue(result({ grouped_by: 'text', truncated: true, analyzed: 500 }) as any)
    await openGaps()
    expect(await screen.findByText(/IA indisponível/)).toBeInTheDocument()
    expect(screen.getByText(/500 interações mais recentes/)).toBeInTheDocument()
  })

  it('sem lacunas no período', async () => {
    service.gaps.mockResolvedValue(result({ gaps: [], analyzed: 0 }) as any)
    await openGaps()
    expect(await screen.findByText('Nenhuma lacuna no período')).toBeInTheDocument()
  })

  it('erro com nova tentativa', async () => {
    service.gaps.mockRejectedValueOnce(apiError(500, 'Falhou'))
    await openGaps()
    expect(await screen.findByRole('alert')).toHaveTextContent('Falhou')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('table', { name: 'Perguntas mais frequentes sem resposta' })).toBeInTheDocument()
  })
})
