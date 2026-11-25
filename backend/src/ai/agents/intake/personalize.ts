/**
 * Perguntas do intake no vocabulário do solicitante: a LLM reescreve só o texto de cada
 * pergunta, citando o que ele escreveu ("a HP do 2º andar" em vez de "o equipamento").
 * Pergunta inválida, ausente ou falha da LLM = texto fixo do item no checklist.
 */
import type { ChatFn } from '../../core/llm'
import type { Evidence } from '../../core/ticketEvidence'
import { personalizeMessages, type AskItem } from './prompt'

const MAX_LEN = 180

/**
 * Uma linha, até MAX_LEN, terminando em "?", sem link, e-mail, pedido de credencial ou pagamento,
 * nem marcador do mascaramento ([EMAIL], [CPF]...) — o modelo só viu o texto mascarado.
 */
export function validAsk(q: unknown): q is string {
  if (typeof q !== 'string') return false
  const t = q.trim()
  return t.length >= 10 && t.length <= MAX_LEN && t.endsWith('?') && !/[\r\n]/.test(t)
    && !/https?:|www\.|@|senha|password|credencia|token|\bpix\b|cart[aã]o/i.test(t)
    && !/\[[A-ZÀ-Ú_ ]{2,}\]/.test(t)
}

export async function personalizeAsks(e: Evidence, items: AskItem[], call: ChatFn): Promise<{ asks: string[]; personalized: number }> {
  let byKey: Record<string, unknown> = {}
  try {
    const r = await call(personalizeMessages(e, items), { maxTokens: 400, json: true })
    const j = JSON.parse(r.text)
    if (j?.perguntas && typeof j.perguntas === 'object') byKey = j.perguntas
  } catch (err: any) {
    console.warn('[AI:intake] personalização das perguntas falhou, usando o texto fixo:', err?.message ?? err)
  }
  const asks = items.map(i => (validAsk(byKey[i.key]) ? (byKey[i.key] as string).trim() : i.question))
  return { asks, personalized: asks.filter((a, idx) => a !== items[idx].question).length }
}
