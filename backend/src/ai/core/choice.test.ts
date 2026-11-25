import { describe, it, expect, vi } from 'vitest'
import {
  letterProbs, orders, combineRounds, choiceMessage, askChoice, evidenceIsValid, confidenceOf, wouldApply,
} from './choice'
import type { ChatFn } from './llm'

const lp = (p: number) => Math.log(p)

describe('choice', () => {
  it('letterProbs soma variantes do mesmo token e renormaliza entre as letras válidas', () => {
    const p = letterProbs([
      { token: 'B', logprob: lp(0.6) }, { token: ' B', logprob: lp(0.1) },
      { token: 'A', logprob: lp(0.2) }, { token: 'Z', logprob: lp(0.1) },
    ], 3)
    expect(p[0]).toBeCloseTo(0.2 / 0.9)
    expect(p[1]).toBeCloseTo(0.7 / 0.9)
    expect(p[2]).toBe(0)
  })

  it('letterProbs sem nenhuma letra válida devolve zeros', () => {
    expect(letterProbs([{ token: 'Olá', logprob: lp(0.9) }], 2)).toEqual([0, 0])
  })

  it('orders gera a ordem normal e a invertida', () => {
    expect(orders(3)).toEqual([[0, 1, 2], [2, 1, 0]])
  })

  it('combineRounds desfaz a ordem invertida e mede concordância e margem', () => {
    const c = combineRounds([
      { order: [0, 1, 2], probs: [0.1, 0.8, 0.1] },
      { order: [2, 1, 0], probs: [0.2, 0.7, 0.1] },
    ], 3)
    expect(c.chosen).toBe(1)
    expect(c.probability).toBeCloseTo(0.75)
    expect(c.margin).toBeCloseTo(0.6)
    expect(c.roundsAgree).toBe(true)
    expect(c.noSignal).toBe(false)
  })

  it('combineRounds marca discordância quando cada rodada prefere uma posição', () => {
    const c = combineRounds([
      { order: [0, 1], probs: [0.6, 0.4] },
      { order: [1, 0], probs: [0.6, 0.4] },
    ], 2)
    expect(c.roundsAgree).toBe(false)
  })

  it('choiceMessage lista as opções em letras na ordem pedida', () => {
    const m = choiceMessage({
      key: 'type', prompt: 'Qual é o tipo?',
      options: [{ value: 'incident', label: 'Incidente', description: 'Falha' }, { value: 'request', label: 'Requisição' }],
    }, [1, 0])
    expect(m.content).toBe('Qual é o tipo?\nA) Requisição\nB) Incidente — Falha\nResponda apenas com a letra da opção.')
  })

  it('askChoice roda as duas ordens e devolve a opção original', async () => {
    // sempre responde a letra cuja linha contém "Requisição"
    const call: ChatFn = vi.fn(async messages => {
      const last = messages[messages.length - 1].content as string
      const letter = last.split('\n').find(l => l.includes('Requisição'))![0]
      return { text: letter, firstTokenTop: [{ token: letter, logprob: lp(0.9) }, { token: letter === 'A' ? 'B' : 'A', logprob: lp(0.1) }], inputTokens: 1, outputTokens: 1 }
    })
    const c = await askChoice([{ role: 'system', content: 's' }], {
      key: 'type', prompt: 'Qual é o tipo?', options: [{ value: 'incident', label: 'Incidente' }, { value: 'request', label: 'Requisição' }],
    }, call)
    expect(call).toHaveBeenCalledTimes(2)
    expect(c.chosen).toBe(1)
    expect(c.probability).toBeCloseTo(0.9)
    expect(c.roundsAgree).toBe(true)
  })

  it('askChoice com uma opção só não chama o modelo', async () => {
    const call = vi.fn() as unknown as ChatFn
    const c = await askChoice([], { key: 'x', prompt: 'p', options: [{ value: 'a', label: 'A' }] }, call)
    expect(c.probability).toBe(1)
    expect(call).not.toHaveBeenCalled()
  })

  it('evidenceIsValid exige trecho literal (sem diferenciar caixa e espaços)', () => {
    const src = 'Título: Acesso ao Firewall\nDescrição: Criar  usuários nominais no firewall'
    expect(evidenceIsValid('criar usuários nominais', src)).toBe(true)
    expect(evidenceIsValid('remover usuários', src)).toBe(false)
    expect(evidenceIsValid('ab', src)).toBe(false)
    expect(evidenceIsValid(undefined, src)).toBe(false)
  })

  it('confidenceOf zera sem sinal, sem concordância ou sem evidência', () => {
    const ok = { probability: 0.9, roundsAgree: true, noSignal: false }
    expect(confidenceOf(ok, true)).toBe(0.9)
    expect(confidenceOf(ok, false)).toBe(0)
    expect(confidenceOf({ ...ok, roundsAgree: false }, true)).toBe(0)
    expect(confidenceOf({ ...ok, noSignal: true }, true)).toBe(0)
  })

  it('wouldApply exige confiança e margem mínimas', () => {
    expect(wouldApply(0.92, 0.5, { minConfidence: 0.9, minMargin: 0.3 })).toBe(true)
    expect(wouldApply(0.92, 0.2, { minConfidence: 0.9, minMargin: 0.3 })).toBe(false)
    expect(wouldApply(0.85, 0.5, { minConfidence: 0.9, minMargin: 0.3 })).toBe(false)
  })
})

describe('withRigor', () => {
  const t = { minConfidence: 0.85, minMargin: 0.3 }
  it('equilibrado mantém; conservador sobe 0,05 (teto 0,99); ousado desce 0,10 (piso 0,5); margem não muda', async () => {
    const { withRigor } = await import('./choice')
    expect(withRigor(t)).toEqual(t)
    expect(withRigor(t, 'conservative')).toEqual({ minConfidence: 0.9, minMargin: 0.3 })
    expect(withRigor(t, 'bold')).toEqual({ minConfidence: 0.75, minMargin: 0.3 })
    expect(withRigor({ minConfidence: 0.97, minMargin: 0 }, 'conservative').minConfidence).toBe(0.99)
    expect(withRigor({ minConfidence: 0.55, minMargin: 0 }, 'bold').minConfidence).toBe(0.5)
  })
})
