/**
 * Estado da conversa do bot do Teams (tabela teams_conversations).
 *
 * Guarda a ConversationReference do Bot Framework (para mensagens proativas,
 * ex. "o analista respondeu"), as últimas N mensagens que viram contexto do
 * modelo, a escrita pendente aguardando "Confirmar" e os tokens gastos.
 */
import { Prisma, type TeamsConversation } from '@prisma/client'
import prisma from '../../config/prisma'
import type { AssistantMessage, PendingAction } from '../../ai/assistant/types'

export const DEFAULT_HISTORY_LIMIT = 20

/** Subconjunto da ConversationReference do Bot Framework (o resto é guardado como veio). */
export interface TeamsConversationReference {
  conversation: { id: string; tenantId?: string; conversationType?: string; [k: string]: unknown }
  serviceUrl: string
  channelId?: string
  user?: { id: string; name?: string; aadObjectId?: string; [k: string]: unknown }
  bot?: { id: string; name?: string; [k: string]: unknown }
  activityId?: string
  locale?: string
  [k: string]: unknown
}

export interface HistoryMessage extends AssistantMessage {
  /** ISO 8601. */
  at: string
}

export interface ConversationInput {
  conversationId: string
  tenantId: string
  aadObjectId: string
  serviceUrl: string
  reference: TeamsConversationReference
  /** Usuário do ISA já resolvido pelo AAD (pode não existir ainda). */
  userId?: string | null
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue

export function readHistory(conversation: Pick<TeamsConversation, 'history'>): HistoryMessage[] {
  return Array.isArray(conversation.history) ? (conversation.history as unknown as HistoryMessage[]) : []
}

export function readPending(conversation: Pick<TeamsConversation, 'pending_action'>): PendingAction | null {
  const p = conversation.pending_action as unknown as PendingAction | null
  return p && typeof p === 'object' && typeof p.tool === 'string' ? p : null
}

/** Cria ou atualiza pela conversation_id; a referência e o service_url mudam com o tempo e são sempre os da última atividade. */
export async function getOrCreate(input: ConversationInput): Promise<TeamsConversation> {
  const common = {
    tenant_id: input.tenantId,
    aad_object_id: input.aadObjectId,
    service_url: input.serviceUrl,
    conversation_reference: asJson(input.reference),
  }
  return prisma.teamsConversation.upsert({
    where: { conversation_id: input.conversationId },
    create: { ...common, conversation_id: input.conversationId, user_id: input.userId ?? null },
    // userId ausente não desvincula: só troca quando veio resolvido.
    update: { ...common, ...(input.userId ? { user_id: input.userId } : {}) },
  })
}

export async function findByConversationId(conversationId: string): Promise<TeamsConversation | null> {
  return prisma.teamsConversation.findUnique({ where: { conversation_id: conversationId } })
}

/**
 * Acrescenta mensagens e mantém só as últimas `limit`. Feito num único UPDATE
 * para duas mensagens simultâneas da mesma conversa não se sobrescreverem.
 */
export async function appendMessages(
  conversationId: string,
  messages: Array<AssistantMessage & { at?: string | Date }>,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<HistoryMessage[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit deve ser inteiro positivo')
  const now = new Date()
  const entries: HistoryMessage[] = messages.map(m => ({
    role: m.role,
    content: m.content,
    at: (m.at ? new Date(m.at) : now).toISOString(),
  }))
  const rows = await prisma.$queryRaw<Array<{ history: HistoryMessage[] }>>(Prisma.sql`
    UPDATE "teams_conversations" SET
      "history" = COALESCE((
        SELECT jsonb_agg(e ORDER BY ord)
        FROM (
          SELECT e, ord FROM jsonb_array_elements("history" || ${JSON.stringify(entries)}::jsonb) WITH ORDINALITY AS t(e, ord)
          ORDER BY ord DESC LIMIT ${limit}
        ) last_n
      ), '[]'::jsonb),
      "last_message_at" = ${now},
      "updated_at" = ${now}
    WHERE "conversation_id" = ${conversationId}
    RETURNING "history"
  `)
  if (!rows.length) throw new Error(`Conversa do Teams não encontrada: ${conversationId}`)
  return rows[0].history
}

export async function setPending(conversationId: string, pending: PendingAction): Promise<void> {
  await prisma.teamsConversation.update({
    where: { conversation_id: conversationId },
    data: { pending_action: asJson(pending) },
  })
}

export async function clearPending(conversationId: string): Promise<void> {
  await prisma.teamsConversation.update({
    where: { conversation_id: conversationId },
    data: { pending_action: Prisma.DbNull },
  })
}

export async function addTokens(conversationId: string, tokens: number): Promise<number> {
  const n = Math.max(0, Math.round(tokens || 0))
  const row = await prisma.teamsConversation.update({
    where: { conversation_id: conversationId },
    data: { tokens_used: { increment: n } },
    select: { tokens_used: true },
  })
  return row.tokens_used
}

/**
 * Conversas para notificar o usuário proativamente: a mais recente de cada
 * tenant (a mesma pessoa pode ter o app em mais de um tenant).
 */
export async function findByUser(userId: string, tenantId?: string): Promise<TeamsConversation[]> {
  const rows = await prisma.teamsConversation.findMany({
    where: { user_id: userId, ...(tenantId ? { tenant_id: tenantId } : {}) },
    orderBy: [{ last_message_at: { sort: 'desc', nulls: 'last' } }, { updated_at: 'desc' }],
  })
  const seen = new Set<string>()
  return rows.filter(r => !seen.has(r.tenant_id) && seen.add(r.tenant_id))
}
