import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiNote, isAiNote, isSkadiMessage, withoutSkadiSignature } from './AiNote'
import type { TicketMessage } from '@/types'

const SYS = '00000000-0000-0000-0000-000000000000'
const msg = (text: string, over: Partial<TicketMessage> = {}): TicketMessage =>
  ({ id: 'm1', ticketId: 't1', userId: SYS, type: 'internal', text, createdAt: '2026-10-07T12:00:00Z', ...over })

describe('isAiNote', () => {
  it('reconhece formato novo e antigo (com 🤖)', () => {
    expect(isAiNote(msg('**Triagem IA** — Aplicou: Alta'))).toBe(true)
    expect(isAiNote(msg('🤖 **Completude IA** — faltam: A'))).toBe(true)
    expect(isAiNote(msg('**Orientação IA** — nada a sugerir'))).toBe(true)
  })
  it('nota humana, outro usuário ou outro tipo não', () => {
    expect(isAiNote(msg('Liguei para o cliente'))).toBe(false)
    expect(isAiNote(msg('**Triagem IA** — x', { userId: 'u1' }))).toBe(false)
    expect(isAiNote(msg('**Triagem IA** — x', { type: 'agent' }))).toBe(false)
  })
})

describe('isSkadiMessage', () => {
  const pub = (text: string, over: Partial<TicketMessage> = {}) => msg(text, { type: 'agent', ...over })
  it('reconhece a assinatura atual e a antiga no fim da mensagem do sistema', () => {
    expect(isSkadiMessage(pub('Bom dia!\n— Skadi'))).toBe(true)
    expect(isSkadiMessage(pub('Bom dia!\n— Assistente ISA\n'))).toBe(true)
  })
  it('sem assinatura, assinatura no meio, nota interna ou outro autor não', () => {
    expect(isSkadiMessage(pub('Chamado reaberto automaticamente.'))).toBe(false)
    expect(isSkadiMessage(pub('O texto cita — Skadi no meio.'))).toBe(false)
    expect(isSkadiMessage(msg('Bom dia!\n— Skadi'))).toBe(false)
    expect(isSkadiMessage(pub('Bom dia!\n— Skadi', { userId: 'u1' }))).toBe(false)
  })
})

describe('withoutSkadiSignature', () => {
  it('tira só a assinatura do fim', () => {
    expect(withoutSkadiSignature('Passos:\n1. Reinicie\n\n— Skadi')).toBe('Passos:\n1. Reinicie')
    expect(withoutSkadiSignature('Bom dia!\n— Assistente ISA')).toBe('Bom dia!')
    expect(withoutSkadiSignature('Sem assinatura')).toBe('Sem assinatura')
  })
})

describe('AiNote', () => {
  it('mostra o resumo e esconde os detalhes até o botão', () => {
    render(<AiNote msg={msg('**Triagem IA** — Aplicou: Alta\n**Aplicado:** Prioridade: Média → Alta')} />)
    expect(screen.getByText('Triagem IA')).toBeTruthy()
    expect(screen.getByText('Aplicou: Alta')).toBeTruthy()
    expect(screen.queryByText(/Média → Alta/)).toBeNull()
    const btn = screen.getByRole('button', { name: /Detalhes/ })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/Média → Alta/)).toBeTruthy()
  })
  it('sem detalhes não há botão', () => {
    render(<AiNote msg={msg('🤖 **Orientação IA** — nada a sugerir')} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('mostra as ações (children) sob o resumo, sem abrir os detalhes', () => {
    render(<AiNote msg={msg('**Triagem IA** — Sugere: Categoria Rede\n**Sugerido:** x')}><button type="button">Aplicar</button></AiNote>)
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeTruthy()
    expect(screen.queryByText(/Sugerido/)).toBeNull()
  })
})
