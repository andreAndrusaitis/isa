import { render, screen, fireEvent } from '@testing-library/react'
import { FilterButton } from './FilterButton'

const noop = () => {}

describe('FilterButton', () => {
  it('renders the filter icon button', () => {
    render(<FilterButton activeCount={0} activeSavedFilter={null} onOpen={noop} onClearSaved={noop} isOpen={false} />)
    expect(screen.getByRole('button', { name: /filtros/i })).toBeInTheDocument()
  })

  it('shows count badge when activeCount > 0 and no saved filter active', () => {
    render(<FilterButton activeCount={3} activeSavedFilter={null} onOpen={noop} onClearSaved={noop} isOpen={false} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('does not show badge when activeSavedFilter is set', () => {
    const sf = { id: '1', name: 'Urgentes', filters: {} }
    render(<FilterButton activeCount={3} activeSavedFilter={sf} onOpen={noop} onClearSaved={noop} isOpen={false} />)
    expect(screen.queryByText('3')).not.toBeInTheDocument()
    expect(screen.getByText('Urgentes')).toBeInTheDocument()
  })

  it('calls onClearSaved when pill X is clicked', () => {
    const onClearSaved = vi.fn()
    const sf = { id: '1', name: 'Urgentes', filters: {} }
    render(<FilterButton activeCount={0} activeSavedFilter={sf} onOpen={noop} onClearSaved={onClearSaved} isOpen={false} />)
    fireEvent.click(screen.getByRole('button', { name: /remover/i }))
    expect(onClearSaved).toHaveBeenCalledOnce()
  })

  it('calls onOpen when icon button is clicked', () => {
    const onOpen = vi.fn()
    render(<FilterButton activeCount={0} activeSavedFilter={null} onOpen={onOpen} onClearSaved={noop} isOpen={false} />)
    fireEvent.click(screen.getByRole('button', { name: /filtros/i }))
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
