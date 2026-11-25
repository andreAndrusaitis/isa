import { render, screen, fireEvent } from '@testing-library/react'
import { FilterDropdown } from './FilterDropdown'
import { FilterSelect } from './FilterSelect'

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  savedFilters: [],
  onSelectSaved: vi.fn(),
  onSaveNew: vi.fn(),
  onDeleteSaved: vi.fn(),
  onApply: vi.fn(),
  onClear: vi.fn(),
  dateFrom: '',
  dateTo: '',
  onDateFromChange: vi.fn(),
  onDateToChange: vi.fn(),
}

beforeEach(() => vi.clearAllMocks())

describe('FilterDropdown', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<FilterDropdown {...baseProps} isOpen={false}><div /></FilterDropdown>)
    expect(container.firstChild).toBeNull()
  })

  it('renders saved filter pills', () => {
    const saved = [{ id: '1', name: 'Urgentes TI', filters: {} }]
    render(<FilterDropdown {...baseProps} savedFilters={saved}><div /></FilterDropdown>)
    expect(screen.getByText('Urgentes TI')).toBeInTheDocument()
  })

  it('calls onSelectSaved and onClose when pill is clicked', () => {
    const saved = [{ id: '1', name: 'Urgentes TI', filters: {} }]
    const onSelectSaved = vi.fn()
    const onClose = vi.fn()
    render(<FilterDropdown {...baseProps} savedFilters={saved} onSelectSaved={onSelectSaved} onClose={onClose}><div /></FilterDropdown>)
    fireEvent.click(screen.getByText('Urgentes TI'))
    expect(onSelectSaved).toHaveBeenCalledWith(saved[0])
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onDeleteSaved when pill X is clicked', () => {
    const saved = [{ id: '1', name: 'Urgentes TI', filters: {} }]
    const onDeleteSaved = vi.fn()
    render(<FilterDropdown {...baseProps} savedFilters={saved} onDeleteSaved={onDeleteSaved}><div /></FilterDropdown>)
    fireEvent.click(screen.getByRole('button', { name: /excluir filtro urgentes/i }))
    expect(onDeleteSaved).toHaveBeenCalledWith('1')
  })

  it('shows save input when Salvar atual is clicked', () => {
    render(<FilterDropdown {...baseProps}><div /></FilterDropdown>)
    fireEvent.click(screen.getByText('+ Salvar atual'))
    expect(screen.getByPlaceholderText('Nome do filtro...')).toBeInTheDocument()
  })

  it('calls onSaveNew with the typed name on Enter', () => {
    const onSaveNew = vi.fn()
    render(<FilterDropdown {...baseProps} onSaveNew={onSaveNew}><div /></FilterDropdown>)
    fireEvent.click(screen.getByText('+ Salvar atual'))
    const input = screen.getByPlaceholderText('Nome do filtro...')
    fireEvent.change(input, { target: { value: 'Meu Filtro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSaveNew).toHaveBeenCalledWith('Meu Filtro')
  })

  it('calls onClear when Limpar tudo is clicked', () => {
    const onClear = vi.fn()
    render(<FilterDropdown {...baseProps} onClear={onClear}><div /></FilterDropdown>)
    fireEvent.click(screen.getByRole('button', { name: /limpar tudo/i }))
    expect(onClear).toHaveBeenCalled()
  })

  it('calls onApply and onClose when Aplicar filtros is clicked', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FilterDropdown {...baseProps} onApply={onApply} onClose={onClose}><div /></FilterDropdown>)
    fireEvent.click(screen.getByRole('button', { name: /aplicar filtros/i }))
    expect(onApply).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows date inputs by default', () => {
    render(<FilterDropdown {...baseProps}><div /></FilterDropdown>)
    expect(screen.getByLabelText('Data de')).toBeInTheDocument()
    expect(screen.getByLabelText('Data até')).toBeInTheDocument()
  })

  it('hides date inputs when showDateFilter is false', () => {
    render(<FilterDropdown {...baseProps} showDateFilter={false}><div /></FilterDropdown>)
    expect(screen.queryByLabelText('Data de')).not.toBeInTheDocument()
  })

  it('picking an option in a searchable field keeps the filter open and selects it', () => {
    const onClose = vi.fn()
    const onChange = vi.fn()
    render(
      <FilterDropdown {...baseProps} onClose={onClose}>
        <FilterSelect value="all" onChange={onChange}>
          <option value="all">Todas as empresas</option>
          <option value="a">Akaer engenharia</option>
        </FilterSelect>
      </FilterDropdown>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Todas as empresas' }))
    fireEvent.change(screen.getByPlaceholderText('Pesquisar...'), { target: { value: 'akaer' } })
    const option = screen.getByRole('option', { name: 'Akaer engenharia' })
    fireEvent.mouseDown(option)
    fireEvent.click(option)
    expect(onClose).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('never positions the panel outside a narrow viewport', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 568 })
    render(<FilterDropdown {...baseProps}><div /></FilterDropdown>)
    const panel = screen.getByRole('button', { name: /aplicar filtros/i }).closest('div[style*="position: fixed"]') as HTMLElement
    expect(panel).not.toBeNull()
    const left = parseFloat(panel.style.left)
    const width = panel.getBoundingClientRect().width || parseFloat(getComputedStyle(panel).width)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left + width).toBeLessThanOrEqual(320)
  })
})
