/**
 * Agente intake (função pura): portão de ruído (o da triagem, quando veio) e depois
 * uma pergunta presente/ausente/não se aplica por item do checklist, pelo motor de confiança do core.
 * Política assimétrica: um item só "falta" com confiança alta de ausência;
 * na dúvida conta como presente, porque pergunta indevida irrita e causa abandono.
 */
import { askChoice, confidenceOf, wouldApply, withRigor, type ChoiceQuestion, type Combined, type Rigor, type Thresholds } from '../../core/choice'
import { chat as llmChat, type ChatFn } from '../../core/llm'
import type { Evidence } from '../../core/ticketEvidence'
import { resolveAttachmentMime } from '../../../services/uploads'
import { askGate, gateOf, GATE_QUESTION, type Gate, type GateReading } from '../../core/gate'
import { contextMessages, itemQuestion, PROMPT_VERSION } from './prompt'
import { personalizeAsks } from './personalize'

export interface ChecklistItem {
  key: string; label: string; criterion: string; question: string; kind: string; required: boolean
}

// Limiar inicial sem calibração; ajustar pelo runIntakeEval e pelo modo sombra.
export const ABSENT_THRESHOLD: Thresholds = { minConfidence: 0.85, minMargin: 0.3 }
export const MAX_ASKS = 3

export type { Gate }

/** Mesmo formato de result.questions da triagem: o Motor IA agrega sem mudança. */
export interface IntakeDecision {
  key: string
  label: string
  chosen: string
  chosenLabel: string
  probability: number
  margin: number
  roundsAgree: boolean
  confidence: number
  /** Decisão com confiança suficiente para valer. */
  wouldApply: boolean
  required?: boolean
  /** Cumprido por regra (imagem anexada), sem LLM. */
  byRule?: boolean
}

export interface IntakeResult {
  /** Portão + itens, na ordem do checklist. */
  questions: IntakeDecision[]
  gate: Gate
  /** Portão confiante em algo que não é relato/pedido de usuário: checklist não avaliado. */
  skipped: boolean
  /** Portão reaproveitado da triagem do chamado (sem nova pergunta à LLM). */
  gateFromTriage?: boolean
  /** Keys dos itens obrigatórios ausentes com confiança. */
  missing: string[]
  /** Perguntas para o solicitante (até MAX_ASKS), já no vocabulário dele quando a personalização deu certo. */
  asks: string[]
  /** Quantas perguntas saíram personalizadas pela LLM (o resto usa o texto fixo do checklist). */
  personalized?: number
  inputTokens: number
  outputTokens: number
  promptVersion: string
}

const hasImage = (e: Evidence) => e.fileNames.some(n => resolveAttachmentMime(n)?.startsWith('image/'))

function decide(key: string, label: string, q: ChoiceQuestion, c: Combined, t: Thresholds): IntakeDecision {
  const confidence = confidenceOf(c, true)
  const o = q.options[c.chosen]
  return {
    key, label, chosen: o.value, chosenLabel: o.label,
    probability: c.probability, margin: c.margin, roundsAgree: c.roundsAgree,
    confidence, wouldApply: wouldApply(confidence, c.margin, t),
  }
}

/** Configuração do Motor IA › Completude (sem ela, os padrões); `gate` = leitura da triagem do chamado. */
export interface IntakeDeps { chat?: ChatFn; rigor?: Rigor; maxAsks?: number; personalize?: boolean; gate?: GateReading | null }

export async function runIntake(e: Evidence, items: ChecklistItem[], deps: IntakeDeps = {}): Promise<IntakeResult> {
  const chatFn = deps.chat ?? llmChat
  const usage = { input: 0, output: 0 }
  const call: ChatFn = async (m, o) => {
    const r = await chatFn(m, o)
    usage.input += r.inputTokens
    usage.output += r.outputTokens
    return r
  }
  const ctx = contextMessages(e)
  // Montado por último: os tokens da personalização entram na conta.
  const result = (questions: IntakeDecision[], gate: Gate, skipped: boolean, missing: ChecklistItem[], asks: string[] = [], personalized = 0): IntakeResult => ({
    questions, gate, skipped, ...(deps.gate ? { gateFromTriage: true } : {}),
    missing: missing.map(i => i.key),
    asks, personalized,
    inputTokens: usage.input, outputTokens: usage.output, promptVersion: PROMPT_VERSION,
  })

  const g = deps.gate ?? await askGate(ctx, call, deps.rigor)
  const { value, ...reading } = g
  const chosenLabel = GATE_QUESTION.options.find(o => o.value === value)?.label ?? value
  const gate: IntakeDecision = { key: 'gate', label: 'Portão', chosen: value, chosenLabel, ...reading }
  if (gateOf(g) !== 'user') return result([gate], value, true, [])

  const image = hasImage(e)
  const decisions = await Promise.all(items.map(async (i): Promise<IntakeDecision> => {
    if (i.kind === 'evidence' && image) {
      return {
        key: i.key, label: i.label, chosen: 'present', chosenLabel: 'Imagem anexada',
        probability: 1, margin: 1, roundsAgree: true, confidence: 1, wouldApply: true,
        required: i.required, byRule: true,
      }
    }
    const q = itemQuestion(i.key, i.criterion)
    return { ...decide(i.key, i.label, q, await askChoice(ctx, q, call), withRigor(ABSENT_THRESHOLD, deps.rigor)), required: i.required }
  }))
  const missing = items.filter((i, idx) => i.required && decisions[idx].chosen === 'absent' && decisions[idx].wouldApply)
  const { asks, personalized } = missing.length
    ? deps.personalize === false
      ? { asks: missing.slice(0, deps.maxAsks ?? MAX_ASKS).map(i => i.question), personalized: 0 }
      : await personalizeAsks(e, missing.slice(0, deps.maxAsks ?? MAX_ASKS), call)
    : { asks: [], personalized: 0 }
  return result([gate, ...decisions], value, false, missing, asks, personalized)
}
