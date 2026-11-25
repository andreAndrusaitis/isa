/**
 * Portão do chamado: relato/pedido de pessoa, comunicado automático, teste ou resposta.
 * Lido uma vez, pela triagem (1º agente), e gravado no resultado dela; completude e
 * orientação reusam essa leitura (triageGate) e só perguntam de novo sem triagem.
 */
import prisma from '../../config/prisma'
import { askChoice, confidenceOf, wouldApply, withRigor, type ChoiceQuestion, type Rigor, type Thresholds } from './choice'
import type { ChatFn, ChatMessage } from './llm'

export type Gate = 'user' | 'automatic' | 'test' | 'reply'

// Limiar inicial sem calibração; ajustar pelo runIntakeEval e pelo modo sombra.
export const GATE_THRESHOLD: Thresholds = { minConfidence: 0.8, minMargin: 0.3 }

export const GATE_QUESTION: ChoiceQuestion = {
  key: 'gate',
  prompt: 'O que é este chamado?',
  options: [
    { value: 'user', label: 'Relato de problema ou pedido escrito por uma pessoa para o suporte', description: 'inclui e-mail encaminhado em que alguém pede atendimento' },
    { value: 'automatic', label: 'Comunicado automático, relatório recorrente, alerta ou notificação de sistema ou fornecedor', description: 'enviado por sistema, sem pedido de uma pessoa' },
    { value: 'test', label: 'Teste do sistema, sem pedido real' },
    { value: 'reply', label: 'Resposta ou continuação de uma conversa de atendimento que já existe', description: 'só agradecimento, confirmação ou continuação de um chamado já aberto, sem pedido novo' },
  ],
}

export const GATE_LABEL: Record<Gate, string> = {
  user: 'relato de usuário',
  automatic: 'comunicado automático ou relatório',
  test: 'teste',
  reply: 'resposta a uma conversa existente',
}

export interface GateReading {
  value: Gate
  probability: number
  margin: number
  roundsAgree: boolean
  confidence: number
  wouldApply: boolean
}

export async function askGate(ctx: ChatMessage[], call: ChatFn, rigor?: Rigor): Promise<GateReading> {
  const c = await askChoice(ctx, GATE_QUESTION, call)
  const confidence = confidenceOf(c, true)
  return {
    value: GATE_QUESTION.options[c.chosen].value as Gate,
    probability: c.probability, margin: c.margin, roundsAgree: c.roundsAgree,
    confidence, wouldApply: wouldApply(confidence, c.margin, withRigor(GATE_THRESHOLD, rigor)),
  }
}

/** Leitura que vale: na dúvida (portão sem confiança), relato de usuário. */
export const gateOf = (g: GateReading | null | undefined): Gate => (g?.wouldApply ? g.value : 'user')

/** Portão gravado pela última triagem ok do chamado; null sem triagem (ou triagem anterior ao portão). */
export async function triageGate(ticketId: string): Promise<GateReading | null> {
  const run = await prisma.aiAgentRun.findFirst({
    where: { agent: 'triage', ticket_id: ticketId, status: 'ok' }, orderBy: { created_at: 'desc' }, select: { result: true },
  })
  const g = (run?.result as { gate?: GateReading } | null)?.gate
  return g?.value ? g : null
}
