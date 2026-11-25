import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Inp, Txta } from './Form'

describe('Form UI Components — Limitação de Caracteres', () => {
  describe('Inp Component', () => {
    it('renderiza com atributo maxLength', () => {
      render(<Inp placeholder="Título" maxLength={120} />)
      const input = screen.getByPlaceholderText('Título') as HTMLInputElement
      expect(input.maxLength).toBe(120)
    })

    it('exibe contador de caracteres restantes quando showCount está ativo', () => {
      render(<Inp placeholder="Título" maxLength={120} showCount value="Teste" onChange={() => {}} />)
      expect(screen.getByText('115 caracteres restantes')).toBeDefined()
    })

    it('exibe formato singular quando resta 1 caractere', () => {
      render(<Inp placeholder="Título" maxLength={5} showCount value="ABCD" onChange={() => {}} />)
      expect(screen.getByText('1 caractere restante')).toBeDefined()
    })

    it('atualiza o contador ao digitar em componente não-controlado', () => {
      render(<Inp placeholder="Título não-controlado" maxLength={10} showCount />)
      const input = screen.getByPlaceholderText('Título não-controlado')
      expect(screen.getByText('10 caracteres restantes')).toBeDefined()

      fireEvent.change(input, { target: { value: '1234' } })
      expect(screen.getByText('6 caracteres restantes')).toBeDefined()
    })
  })

  describe('Txta Component', () => {
    it('renderiza com atributo maxLength', () => {
      render(<Txta placeholder="Descrição" maxLength={5000} />)
      const textarea = screen.getByPlaceholderText('Descrição') as HTMLTextAreaElement
      expect(textarea.maxLength).toBe(5000)
    })

    it('exibe automaticamente contador de caracteres restantes quando maxLength é definido', () => {
      render(<Txta placeholder="Descrição" maxLength={500} value="Olá mundo" onChange={() => {}} />)
      expect(screen.getByText('491 caracteres restantes')).toBeDefined()
    })

    it('permite desativar contador passando showCount={false}', () => {
      render(<Txta placeholder="Sem contador" maxLength={500} showCount={false} value="Olá" onChange={() => {}} />)
      expect(screen.queryByText(/caracteres restantes/)).toBeNull()
    })

    it('exibe formato singular quando resta 1 caractere no textarea', () => {
      render(<Txta placeholder="Descrição" maxLength={4} value="ABC" onChange={() => {}} />)
      expect(screen.getByText('1 caractere restante')).toBeDefined()
    })
  })
})
