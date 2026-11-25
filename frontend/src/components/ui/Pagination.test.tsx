import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Pagination, pageItems } from './Pagination'

describe('pageItems', () => {
  it('poucas páginas: lista todas', () => {
    expect(pageItems(1, 1)).toEqual([1])
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
  it('início, meio e fim com reticências', () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, '…', 20])
    expect(pageItems(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20])
    expect(pageItems(20, 20)).toEqual([1, '…', 16, 17, 18, 19, 20])
  })
  it('sempre 7 itens quando há muitas páginas', () => {
    for (let p = 1; p <= 30; p++) expect(pageItems(p, 30)).toHaveLength(7)
  })
})

describe('Pagination component', () => {
  it('não renderiza nada se total === 0', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={25}
        total={0}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renderiza variant="toolbar" com info compacta e controles', () => {
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()

    render(
      <Pagination
        variant="toolbar"
        page={1}
        pageSize={25}
        total={100}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    )

    expect(screen.getByText('1–25 de 100')).toBeInTheDocument()
    expect(screen.getByText('Por página')).toBeInTheDocument()
    expect(screen.getByText('página 1')).toBeInTheDocument()

    // Testar troca de página
    const nextBtn = screen.getByLabelText('Próxima página')
    fireEvent.click(nextBtn)
    expect(onPageChange).toHaveBeenCalledWith(2)

    // Testar troca de tamanho de página
    const select = screen.getByLabelText('Itens por página')
    fireEvent.change(select, { target: { value: '50' } })
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })
})
