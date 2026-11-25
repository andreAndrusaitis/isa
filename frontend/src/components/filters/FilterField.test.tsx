import { render, screen } from '@testing-library/react'
import { FilterField } from './FilterField'

describe('FilterField', () => {
  it('renders the label and the children control', () => {
    render(
      <FilterField label="Status">
        <select aria-label="Status" defaultValue="all">
          <option value="all">Todos</option>
        </select>
      </FilterField>
    )
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument()
  })
})
