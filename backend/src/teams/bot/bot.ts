/**
 * Bot do ISA no Teams.
 * Conversa com o assistente
 * (runAssistant, via 'teams'), escrita só com "Confirmar", abertura guiada por
 * cards, wizard do portal em dialog e extensão de mensagem.
 *
 * Toda decisão de acesso usa o usuário resolvido pelo AAD da atividade
 * (identity.ts); dado vindo de card ou dialog nunca escolhe o usuário.
 */
import { Activity, ActivityTypes } from '@microsoft/agents-activity'
import { CardFactory, MessageFactory, type TurnContext } from '@microsoft/agents-hosting'
import { TeamsInfo } from '@microsoft/agents-hosting-extensions-teams'
import type { TeamsConversation } from '@prisma/client'
import prisma from '../../config/prisma'
import { runAssistant, type RunAssistantInput } from '../../ai/assistant/orchestrator'
import { assistantTools } from '../../ai/assistant/tools'
import type { AssistantReply, AssistantTool, PendingAction } from '../../ai/assistant/types'
import type { ToolChatFn } from '../../ai/core/llm'
import { AI_NAME } from '../../ai/core/persona'
import { getAvailableCategoriesForUser } from '../../services/categories'
import {
  CARD_SCHEMA, CARD_VERSION, categoryCard, confirmationCard, excerpt, parseCardAction, subcategoryCard,
  ticketFormCard, ticketFromSubmit, type AdaptiveCard, type CardAction, type CardCategory, type CardSubcategory,
} from './cards'
import { TURN_ERROR_TEXT } from './adapter'
import { botConfig, type BotConfig } from './config'
import {
  appendMessages, clearPending, getOrCreate, readHistory, readPending, setPending,
} from './conversationStore'
import { dialogContinue, dialogMessage, MESSAGE_ACTION_COMMAND, openFormAction, prefillFromMessage, ticketDialogUrl, type DialogPrefill } from './dialog'
import { resolveTeamsUser, TENANT_NOT_ALLOWED_TEXT, UNKNOWN_USER_TEXT, type GetMember } from './identity'

export type BotCategory = CardCategory & { subcategories: CardSubcategory[] }

export interface BotDeps {
  config: () => BotConfig
  getMember: GetMember
  tools: AssistantTool[]
  assistant: (input: RunAssistantInput) => Promise<AssistantReply>
  categories: (userId: string) => Promise<BotCategory[]>
  chatFn?: ToolChatFn
}

export const HELP_TEXT = [
  `Sou a ${AI_NAME}, assistente de IA do **ISA**. Posso:`,
  '- tirar dúvidas de Windows, Office, Teams e Outlook com a documentação da Microsoft;',
  '- abrir um chamado para você (sempre peço confirmação antes);',
  '- mostrar e responder os seus chamados.',
  '',
  'Atalhos: **meus chamados**, **abrir chamado**, **ajuda**. Ou escreva o que está acontecendo.',
].join('\n')
export const WELCOME_TEXT = `Olá! ${HELP_TEXT}`
export const NOTHING_PENDING_TEXT = 'Não há nenhuma ação aguardando confirmação. Pode me pedir de novo?'
export const CANCELLED_TEXT = 'Tudo bem, cancelei. Se precisar, é só me chamar.'
export const PERSONAL_ONLY_TEXT = 'Fale comigo no chat pessoal do app ISA.'
const UNAVAILABLE_CATEGORY_TEXT = 'Essa opção não está mais disponível para você. Escolha de novo, por favor.'

const defaults: BotDeps = {
  config: () => botConfig(),
  getMember: (context, memberId) => TeamsInfo.getMember(context, memberId),
  tools: assistantTools,
  assistant: runAssistant,
  categories: async userId => (await getAvailableCategoriesForUser(userId)) as unknown as BotCategory[],
}

type User = { userId: string; tenantId: string; aadObjectId: string }

// ---------- envio ----------

const sendText = (context: TurnContext, text: string) => context.sendActivity(MessageFactory.text(text))

function sendCard(context: TurnContext, card: AdaptiveCard, text?: string) {
  return context.sendActivity(MessageFactory.attachment(CardFactory.adaptiveCard(card), text))
}

function invokeResponse(context: TurnContext, body?: unknown, status = 200) {
  return context.sendActivity(Activity.fromObject({ type: ActivityTypes.InvokeResponse, value: { status, body } }))
}

const withActions = (card: AdaptiveCard, ...actions: Record<string, unknown>[]): AdaptiveCard =>
  ({ ...card, actions: [...(card.actions ?? []), ...actions] })

const mdLink = (title: string, url: string) => `[${title.replace(/[[\]]/g, '')}](${url})`

function withSources(text: string, sources?: AssistantReply['sources']): string {
  if (!sources?.length) return text
  return `${text}\n\nFontes: ${sources.map(s => mdLink(s.title, s.url)).join(' · ')}`
}

const ticketUrl = (config: BotConfig, ticketId: string) => `${config.portalUrl}/c/${encodeURIComponent(ticketId)}`

// ---------- conversa ----------

function isPersonal(context: TurnContext): boolean {
  return (context.activity.conversation as any)?.conversationType === 'personal'
}

/** ConversationReference como JSON puro (agent = bot no SDK novo; bot mantido para o store). */
function referenceOf(context: TurnContext) {
  const a = context.activity
  return JSON.parse(JSON.stringify({
    activityId: a.id,
    user: a.from,
    agent: a.recipient,
    bot: a.recipient,
    conversation: a.conversation,
    channelId: a.channelId,
    locale: a.locale,
    serviceUrl: a.serviceUrl,
  }))
}

function saveConversation(context: TurnContext, user: User): Promise<TeamsConversation> {
  const a = context.activity
  return getOrCreate({
    conversationId: a.conversation!.id,
    tenantId: user.tenantId,
    aadObjectId: user.aadObjectId,
    serviceUrl: a.serviceUrl ?? '',
    reference: referenceOf(context),
    userId: user.userId,
  })
}

/** Usuário da atividade; manda o aviso adequado e devolve null quando não dá para seguir. */
async function identify(context: TurnContext, deps: BotDeps, notify: (text: string) => Promise<unknown>): Promise<User | null> {
  const identity = await resolveTeamsUser(context, deps.config(), deps.getMember)
  if (identity.status === 'ok') return identity
  await notify(identity.status === 'tenant_not_allowed' ? TENANT_NOT_ALLOWED_TEXT : UNKNOWN_USER_TEXT)
  return null
}

function normalizeCommand(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

type Command = 'ajuda' | 'meus_chamados' | 'abrir_chamado'
const COMMANDS: Record<string, Command> = {
  'ajuda': 'ajuda', 'help': 'ajuda', 'menu': 'ajuda', 'oi': 'ajuda', 'ola': 'ajuda',
  'meus chamados': 'meus_chamados', 'minhas solicitacoes': 'meus_chamados',
  'abrir chamado': 'abrir_chamado', 'novo chamado': 'abrir_chamado', 'abrir um chamado': 'abrir_chamado',
}

// ---------- escrita confirmada ----------

/** Roda a escrita confirmada guardando o resultado da ferramenta (número e id do chamado). */
async function runConfirmed(deps: BotDeps, user: User, conversationId: string, confirm: PendingAction) {
  let written: any = null
  const tools = deps.tools.map(t => (t.write && t.name === confirm.tool
    ? { ...t, handler: async (input: any, ctx: any) => { written = await t.handler(input, ctx); return written } }
    : t))
  const reply = await deps.assistant({
    userId: user.userId, via: 'teams', history: [], message: '', tools, confirm,
    conversationId: `teams:${conversationId}`,
  })
  return { reply, written }
}

function confirmedText(config: BotConfig, tool: string, reply: AssistantReply, written: any): string {
  const numero = typeof written?.numero === 'string' ? written.numero : null
  if (!numero) return reply.text
  if (tool === 'abrir_chamado') {
    const link = typeof written.id === 'string' ? ` ${mdLink('Ver chamado', ticketUrl(config, written.id))}` : ''
    return `Chamado **${numero}** aberto. Você recebe as respostas do analista aqui e por e-mail.${link}`
  }
  if (tool === 'responder_analista') return `Resposta enviada no chamado **${numero}**.`
  if (tool === 'reabrir_chamado') return `Chamado **${numero}** reaberto.`
  return reply.text
}

async function executeConfirmed(context: TurnContext, deps: BotDeps, user: User, conversationId: string, confirm: PendingAction) {
  const { reply, written } = await runConfirmed(deps, user, conversationId, confirm)
  const text = confirmedText(deps.config(), confirm.tool, reply, written)
  await appendMessages(conversationId, [{ role: 'assistant', content: text }])
  await sendText(context, text)
}

function prefillOf(pending: PendingAction): DialogPrefill {
  const input = (pending.input ?? {}) as { titulo?: unknown; descricao?: unknown }
  return {
    titulo: typeof input.titulo === 'string' ? input.titulo : null,
    descricao: typeof input.descricao === 'string' ? input.descricao : null,
  }
}

/** Guarda a pendência e pede confirmação; abrir chamado ganha o atalho do formulário. */
async function askConfirmation(context: TurnContext, conversationId: string, pending: PendingAction, facts: Array<{ title: string; value: string }> = []) {
  await setPending(conversationId, pending)
  const card = confirmationCard(pending, facts)
  await sendCard(context, pending.tool === 'abrir_chamado' ? withActions(card, openFormAction(prefillOf(pending))) : card)
}

async function sendAssistantReply(context: TurnContext, conversationId: string, reply: AssistantReply) {
  if (!reply.pending) return sendText(context, withSources(reply.text, reply.sources))
  // O orquestrador termina o texto com "Confirma? <resumo>": o card mostra o resumo.
  const marker = `Confirma? ${reply.pending.summary}`
  const preface = reply.text.endsWith(marker) ? reply.text.slice(0, -marker.length).trim() : ''
  if (preface || reply.sources?.length) await sendText(context, withSources(preface || 'Encontrei isto:', reply.sources))
  return askConfirmation(context, conversationId, reply.pending)
}

// ---------- comandos ----------

async function sendMyTickets(context: TurnContext, deps: BotDeps, user: User) {
  const tool = deps.tools.find(t => t.name === 'meus_chamados')
  const list = tool ? ((await tool.handler({ limite: 5 }, { userId: user.userId, via: 'teams' })) as any[]) : []
  if (!list?.length) return sendText(context, 'Você ainda não tem chamados. Quer abrir um? Escreva **abrir chamado** ou me conte o problema.')
  const lines = list.map(t => `- **${t.numero}** — ${excerpt(String(t.titulo ?? ''), 80)} · ${t.status}`)
  return sendText(context, `Seus chamados mais recentes:\n\n${lines.join('\n')}\n\nPara ver um deles, escreva por exemplo "como está o ${list[0].numero}?".`)
}

async function loadCategories(context: TurnContext, deps: BotDeps, user: User): Promise<BotCategory[] | null> {
  try {
    return await deps.categories(user.userId)
  } catch (err: any) {
    await sendText(context, err?.code === 'SLA_PLAN_EXPIRED' && err?.message ? err.message : 'Não consegui carregar as categorias agora. Tente de novo em instantes.')
    return null
  }
}

async function sendCategories(context: TurnContext, deps: BotDeps, user: User) {
  const categories = await loadCategories(context, deps, user)
  if (categories) await sendCard(context, withActions(categoryCard(categories), openFormAction()))
}

function findSubcategory(categories: BotCategory[], id: string) {
  for (const category of categories) {
    const sub = category.subcategories?.find(s => s.id === id)
    if (sub) return { category, sub }
  }
  return null
}

const usesSpecialForm = (sub: CardSubcategory) => !!sub.is_special && !!sub.special_form_schema?.length

/** Pedido especial (onboarding, offboarding…) vai pelo formulário do portal. */
function specialFormCard(sub: CardSubcategory): AdaptiveCard {
  return {
    type: 'AdaptiveCard', $schema: CARD_SCHEMA, version: CARD_VERSION,
    body: [
      { type: 'TextBlock', text: sub.name, weight: 'Bolder', size: 'Medium', wrap: true },
      { type: 'TextBlock', text: 'Este pedido tem um formulário próprio. Abra pelo formulário para preencher tudo de uma vez.', wrap: true },
    ],
    actions: [openFormAction({ titulo: sub.name })],
  }
}

// ---------- cards ----------

async function onCardAction(context: TurnContext, deps: BotDeps, user: User, conversation: TeamsConversation, action: CardAction) {
  const conversationId = conversation.conversation_id
  switch (action.acao) {
    case 'categorias':
      return sendCategories(context, deps, user)
    case 'categoria': {
      const categories = await loadCategories(context, deps, user)
      if (!categories) return
      const category = categories.find(c => c.id === action.id)
      if (!category) return sendText(context, UNAVAILABLE_CATEGORY_TEXT)
      return sendCard(context, subcategoryCard(category, category.subcategories ?? []))
    }
    case 'subcategoria': {
      const categories = await loadCategories(context, deps, user)
      if (!categories) return
      const found = findSubcategory(categories, action.id)
      if (!found) return sendText(context, UNAVAILABLE_CATEGORY_TEXT)
      if (usesSpecialForm(found.sub)) return sendCard(context, specialFormCard(found.sub))
      return sendCard(context, withActions(ticketFormCard(found.sub, found.category.name), openFormAction()))
    }
    case 'abrir': {
      const categories = await loadCategories(context, deps, user)
      if (!categories) return
      const found = findSubcategory(categories, action.subcategoryId)
      if (!found) return sendText(context, UNAVAILABLE_CATEGORY_TEXT)
      if (usesSpecialForm(found.sub)) return sendCard(context, specialFormCard(found.sub))
      const draft = ticketFromSubmit(found.sub, action.values)
      if (!draft.ok) return sendText(context, draft.error)
      const tool = deps.tools.find(t => t.name === 'abrir_chamado')
      if (!tool) return sendText(context, 'Abrir chamado pelo chat está indisponível. Use o formulário do portal.')
      const input = { titulo: draft.ticket.title!, descricao: draft.ticket.description!, categoryId: found.category.id, subcategoryId: found.sub.id }
      const summary = tool.describe?.(input) ?? `Abrir chamado "${input.titulo}"`
      return askConfirmation(context, conversationId, { tool: tool.name, input, summary }, [
        { title: 'Categoria', value: found.category.name },
        { title: 'Assunto', value: found.sub.name },
      ])
    }
    case 'confirmar': {
      const pending = readPending(conversation)
      if (!pending || (action.tool && action.tool !== pending.tool)) return sendText(context, NOTHING_PENDING_TEXT)
      // Limpa antes de executar: dois cliques no "Confirmar" não abrem dois chamados.
      await clearPending(conversationId)
      return executeConfirmed(context, deps, user, conversationId, pending)
    }
    case 'cancelar':
      if (readPending(conversation)) await clearPending(conversationId)
      return sendText(context, CANCELLED_TEXT)
    case 'responder': {
      // O submit do card "o analista respondeu" é a confirmação explícita da resposta.
      if (!action.text) return sendText(context, 'Escreva a resposta antes de enviar.')
      const tool = deps.tools.find(t => t.name === 'responder_analista')
      if (!tool) return sendText(context, 'Responder pelo chat está indisponível. Responda pelo portal.')
      const input = { chamado: action.ticketId, mensagem: action.text }
      const summary = tool.describe?.(input) ?? 'Responder ao analista'
      return executeConfirmed(context, deps, user, conversationId, { tool: tool.name, input, summary })
    }
  }
}

// ---------- mensagem ----------

async function onMessage(context: TurnContext, deps: BotDeps) {
  const user = await identify(context, deps, text => sendText(context, text))
  if (!user) return
  if (!isPersonal(context)) return sendText(context, PERSONAL_ONLY_TEXT)
  const conversation = await saveConversation(context, user)
  const conversationId = conversation.conversation_id

  const value = context.activity.value
  if (value && typeof value === 'object') {
    const action = parseCardAction(value)
    if (!action) return sendText(context, 'Não reconheci essa ação. Escreva **ajuda** para ver o que posso fazer.')
    return onCardAction(context, deps, user, conversation, action)
  }

  const text = excerpt(context.activity.text ?? '', 4000)
  if (!text) return
  // Mensagem nova cancela a pendência: o "Confirmar" antigo não vale mais.
  if (readPending(conversation)) await clearPending(conversationId)

  const command = COMMANDS[normalizeCommand(text)]
  if (command === 'ajuda') return sendText(context, HELP_TEXT)
  if (command === 'meus_chamados') return sendMyTickets(context, deps, user)
  if (command === 'abrir_chamado') return sendCategories(context, deps, user)

  const history = readHistory(conversation).map(({ role, content }) => ({ role, content }))
  const reply = await deps.assistant({
    userId: user.userId, via: 'teams', history, message: text, tools: deps.tools,
    conversationId: `teams:${conversationId}`,
    ...(deps.chatFn ? { chatFn: deps.chatFn } : {}),
  })
  await appendMessages(conversationId, [{ role: 'user', content: text }, { role: 'assistant', content: reply.text }])
  return sendAssistantReply(context, conversationId, reply)
}

async function onConversationUpdate(context: TurnContext, deps: BotDeps) {
  const a = context.activity
  const botId = a.recipient?.id
  if (!isPersonal(context) || !a.membersAdded?.some(m => m.id === botId)) return
  const identity = await resolveTeamsUser(context, deps.config(), deps.getMember)
  if (identity.status === 'tenant_not_allowed') return
  if (identity.status === 'unknown') return sendText(context, `Olá! ${UNKNOWN_USER_TEXT}`)
  await saveConversation(context, identity)
  return sendText(context, WELCOME_TEXT)
}

// ---------- dialog e extensão de mensagem ----------

/** Chamado que o wizard diz ter aberto, conferido no banco como da própria pessoa. */
async function ownTicket(userId: string, data: unknown) {
  const ticketId = (data as any)?.ticketId
  if (typeof ticketId !== 'string' || !ticketId.trim()) return null
  return prisma.ticket.findFirst({
    where: { id: ticketId.trim(), user_id: userId, deleted_at: null },
    select: { id: true, display_number: true, ai_resolved: true },
  })
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

/** Chamado resolvido pela IA não passa por analista: "aberto" prometeria uma resposta que não vem. */
const ticketOutcome = (ticket: { ai_resolved: boolean }, repliesAt: string) => (ticket.ai_resolved
  ? 'resolvido. Ele fica disponível para consulta no portal.'
  : `aberto. Você recebe as respostas do analista ${repliesAt} e por e-mail.`)

async function onInvoke(context: TurnContext, deps: BotDeps) {
  const a = context.activity
  const value = (a.value ?? {}) as any
  const config = deps.config()
  let notice: string | null = null
  const user = await identify(context, deps, async text => { notice = text })
  if (!user) return invokeResponse(context, dialogMessage(notice ?? UNKNOWN_USER_TEXT))

  switch (a.name) {
    case 'task/fetch': {
      const data = value.data ?? {}
      return invokeResponse(context, dialogContinue(ticketDialogUrl(config.portalUrl, { titulo: str(data.titulo), descricao: str(data.descricao) })))
    }
    case 'composeExtension/fetchTask': {
      if (value.commandId !== MESSAGE_ACTION_COMMAND) return invokeResponse(context, dialogMessage('Comando desconhecido.'))
      return invokeResponse(context, dialogContinue(ticketDialogUrl(config.portalUrl, prefillFromMessage(value.messagePayload))))
    }
    case 'task/submit': {
      const ticket = await ownTicket(user.userId, value.data)
      if (!ticket) return invokeResponse(context)
      await invokeResponse(context)
      if (isPersonal(context)) {
        const text = `Chamado **${ticket.display_number}** ${ticketOutcome(ticket, 'aqui')} ${mdLink('Ver chamado', ticketUrl(config, ticket.id))}`
        await sendText(context, text)
      }
      return
    }
    case 'composeExtension/submitAction': {
      const ticket = await ownTicket(user.userId, value.data)
      if (!ticket) return invokeResponse(context)
      return invokeResponse(context, dialogMessage(`Chamado ${ticket.display_number} ${ticketOutcome(ticket, 'no chat do ISA')}`))
    }
    default:
      return undefined
  }
}

export function createBotHandler(overrides: Partial<BotDeps> = {}) {
  const deps: BotDeps = { ...defaults, ...overrides }
  return async function onTurn(context: TurnContext): Promise<void> {
    switch (context.activity.type) {
      case ActivityTypes.Message:
        await onMessage(context, deps)
        return
      case ActivityTypes.Invoke:
        // Invoke sem resposta deixa o dialog do Teams girando: erro vira aviso no próprio dialog.
        try {
          await onInvoke(context, deps)
        } catch (err: any) {
          console.error('[Teams:bot] invoke falhou:', err?.message ?? err)
          await invokeResponse(context, dialogMessage(TURN_ERROR_TEXT))
        }
        return
      case ActivityTypes.ConversationUpdate:
        await onConversationUpdate(context, deps)
        return
    }
  }
}
