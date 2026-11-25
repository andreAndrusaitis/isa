/**
 * Motor de confiança compartilhado: pergunta de múltipla escolha respondida com
 * 1 token (a letra) e lida pelos logprobs. Cada pergunta roda em duas rodadas
 * (ordem normal e invertida, contra viés de posição); o resultado traz a
 * probabilidade por opção, a margem e se as rodadas concordaram.
 * O agente monta o contexto (sistema + evidência); aqui só entra a pergunta.
 */
import type { ChatFn, ChatMessage, TopLogprob } from './llm'

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export interface Option { value: string; label: string; description?: string | null }
export interface ChoiceQuestion { key: string; prompt: string; options: Option[] }
export interface Round { order: number[]; probs: number[] }
export interface Combined {
  probs: number[]
  chosen: number
  probability: number
  margin: number
  roundsAgree: boolean
  noSignal: boolean
}
export interface Thresholds { minConfidence: number; minMargin: number }

/** Probabilidade de cada letra válida no 1º token, renormalizada entre as válidas. */
export function letterProbs(top: TopLogprob[], optionCount: number): number[] {
  const probs = new Array<number>(optionCount).fill(0)
  for (const t of top) {
    const idx = LETTERS.indexOf(t.token.replace(/[\s"'.()]/g, '').toUpperCase())
    if (idx >= 0 && idx < optionCount) probs[idx] += Math.exp(t.logprob)
  }
  const sum = probs.reduce((a, b) => a + b, 0)
  return sum > 0 ? probs.map(p => p / sum) : probs
}

/** Ordem normal e invertida: order[letra] = índice da opção original. */
export function orders(optionCount: number): number[][] {
  const identity = Array.from({ length: optionCount }, (_, i) => i)
  return [identity, [...identity].reverse()]
}

const argmax = (p: number[]) => p.reduce((best, v, i) => (v > p[best] ? i : best), 0)

export function combineRounds(rounds: Round[], optionCount: number): Combined {
  const perRound = rounds.map(r => {
    const p = new Array<number>(optionCount).fill(0)
    r.order.forEach((orig, letter) => { p[orig] = r.probs[letter] })
    return p
  })
  const probs = Array.from({ length: optionCount }, (_, i) =>
    perRound.reduce((s, p) => s + p[i], 0) / perRound.length)
  const chosen = argmax(probs)
  const ranked = [...probs].sort((a, b) => b - a)
  return {
    probs,
    chosen,
    probability: probs[chosen],
    margin: ranked[0] - (ranked[1] ?? 0),
    roundsAgree: perRound.every(p => argmax(p) === chosen),
    noSignal: perRound.some(p => p.every(v => v === 0)),
  }
}

export function choiceMessage(q: ChoiceQuestion, order: number[]): ChatMessage {
  const options = order.map((orig, letter) => {
    const o = q.options[orig]
    return `${LETTERS[letter]}) ${o.label}${o.description ? ` — ${o.description}` : ''}`
  })
  return { role: 'user', content: `${q.prompt}\n${options.join('\n')}\nResponda apenas com a letra da opção.` }
}

/** Faz a pergunta (2 rodadas em paralelo) sobre o contexto dado pelo agente. */
export async function askChoice(context: ChatMessage[], q: ChoiceQuestion, call: ChatFn): Promise<Combined> {
  if (q.options.length === 0) throw new Error(`Pergunta ${q.key} sem opções ativas`)
  if (q.options.length > LETTERS.length) throw new Error(`Pergunta ${q.key} tem ${q.options.length} opções (máx. ${LETTERS.length})`)
  if (q.options.length === 1) return combineRounds([{ order: [0], probs: [1] }], 1)
  const rounds = await Promise.all(orders(q.options.length).map(async order => {
    const r = await call([...context, choiceMessage(q, order)], { maxTokens: 1, logprobs: true })
    return { order, probs: letterProbs(r.firstTokenTop, q.options.length) }
  }))
  return combineRounds(rounds, q.options.length)
}

/** O trecho citado pelo modelo existe no texto enviado? */
export function evidenceIsValid(quote: string | undefined, source: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return !!quote && norm(quote).length >= 3 && norm(source).includes(norm(quote))
}

// Calibração identidade até haver curva de calibração do conjunto rotulado.
export function confidenceOf(c: Pick<Combined, 'probability' | 'roundsAgree' | 'noSignal'>, evidenceValid: boolean): number {
  if (c.noSignal || !c.roundsAgree || !evidenceValid) return 0
  return c.probability
}

export function wouldApply(confidence: number, margin: number, t: Thresholds): boolean {
  return confidence >= t.minConfidence && margin >= t.minMargin
}

export const RIGORS = ['conservative', 'balanced', 'bold'] as const
export type Rigor = typeof RIGORS[number]

/**
 * Rigor escolhido no Motor IA: desloca só a confiança mínima (a margem não muda).
 * Equilibrado = limiar calibrado pelos evals; Conservador = +0,05 (teto 0,99), age menos;
 * Ousado = −0,10 (piso 0,5), age mais.
 */
export function withRigor(t: Thresholds, rigor: Rigor = 'balanced'): Thresholds {
  if (rigor === 'conservative') return { ...t, minConfidence: Math.min(0.99, Math.round((t.minConfidence + 0.05) * 1000) / 1000) }
  if (rigor === 'bold') return { ...t, minConfidence: Math.max(0.5, Math.round((t.minConfidence - 0.1) * 1000) / 1000) }
  return t
}
