import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import { CategoriesPanel, validateSpecialSelectFields } from './CategoriesPanel'
import { adminService } from '@/services/adminService'

vi.mock('@/services/adminService', () => ({
  adminService: {
    getCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    createSubcategory: vi.fn(),
    updateSubcategory: vi.fn(),
    deleteSubcategory: vi.fn(),
    getCategoryOrgSummary: vi.fn(),
    getCategoryOrgs: vi.fn(),
    setCategoryOrgs: vi.fn(),
  },
}))

beforeEach(() => {
  vi.mocked(adminService.getCategoryOrgSummary).mockResolvedValue({})
})

vi.mock('@/store/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const baseCategory = {
  id: 'cat1',
  name: 'Infraestrutura',
  color: '#0f73ac',
  description: '',
  subcategories: [],
}

describe('validateSpecialSelectFields', () => {
  it('accepts a configured single-select field', () => {
    expect(validateSpecialSelectFields([
      {
        key: 'ambiente',
        label: 'Ambiente',
        type: 'select',
        required: true,
        multiple: false,
        options: [{ value: 'production', label: 'Produção' }],
      },
    ])).toBeNull()
  })

  it('rejects a select without options or with duplicate values', () => {
    expect(validateSpecialSelectFields([
      { key: 'ambiente', label: 'Ambiente', type: 'select', required: true, options: [] },
    ])).toMatch(/ao menos uma opção/)

    expect(validateSpecialSelectFields([
      {
        key: 'ambiente', label: 'Ambiente', type: 'select', required: true,
        options: [{ value: 'prod', label: 'Produção' }, { value: 'prod', label: 'Produção 2' }],
      },
    ])).toMatch(/não podem repetir/)
  })
})

describe('CategoriesPanel — modal de subcategoria especial', () => {
  beforeEach(() => {
    vi.mocked(adminService.getCategories).mockResolvedValue([baseCategory])
    vi.mocked(adminService.getCategoryOrgSummary).mockResolvedValue({ cat1: { enabled: 34, total: 40 } })
    vi.mocked(adminService.getCategoryOrgs).mockResolvedValue({ inPlan: [], outOfPlan: [] })
  })

  it('mostra o contador de empresas e abre a gestão por categoria', async () => {
    render(<CategoriesPanel />)
    const btn = await screen.findByRole('button', { name: /Empresas 34\/40/ })
    fireEvent.click(btn)
    expect(await screen.findByText('Empresas com acesso — Infraestrutura')).toBeInTheDocument()
    expect(adminService.getCategoryOrgs).toHaveBeenCalledWith('cat1')
  })

  it('abre campo recém-adicionado já expandido, com foco no rótulo', async () => {
    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Adicionar'))
    const specialToggleRow = screen.getByText('Chamado especial').parentElement!.parentElement!
    fireEvent.click(within(specialToggleRow).getByRole('switch'))
    fireEvent.click(screen.getByText('Adicionar campo'))

    const labelInput = screen.getByPlaceholderText('Rótulo (ex: Nome completo)')
    await waitFor(() => expect(labelInput).toHaveFocus())
  })

  it('card de campo abre fechado por padrão e expande ao clicar no cabeçalho', async () => {
    const subWithField = {
      id: 'sub1',
      name: 'Criação de usuário',
      description: '',
      is_special: true,
      special_title_template: 'Criação — {nome_completo}',
      special_form_schema: [
        { key: 'nome_completo', label: 'Nome completo', type: 'text', required: true },
      ],
    }
    vi.mocked(adminService.getCategories).mockResolvedValue([
      { ...baseCategory, subcategories: [subWithField] },
    ])

    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Criação de usuário'))

    const fieldsSection = screen.getByText('Campos do formulário').parentElement!

    expect(screen.queryByPlaceholderText('Rótulo (ex: Nome completo)')).not.toBeInTheDocument()
    expect(within(fieldsSection).getByText('Nome completo')).toBeInTheDocument()
    expect(within(fieldsSection).getByText('Texto curto')).toBeInTheDocument()
    expect(within(fieldsSection).getByText('Obrig.')).toBeInTheDocument()

    fireEvent.click(within(fieldsSection).getByText('Nome completo'))
    expect(screen.getByPlaceholderText('Rótulo (ex: Nome completo)')).toBeInTheDocument()
  })

  it('estado de expansão acompanha o campo ao reordenar', async () => {
    const subWithFields = {
      id: 'sub1',
      name: 'Criação de usuário',
      description: '',
      is_special: true,
      special_title_template: '',
      special_form_schema: [
        { key: 'campo_a', label: 'Campo A', type: 'text', required: false },
        { key: 'campo_b', label: 'Campo B', type: 'text', required: false },
      ],
    }
    vi.mocked(adminService.getCategories).mockResolvedValue([
      { ...baseCategory, subcategories: [subWithFields] },
    ])

    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Criação de usuário'))

    const fieldsSection = screen.getByText('Campos do formulário').parentElement!

    // Expand "Campo A" (first field)
    fireEvent.click(within(fieldsSection).getByText('Campo A'))
    expect(screen.getByPlaceholderText('Rótulo (ex: Nome completo)')).toBeInTheDocument()
    expect((screen.getByPlaceholderText('Rótulo (ex: Nome completo)') as HTMLInputElement).value).toBe('Campo A')

    // Move "Campo A" down one slot (swaps with Campo B). The header for Campo A's
    // card has three buttons: [move-up, move-down, remove(X)] — move-down is index 1.
    const campoAHeader = within(fieldsSection).getByText('Campo A').closest('div')!
    const campoAButtons = within(campoAHeader).getAllByRole('button')
    fireEvent.click(campoAButtons[1])

    // After reorder, Campo B is now first, Campo A is now second — but Campo A
    // should STILL be the one expanded (state follows the field, not the slot).
    // Only one card should be expanded (one label input rendered), and it must
    // belong to Campo A, not whichever field now sits in the originally-open slot.
    expect(screen.getAllByPlaceholderText('Rótulo (ex: Nome completo)')).toHaveLength(1)
    const openLabelInput = screen.getByPlaceholderText('Rótulo (ex: Nome completo)') as HTMLInputElement
    expect(openLabelInput.value).toBe('Campo A')
    expect(within(fieldsSection).getByText('Campo B')).toBeInTheDocument()
  })

  it('clicar no chip de chave insere {chave} no template do título', async () => {
    const subWithField = {
      id: 'sub1',
      name: 'Criação de usuário',
      description: '',
      is_special: true,
      special_title_template: 'Criação — ',
      special_form_schema: [
        { key: 'nome_completo', label: 'Nome completo', type: 'text', required: true },
      ],
    }
    vi.mocked(adminService.getCategories).mockResolvedValue([
      { ...baseCategory, subcategories: [subWithField] },
    ])

    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Criação de usuário'))

    fireEvent.click(screen.getByText('{nome_completo}'))

    const templateInput = screen.getByPlaceholderText('Ex: Criação de usuário — {nome_completo}') as HTMLInputElement
    expect(templateInput.value).toContain('{nome_completo}')
  })

  it('mostra hint quando não há campos com chave definida ainda', async () => {
    vi.mocked(adminService.getCategories).mockResolvedValue([baseCategory])
    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Adicionar'))
    const specialToggleRow = screen.getByText('Chamado especial').parentElement!.parentElement!
    fireEvent.click(within(specialToggleRow).getByRole('switch'))

    expect(screen.getByText('Adicione campos para ver as chaves disponíveis.')).toBeInTheDocument()
  })

  it('mostra preview ao vivo com título gerado e campos quando chamado especial está ativo', async () => {
    const subWithField = {
      id: 'sub1',
      name: 'Criação de usuário',
      description: '',
      is_special: true,
      special_title_template: 'Criação — {nome_completo}',
      special_form_schema: [
        { key: 'nome_completo', label: 'Nome completo', type: 'text', required: true },
      ],
    }
    vi.mocked(adminService.getCategories).mockResolvedValue([
      { ...baseCategory, subcategories: [subWithField] },
    ])

    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Criação de usuário'))

    expect(screen.getByText('Pré-visualização')).toBeInTheDocument()
    expect(screen.getByText('Criação — [Nome completo]')).toBeInTheDocument()
  })

  it('preview mostra placeholder quando o template está vazio e some quando não é especial', async () => {
    vi.mocked(adminService.getCategories).mockResolvedValue([baseCategory])
    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Adicionar'))

    expect(screen.queryByText('Pré-visualização')).not.toBeInTheDocument()

    const specialToggleRow = screen.getByText('Chamado especial').parentElement!.parentElement!
    fireEvent.click(within(specialToggleRow).getByRole('switch'))

    expect(screen.getByText('Pré-visualização')).toBeInTheDocument()
    expect(screen.getByText('O título aparecerá aqui')).toBeInTheDocument()
  })

  it('preview renderiza placeholder por tipo de campo, asterisco de obrigatório e estado vazio', async () => {
    const subWithFields = {
      id: 'sub1',
      name: 'Criação de usuário',
      description: '',
      is_special: true,
      special_title_template: '',
      special_form_schema: [
        { key: 'ambiente', label: 'Ambiente', type: 'select', required: true, options: [{ value: 'prod', label: 'Produção' }] },
        { key: 'obs', label: 'Observações', type: 'textarea', required: false },
      ],
    }
    vi.mocked(adminService.getCategories).mockResolvedValue([
      { ...baseCategory, subcategories: [subWithFields] },
    ])

    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Criação de usuário'))

    const previewCard = screen.getByText('Pré-visualização').parentElement!.nextElementSibling as HTMLElement
    expect(within(previewCard).getByText('Produção')).toBeInTheDocument()
    expect(within(previewCard).getByText('Texto do usuário...')).toBeInTheDocument()
    expect(within(previewCard).getByText('Ambiente')).toBeInTheDocument()
    expect(within(previewCard).getByText('*')).toBeInTheDocument()
  })

  it('preview mostra estado vazio quando não há campos configurados', async () => {
    const subNoFields = {
      id: 'sub1',
      name: 'Criação de usuário',
      description: '',
      is_special: true,
      special_title_template: '',
      special_form_schema: [],
    }
    vi.mocked(adminService.getCategories).mockResolvedValue([
      { ...baseCategory, subcategories: [subNoFields] },
    ])

    render(<CategoriesPanel />)
    fireEvent.click(await screen.findByText('Criação de usuário'))

    expect(screen.getByText('Adicione campos para ver o formulário')).toBeInTheDocument()
  })
})

describe('CategoriesPanel — exibição e cópia de IDs', () => {
  const sampleCategory = {
    id: 'cat-uuid-001',
    name: 'Hardware',
    color: '#0f73ac',
    description: 'Problemas físicos',
    subcategories: [
      {
        id: 'sub-uuid-101',
        name: 'Notebook',
        description: 'Reparos em notebooks',
        is_special: false,
      },
    ],
  }

  beforeEach(() => {
    vi.mocked(adminService.getCategories).mockResolvedValue([sampleCategory])
  })

  it('exibe o ID no rodapé do card da categoria e permite cópia', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<CategoriesPanel />)
    expect(await screen.findByText('cat-uuid-001')).toBeInTheDocument()

    const copyCatBtn = screen.getByTitle('Copiar ID: cat-uuid-001')
    await act(async () => {
      fireEvent.click(copyCatBtn)
    })
    expect(writeText).toHaveBeenCalledWith('cat-uuid-001')
  })

  it('exibe o ID na etiqueta da subcategoria no hover e copia com 1 clique no ícone', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<CategoriesPanel />)
    const subTag = (await screen.findByText('Notebook')).closest('span')
    expect(subTag).toHaveAttribute('data-tooltip', 'ID: sub-uuid-101')

    const copySubBtn = screen.getByTitle('Copiar ID: sub-uuid-101')
    await act(async () => {
      fireEvent.click(copySubBtn)
    })
    expect(writeText).toHaveBeenCalledWith('sub-uuid-101')
    // Não deve abrir o modal de edição ao clicar no ícone de cópia
    expect(screen.queryByText('Editar subcategoria')).not.toBeInTheDocument()
  })

  it('exibe o ID no modal de edição da categoria', async () => {
    render(<CategoriesPanel />)
    const editBtn = await screen.findByRole('button', { name: /editar/i })
    fireEvent.click(editBtn)

    expect(await screen.findByText('Editar categoria')).toBeInTheDocument()
    expect(screen.getByText('ID da categoria')).toBeInTheDocument()
    expect(screen.getAllByText('cat-uuid-001').length).toBeGreaterThanOrEqual(1)
  })

  it('exibe o ID no modal de edição da subcategoria', async () => {
    render(<CategoriesPanel />)
    const subTag = await screen.findByText('Notebook')
    fireEvent.click(subTag)

    expect(await screen.findByText('Editar subcategoria')).toBeInTheDocument()
    expect(screen.getByText('ID da subcategoria')).toBeInTheDocument()
    expect(screen.getByText('sub-uuid-101')).toBeInTheDocument()
  })
})
