import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Modal } from './Modal'

function Host({ autoFocus = false }: { autoFocus?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Janela" footer={<button>Último</button>}>
        <input aria-label="Campo" autoFocus={autoFocus} />
      </Modal>
    </>
  )
}

const open = () => {
  const trigger = screen.getByRole('button', { name: 'Abrir' })
  trigger.focus()
  fireEvent.click(trigger)
  return { trigger, dialog: screen.getByRole('dialog', { name: 'Janela' }) }
}

describe('Modal: foco', () => {
  it('o foco entra no diálogo ao abrir', () => {
    render(<Host />)
    expect(open().dialog).toHaveFocus()
  })

  it('respeita o autoFocus de um campo do conteúdo', () => {
    render(<Host autoFocus />)
    open()
    expect(screen.getByLabelText('Campo')).toHaveFocus()
  })

  it('Tab no último controle volta ao primeiro, e Shift+Tab no primeiro vai ao último', () => {
    render(<Host />)
    const { dialog } = open()
    const first = screen.getByRole('button', { name: 'Fechar' })
    const last = screen.getByRole('button', { name: 'Último' })

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('Tab no meio do diálogo segue o caminho normal do navegador', () => {
    render(<Host />)
    open()
    const middle = screen.getByLabelText('Campo')
    middle.focus()
    expect(fireEvent.keyDown(middle, { key: 'Tab' })).toBe(true)
  })

  it('devolve o foco a quem abriu ao fechar, mesmo com autoFocus no conteúdo', async () => {
    render(<Host autoFocus />)
    const { trigger, dialog } = open()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
