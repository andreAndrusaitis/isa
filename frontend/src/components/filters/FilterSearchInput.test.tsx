import { render, screen, fireEvent } from '@testing-library/react'
import { FilterSearchInput } from './FilterSearchInput'

describe('FilterSearchInput', () => {
  it('renders the value and calls onChange on typing', () => {
    const onChange = vi.fn()
    render(<FilterSearchInput value="" onChange={onChange} placeholder="Buscar..." />)
    const input = screen.getByPlaceholderText('Buscar...')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(onChange).toHaveBeenCalledWith('abc')
  })
})
