import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TagPicker } from './TagPicker'

const tags = [
  { id: 't1', projectId: 'p1', name: 'bug', color: '#dc2626' },
  { id: 't2', projectId: 'p1', name: 'feature', color: '#2563eb' },
] as any

describe('TagPicker', () => {
  it('busca, marca/desmarca e cria tag com a cor escolhida', async () => {
    const onToggle = vi.fn()
    const onCreate = vi.fn()
    render(<TagPicker projectTags={tags} selectedIds={['t1']} onToggle={onToggle} onCreate={onCreate} />)
    fireEvent.click(screen.getByTitle('Adicionar tag'))

    expect(screen.getByRole('option', { name: /bug/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /bug/ }))
    expect(onToggle).toHaveBeenCalledWith('t1', false)

    const search = screen.getByLabelText('Buscar ou criar tag')
    fireEvent.change(search, { target: { value: 'feat' } })
    expect(screen.queryByRole('option', { name: /bug/ })).toBeNull()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledWith('t2', true)

    fireEvent.change(search, { target: { value: 'homologação' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cor #3a7f6b' }))
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('homologação', '#3a7f6b'))
  })

  it('Esc fecha o seletor', () => {
    render(<TagPicker projectTags={tags} selectedIds={[]} onToggle={vi.fn()} onCreate={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Adicionar tag'))
    fireEvent.keyDown(screen.getByLabelText('Buscar ou criar tag'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
