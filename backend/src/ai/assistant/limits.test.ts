import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: { AI_ASSISTANT_RATE_LIMIT: 3, AI_ASSISTANT_RATE_WINDOW_MIN: 5, AI_ASSISTANT_MAX_CONVERSATION_TOKENS: 1000, AI_ASSISTANT_DAILY_TOKEN_ALERT: 0 },
  createAuditLog: vi.fn(),
}))
vi.mock('../../config/env', () => ({ env: mocks.env }))
vi.mock('../../services/audit', () => ({ createAuditLog: mocks.createAuditLog }))

import {
  addUsage, allowMessage, auditAssistantAction, conversationTokens, dailyUsage, estimateTokens,
  resetLimits, tokenCeilingReached,
} from './limits'

const T0 = Date.parse('2026-11-03T12:00:00Z')

beforeEach(() => { resetLimits(); mocks.createAuditLog.mockReset(); mocks.env.AI_ASSISTANT_DAILY_TOKEN_ALERT = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('limites do assistente', () => {
  it('janela deslizante por usuário: recusa acima do limite e libera quando a janela anda', () => {
    expect([1, 2, 3].map(i => allowMessage('u1', T0 + i * 1000))).toEqual([true, true, true])
    expect(allowMessage('u1', T0 + 4000)).toBe(false)
    expect(allowMessage('u2', T0 + 4000)).toBe(true)
    expect(allowMessage('u1', T0 + 5 * 60_000 + 1001)).toBe(true) // a 1ª saiu da janela
    expect(allowMessage('u1', T0 + 5 * 60_000 + 1500)).toBe(false)
  })

  it('teto de tokens por conversa, que expira depois de horas parada', () => {
    addUsage('c1', 600, T0)
    expect(tokenCeilingReached('c1', T0)).toBe(false)
    addUsage('c1', 400, T0 + 1000)
    expect(conversationTokens('c1', T0 + 1000)).toBe(1000)
    expect(tokenCeilingReached('c1', T0 + 1000)).toBe(true)
    expect(tokenCeilingReached('c2', T0 + 1000)).toBe(false)
    expect(tokenCeilingReached('c1', T0 + 7 * 3600_000)).toBe(false)
  })

  it('estimativa chars/4', () => {
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('abc')).toBe(1)
  })

  it('contador diário avisa uma vez ao passar do alerta e zera na virada do dia', () => {
    mocks.env.AI_ASSISTANT_DAILY_TOKEN_ALERT = 500
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    allowMessage('u1', T0)
    addUsage('c1', 300, T0)
    expect(warn).not.toHaveBeenCalled()
    addUsage('c1', 300, T0 + 1000)
    addUsage('c1', 300, T0 + 2000)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('600 tokens (limite 500)')
    expect(dailyUsage()).toEqual({ date: '2026-11-03', tokens: 900, messages: 1 })
    addUsage('c2', 10, T0 + 86400_000)
    expect(dailyUsage()).toEqual({ date: '2026-11-04', tokens: 10, messages: 0 })
  })

  it('auditoria grava ferramenta e canal, com a entrada mascarada e cortada', async () => {
    await auditAssistantAction({
      userId: 'u1', via: 'teams', tool: 'abrir_chamado', ok: true,
      input: { titulo: 'Sem acesso', descricao: `meu e-mail é joao@empresa.com e ${'x'.repeat(500)}` },
      result: { ticket: { id: 't1', display_number: 'ISA-123' } },
    })
    const arg = mocks.createAuditLog.mock.calls[0][0]
    expect(arg).toMatchObject({ userId: 'u1', action: 'AI_ASSISTANT_ACTION', resource: 'AI_ASSISTANT' })
    expect(arg.details).toMatchObject({ tool: 'abrir_chamado', via: 'teams', ok: true, ticketId: 't1', displayNumber: 'ISA-123' })
    expect(arg.details.input.titulo).toBe('Sem acesso')
    expect(arg.details.input.descricao).toContain('[EMAIL]')
    expect(arg.details.input.descricao).not.toContain('joao@')
    expect(arg.details.input.descricao.length).toBe(120)
  })
})
