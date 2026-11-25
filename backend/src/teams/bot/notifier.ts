/**
 * Aviso proativo no Teams quando o analista responde publicamente.
 * Usa a ConversationReference salva no chat pessoal do solicitante; quem não
 * tem conversa com o bot só recebe o e-mail de sempre. Nunca bloqueia nem
 * derruba a resposta do analista: erro aqui só vai para o log.
 */
import { CardFactory, MessageFactory, type CloudAdapter } from '@microsoft/agents-hosting'
import type { ConversationReference } from '@microsoft/agents-activity'
import { logger } from '../../utils/logger'
import { SYSTEM_USER_ID } from '../../utils/constants'
import { getBotAdapter } from './adapter'
import { agentReplyCard } from './cards'
import { botConfig, tenantAllowed, type BotConfig } from './config'
import { findByUser } from './conversationStore'

export interface AgentReplyEvent {
  ticket: { id: string; display_number: string; title?: string | null; user_id: string }
  /** Quem escreveu (id já resolvido; 'system' vira o usuário de sistema). */
  authorId: string
  authorName?: string | null
  type: string
  text: string
  isRealtime?: boolean
  /** O solicitante já recebeu o conteúdo por outro caminho (ex.: estava em cópia no e-mail). */
  skipRequester?: boolean
}

/** Só resposta pública da equipe, fora do chat ao vivo, de outra pessoa que não o solicitante. */
export function isPublicAgentReply(e: AgentReplyEvent): boolean {
  return e.type === 'agent'
    && !e.isRealtime
    && !e.skipRequester
    && e.authorId !== 'system'
    && e.authorId !== SYSTEM_USER_ID
    && e.authorId !== e.ticket.user_id
    && !!e.text.trim()
}

export async function notifyAgentReply(
  e: AgentReplyEvent,
  deps: { adapter?: CloudAdapter | null; config?: BotConfig } = {},
): Promise<number> {
  try {
    if (!isPublicAgentReply(e)) return 0
    const config = deps.config ?? botConfig()
    const adapter = deps.adapter === undefined ? getBotAdapter(config) : deps.adapter
    if (!adapter) return 0
    const conversations = (await findByUser(e.ticket.user_id)).filter(c => tenantAllowed(config, c.tenant_id))
    if (!conversations.length) return 0

    const card = agentReplyCard({
      ticketId: e.ticket.id,
      displayNumber: e.ticket.display_number,
      title: e.ticket.title,
      agentName: e.authorName,
      message: e.text,
      url: `${config.portalUrl}/c/${encodeURIComponent(e.ticket.id)}`,
    })
    let sent = 0
    for (const c of conversations) {
      try {
        const reference = c.conversation_reference as unknown as ConversationReference
        await adapter.continueConversation(config.appId, reference, async context => {
          await context.sendActivity(MessageFactory.attachment(CardFactory.adaptiveCard(card)))
        })
        sent++
      } catch (err: any) {
        logger.warn(`[Teams:bot] aviso de resposta do ${e.ticket.display_number} falhou: ${err?.message ?? err}`)
      }
    }
    return sent
  } catch (err: any) {
    logger.warn(`[Teams:bot] aviso de resposta falhou: ${err?.message ?? err}`)
    return 0
  }
}
