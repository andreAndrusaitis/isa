/**
 * Controles de custo, abuso e auditoria do assistente.
 * - Limite de mensagens por usuário (janela deslizante).
 * - Teto de tokens por conversa (uso real do Foundry; sem ele, estimativa chars/4).
 * - Contador diário de consumo com alerta opcional (só console.warn, sem alerta externo).
 * - Auditoria de toda escrita executada, sem guardar a mensagem do usuário.
 * Tudo em memória do processo — com várias instâncias cada uma conta
 * o seu (teto real = N × limite) e reiniciar zera. Store compartilhado (Redis/
 * Postgres) fica para quando houver escala horizontal.
 */
import { aiProvider } from '../core/provider'
import { createAuditLog } from '../../services/audit'
import { maskPII } from '../core/masking'
import type { AssistantChannel } from './types'

export const RATE_LIMIT_TEXT =
  'Você enviou muitas mensagens em pouco tempo. Aguarde alguns minutos e tente de novo.'
export const TOKEN_LIMIT_TEXT =
  'Esta conversa ficou longa demais para eu continuar. Comece uma nova conversa, por favor.'

const CONVERSATION_TTL_MS = 6 * 3600_000

const hits = new Map<string, number[]>()
const conversations = new Map<string, { tokens: number; touched: number }>()
let daily = { date: '', tokens: 0, messages: 0, alerted: false }

/** Registra a mensagem e diz se cabe na janela do usuário (a recusada não conta). */
export function allowMessage(userId: string, now = Date.now()): boolean {
  const windowMs = aiProvider().assistantRateWindowMin * 60_000
  const recent = (hits.get(userId) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= aiProvider().assistantRateLimit) {
    hits.set(userId, recent)
    return false
  }
  recent.push(now)
  hits.set(userId, recent)
  countDaily(0, 1, now)
  return true
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

export function conversationTokens(key: string, now = Date.now()): number {
  const c = conversations.get(key)
  if (!c || now - c.touched > CONVERSATION_TTL_MS) return 0
  return c.tokens
}

export function tokenCeilingReached(key: string, now = Date.now()): boolean {
  return conversationTokens(key, now) >= aiProvider().assistantMaxConversationTokens
}

/** Soma o consumo de uma chamada ao modelo na conversa e no dia. */
export function addUsage(key: string, tokens: number, now = Date.now()): void {
  conversations.set(key, { tokens: conversationTokens(key, now) + tokens, touched: now })
  for (const [k, c] of conversations) if (now - c.touched > CONVERSATION_TTL_MS) conversations.delete(k)
  countDaily(tokens, 0, now)
}

function countDaily(tokens: number, messages: number, now: number): void {
  const date = new Date(now).toISOString().slice(0, 10)
  if (daily.date !== date) {
    daily = { date, tokens: 0, messages: 0, alerted: false }
    hits.forEach((list, user) => { if (!list.some(t => now - t < aiProvider().assistantRateWindowMin * 60_000)) hits.delete(user) })
  }
  daily.tokens += tokens
  daily.messages += messages
  const alert = aiProvider().assistantDailyTokenAlert
  if (alert > 0 && !daily.alerted && daily.tokens >= alert) {
    daily.alerted = true
    console.warn(`[AI:assistant] consumo diário passou do alerta: ${daily.tokens} tokens (limite ${alert}), ${daily.messages} mensagens em ${date}`)
  }
}

export function dailyUsage(): { date: string; tokens: number; messages: number } {
  return { date: daily.date, tokens: daily.tokens, messages: daily.messages }
}

/** Só para testes. */
export function resetLimits(): void {
  hits.clear()
  conversations.clear()
  daily = { date: '', tokens: 0, messages: 0, alerted: false }
}

/** Entrada da ferramenta para auditoria: textos mascarados e cortados, nunca a mensagem inteira. */
function auditInput(input: unknown): unknown {
  if (typeof input === 'string') return maskPII(input).slice(0, 120)
  if (Array.isArray(input)) return input.slice(0, 10).map(auditInput)
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).slice(0, 20).map(([k, v]) => [k, auditInput(v)]))
  }
  return input
}

/** Referência do que foi criado/alterado, quando o resultado traz (id/número do chamado). */
function auditRef(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const r = result as Record<string, any>
  const ticket = r.ticket && typeof r.ticket === 'object' ? r.ticket : r
  const out: Record<string, unknown> = {}
  const id = ticket.ticketId ?? ticket.ticket_id ?? ticket.id
  const number = ticket.display_number ?? ticket.displayNumber
  if (typeof id === 'string') out.ticketId = id
  if (typeof number === 'string') out.displayNumber = number
  return out
}

export function auditAssistantAction(a: {
  userId: string; via: AssistantChannel; tool: string; input: unknown
  ok: boolean; result?: unknown; error?: string
}) {
  return createAuditLog({
    userId: a.userId,
    action: 'AI_ASSISTANT_ACTION',
    resource: 'AI_ASSISTANT',
    details: {
      tool: a.tool, via: a.via, ok: a.ok, input: auditInput(a.input),
      ...auditRef(a.result),
      ...(a.error ? { error: a.error.slice(0, 300) } : {}),
    },
  })
}
