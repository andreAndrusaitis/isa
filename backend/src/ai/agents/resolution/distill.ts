/**
 * Base de resoluções: transforma um chamado resolvido num "cartão" genérico e limpo
 * (problema, passos, autoatendimento ou equipe), gravado em ai_examples com
 * agent='resolution'. É a base que o agente guidance consulta. Nome, número de
 * chamado, senha e dado do cliente saem aqui, uma vez: um cartão que ainda os traga
 * é descartado (regex final), então a resposta ao cliente nunca cita outro chamado.
 */
import prisma from '../../../config/prisma'
import { aiProvider } from '../../core/provider'
import { aiConfigured, chat as llmChat, type ChatFn } from '../../core/llm'
import { maskPII, sanitizeForModel } from '../../core/masking'
import { upsertExamples, type ExampleInput } from '../../core/examples'
import { signedByAi } from '../../core/persona'
import { recordRun } from '../../core/runs'
import { agentRuntime, type GuidanceConfig } from '../registry'
import { distillMessages, PROMPT_VERSION } from './prompt'

export const AGENT = 'resolution'

export interface Card {
  problem: string
  selfService: boolean
  steps: string[]
  teamAction: string
  product: 'microsoft' | 'outro'
}

export interface CardLabels extends Omit<Card, 'problem'> {
  /** ISA-xxxx ou id do histórico: só para a nota interna, nunca entra em prompt. */
  sourceDisplay: string
}

export interface DistillInput { title: string; description: string; resolution: string }

/** Rastros que não podem sobrar num cartão: número de chamado, marcadores do masking. */
export const LEAK = /\b\d{3}-\d{2,}\b|\bISA-\d+|\[(SENHA|EMAIL|CPF|CNPJ|RG|TELEFONE|CEP)\]|chamado\s+(n[ºo°.]?\s*)?\d+|ticket\s+\d+/i
const MAX_STEPS = 6

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Valida o JSON da LLM; null = inutilizável ou com vazamento. */
export function parseCard(raw: string): Card | null {
  let j: any
  try { j = JSON.parse(raw) } catch { return null }
  if (!j || j.usable !== true) return null
  const problem = str(j.problem, 300)
  const steps = (Array.isArray(j.steps) ? j.steps : []).map((s: unknown) => str(s, 300)).filter(Boolean).slice(0, MAX_STEPS)
  const teamAction = str(j.teamAction, 300)
  const selfService = j.selfService === true && steps.length > 0
  if (problem.length < 10 || (!selfService && !teamAction)) return null
  const card: Card = { problem, selfService, steps: selfService ? steps : [], teamAction, product: j.product === 'microsoft' ? 'microsoft' : 'outro' }
  return LEAK.test([card.problem, ...card.steps, card.teamAction].join('\n')) ? null : card
}

export async function distill(input: DistillInput, deps: { chat?: ChatFn } = {}) {
  const r = await (deps.chat ?? llmChat)(distillMessages({
    title: maskPII(input.title),
    description: sanitizeForModel(input.description).slice(0, 3000),
    resolution: sanitizeForModel(input.resolution).slice(0, 3000),
  }), { maxTokens: 600, json: true })
  return { card: parseCard(r.text), inputTokens: r.inputTokens, outputTokens: r.outputTokens }
}

export function toExample(sourceId: string, sourceDisplay: string, card: Card): ExampleInput {
  const { problem, ...rest } = card
  const labels: CardLabels = { ...rest, sourceDisplay }
  return { sourceId, text: problem, labels: labels as unknown as Record<string, unknown> }
}

/**
 * Chamado fechado → cartão (em segundo plano, nunca lança). Resolução = resolution_details
 * + respostas públicas da equipe. Pula o que a própria IA resolveu (deflexão/vínculo).
 */
export async function distillTicket(ticketId: string, deps: { chat?: ChatFn } = {}): Promise<void> {
  if (!aiConfigured()) return
  // A base só cresce enquanto o guidance (quem a consome) está ligado e "alimentar a base" está ativo no Motor IA.
  const { mode, config } = await agentRuntime<GuidanceConfig>('guidance').catch(() => ({ mode: 'off' as const, config: null }))
  if (mode === 'off' || !config?.learnFromClosed) return
  try {
    const t = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true, title: true, description: true, display_number: true, user_id: true,
        resolution_details: true, guidance_status: true, deleted_at: true,
        messages: { where: { type: { in: ['agent', 'email'] } }, select: { user_id: true, text: true }, orderBy: { created_at: 'asc' } },
      },
    })
    if (!t || t.deleted_at || t.guidance_status === 'deflected' || t.guidance_status === 'linked') return
    // Mensagens da equipe (sem o solicitante nem a Skadi) + a resolução registrada.
    const team = t.messages.filter(m => m.user_id !== t.user_id && !signedByAi(m.text)).map(m => m.text)
    const resolution = [...team, t.resolution_details ?? ''].join('\n\n').trim()
    if (resolution.length < 20) return
    const info = { agent: AGENT, ticketId, mode: 'apply', model: aiProvider().chatModel, promptVersion: PROMPT_VERSION }
    const { result } = await recordRun(info, async () => {
      const r = await distill({ title: t.title, description: t.description ?? '', resolution }, deps)
      return { result: { card: r.card }, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
    })
    if (result?.card) await upsertExamples(AGENT, 'ticket', [toExample(t.id, t.display_number, result.card)])
  } catch (err: any) {
    console.error(`[AI:${AGENT}] chamado ${ticketId}:`, err?.message ?? err)
  }
}
