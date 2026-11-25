/**
 * Duplicidade: o chamado novo repete um chamado ainda aberto do MESMO solicitante?
 * Pré-filtro por cosseno dos embeddings (barato) e confirmação pelo motor de
 * confiança (2 rodadas, logprobs). Na dúvida, não é duplicado: falso positivo
 * esconde um problema novo do cliente.
 */
import { askChoice, confidenceOf, wouldApply, withRigor, type Rigor, type Thresholds } from '../../core/choice'
import { chat as llmChat, type ChatFn } from '../../core/llm'
import { embed as defaultEmbed, type EmbedFn } from '../../core/embeddings'
import { cosine } from '../../core/examples'
import { maskPII, sanitizeForModel } from '../../core/masking'
import { duplicateContext, SAME_QUESTION } from './prompt'

export interface OpenTicket { id: string; display_number: string; title: string; description: string | null }

export interface DuplicateResult {
  ticket: { id: string; display_number: string; title: string }
  cosine: number
  probability: number
  margin: number
  roundsAgree: boolean
  confidence: number
  isDuplicate: boolean
}

// Pré-filtro e limiar sem calibração; ajustar pelo runGuidanceEval e pelo modo sombra.
export const MIN_COSINE = 0.5
export const SAME_THRESHOLD: Thresholds = { minConfidence: 0.85, minMargin: 0.3 }

export const ticketText = (t: { title: string; description: string | null }) =>
  `Título: ${maskPII(t.title.slice(0, 300))}\nDescrição: ${sanitizeForModel(t.description).slice(0, 1500)}`

/** Melhor candidato acima do pré-filtro, confirmado pela LLM; null = nenhum candidato passou do cosseno. */
export async function checkDuplicate(
  current: { title: string; description: string | null }, open: OpenTicket[],
  deps: { chat?: ChatFn; embed?: EmbedFn; rigor?: Rigor } = {},
): Promise<{ result: DuplicateResult | null; inputTokens: number; outputTokens: number }> {
  if (!open.length) return { result: null, inputTokens: 0, outputTokens: 0 }
  const texts = [current, ...open].map(ticketText)
  const [mine, ...theirs] = await (deps.embed ?? defaultEmbed)(texts)
  const ranked = theirs.map((v, i) => ({ i, score: cosine(mine, v) })).sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best || best.score < MIN_COSINE) return { result: null, inputTokens: 0, outputTokens: 0 }

  const usage = { input: 0, output: 0 }
  const call: ChatFn = async (m, o) => {
    const r = await (deps.chat ?? llmChat)(m, o)
    usage.input += r.inputTokens
    usage.output += r.outputTokens
    return r
  }
  const c = await askChoice(duplicateContext(texts[0], texts[best.i + 1]), SAME_QUESTION, call)
  const confidence = confidenceOf(c, true)
  const t = open[best.i]
  return {
    result: {
      ticket: { id: t.id, display_number: t.display_number, title: t.title },
      cosine: best.score, probability: c.probability, margin: c.margin, roundsAgree: c.roundsAgree, confidence,
      isDuplicate: SAME_QUESTION.options[c.chosen].value === 'same' && wouldApply(confidence, c.margin, withRigor(SAME_THRESHOLD, deps.rigor)),
    },
    inputTokens: usage.input, outputTokens: usage.output,
  }
}
