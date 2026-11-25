import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchableSelect, toggleCsv } from './SearchableSelect'

const mockOptions = [
  { value: 'all', label: 'Todas as empresas' },
  { value: '1', label: 'Índigo Terminais' },
  { value: '2', label: 'Boreal Papelaria' },
  { value: '3', label: 'Brisa Seguros' },
  { value: '4', label: 'Duna Transportes' },
]

describe('SearchableSelect', () => {
  it('renders trigger with selected option label', () => {
    render(
      <SearchableSelect
        value="1"
        onChange={() => {}}
        options={mockOptions}
        placeholder="Selecione a empresa..."
      />
    )
    expect(screen.getByRole('button', { name: /índigo terminais/i })).toBeInTheDocument()
  })

  it('renders placeholder when no option is selected', () => {
    render(
      <SearchableSelect
        value=""
        onChange={() => {}}
        options={mockOptions}
        placeholder="Selecione a empresa..."
      />
    )
    expect(screen.getByRole('button', { name: /selecione a empresa/i })).toBeInTheDocument()
  })

  it('opens panel and allows filtering with and without accents', () => {
    render(
      <SearchableSelect
        value="all"
        onChange={() => {}}
        options={mockOptions}
        searchPlaceholder="Buscar empresa..."
      />
    )

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /todas as empresas/i }))

    // Search input should be visible
    const searchInput = screen.getByPlaceholderText('Buscar empresa...')
    expect(searchInput).toBeInTheDocument()

    // Type without accent "indigo"
    fireEvent.change(searchInput, { target: { value: 'indigo' } })

    // Índigo Terminais should match
    expect(screen.getByText('Índigo Terminais')).toBeInTheDocument()
    // Boreal Papelaria should not be in the filtered list
    expect(screen.queryByText('Boreal Papelaria')).not.toBeInTheDocument()
  })

  it('calls onChange and closes when an option is clicked', () => {
    const handleChange = vi.fn()
    render(
      <SearchableSelect
        value="all"
        onChange={handleChange}
        options={mockOptions}
        searchPlaceholder="Buscar empresa..."
      />
    )

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /todas as empresas/i }))

    // Click Boreal Papelaria
    fireEvent.click(screen.getByText('Boreal Papelaria'))

    expect(handleChange).toHaveBeenCalledWith('2')
    // After selection, panel should close
    expect(screen.queryByPlaceholderText('Buscar empresa...')).not.toBeInTheDocument()
  })

  it('displays emptyText when query does not match any option', () => {
    render(
      <SearchableSelect
        value="all"
        onChange={() => {}}
        options={mockOptions}
        emptyText="Nenhuma empresa encontrada"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /todas as empresas/i }))
    const searchInput = screen.getByRole('textbox')
    fireEvent.change(searchInput, { target: { value: 'XYZNAOEXISTE' } })

    expect(screen.getByText('Nenhuma empresa encontrada')).toBeInTheDocument()
  })

  it('closes when Escape key is pressed', () => {
    render(
      <SearchableSelect
        value="all"
        onChange={() => {}}
        options={mockOptions}
        searchPlaceholder="Buscar empresa..."
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /todas as empresas/i }))
    expect(screen.getByPlaceholderText('Buscar empresa...')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByPlaceholderText('Buscar empresa...'), { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Buscar empresa...')).not.toBeInTheDocument()
  })
})

describe('toggleCsv', () => {
  it('marca, desmarca, "Todos" limpa e vazio volta ao fallback', () => {
    expect(toggleCsv('all', 'open', ['all'], 'all')).toBe('open')
    expect(toggleCsv('open', 'in_progress', ['all'], 'all')).toBe('open,in_progress')
    expect(toggleCsv('open,in_progress', 'open', ['all'], 'all')).toBe('in_progress')
    expect(toggleCsv('in_progress', 'in_progress', ['all'], 'all')).toBe('all')
    expect(toggleCsv('open,in_progress', 'all', ['all'], 'all')).toBe('all')
    expect(toggleCsv('active', 'resolved', ['all', 'active'], 'all')).toBe('resolved')
  })
})

describe('SearchableSelect multiple', () => {
  it('soma seleções sem fechar e mostra os rótulos marcados', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SearchableSelect multiple value="1" onChange={onChange} options={mockOptions} searchPlaceholder="Buscar empresa..." />)
    fireEvent.click(screen.getByRole('button', { name: 'Índigo Terminais' }))
    fireEvent.click(screen.getByRole('option', { name: 'Boreal Papelaria' }))
    expect(onChange).toHaveBeenCalledWith('1,2')
    expect(screen.getByPlaceholderText('Buscar empresa...')).toBeInTheDocument()

    rerender(<SearchableSelect multiple value="1,2" onChange={onChange} options={mockOptions} searchPlaceholder="Buscar empresa..." />)
    expect(screen.getByRole('button', { name: 'Índigo Terminais, Boreal Papelaria' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Boreal Papelaria' })).toHaveAttribute('aria-selected', 'true')
  })
})
