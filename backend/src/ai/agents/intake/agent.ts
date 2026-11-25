/**
 * Agente intake: roda depois da abertura e confere o checklist do tipo do chamado.
 * 'shadow' só deixa nota interna. 'apply' pergunta ao solicitante o que falta
 * (mensagem pública) e grava tickets.intake_status. Nunca lança e nunca muda
 * status nem SLA: a mensagem sai pelo caminho 'system' do addMessage.
 */
import prisma from '../../../config/prisma'
import { aiProvider } from '../../core/provider'
import { SYSTEM_USER_ID } from '../../../utils/constants'
import { aiConfigured } from '../../core/llm'
import { recordRun, shortError } from '../../core/runs'
import { agentRuntime, type IntakeConfig } from '../registry'
import { triageGate } from '../../core/gate'
import { buildEvidence, type Evidence } from '../../core/ticketEvidence'
import { loadChecklist } from './checklist'
import { runIntake, type ChecklistItem, type IntakeDeps, type IntakeResult } from './intake'
import { firstName, internalNote, publicMessage } from './note'
import { PROMPT_VERSION } from './prompt'

export const AGENT = 'intake'

type Run = (e: Evidence, items: ChecklistItem[], deps: IntakeDeps) => Promise<IntakeResult>

const note = (ticketId: string, text: string) =>
  prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: SYSTEM_USER_ID, type: 'internal', text } })

const setStatus = (ticketId: string, intake_status: string) =>
  prisma.ticket.update({ where: { id: ticketId }, data: { intake_status } })

/** Só fala com o solicitante enquanto o chamado está aberto e nenhum analista respondeu (relê o estado agora). */
export async function canSendQuestion(ticketId: string, requesterId: string) {
  const fresh = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true, deleted_at: true } })
  if (fresh?.status !== 'open' || fresh.deleted_at) return false
  const analystReplies = await prisma.ticketMessage.count({
    where: { ticket_id: ticketId, type: { in: ['agent', 'email'] }, user_id: { notIn: [requesterId, SYSTEM_USER_ID] } },
  })
  return analystReplies === 0
}

export async function intakeTicket(ticketId: string, run: Run = runIntake): Promise<void> {
  if (!aiConfigured()) return
  // Modo escolhido no Admin › Motor IA (sem escolha, o padrão do env); erro ao ler = desligado.
  const { mode, config } = await agentRuntime<IntakeConfig>(AGENT).catch(() => ({ mode: 'off' as const, config: null as unknown as IntakeConfig }))
  if (mode === 'off') return
  const info = { agent: AGENT, ticketId, mode, model: aiProvider().chatModel, promptVersion: PROMPT_VERSION }
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { user: true, category: true, subcategory: true, attachments: true },
    })
    if (!ticket || ticket.deleted_at) return

    // Pulos sem LLM: só uma linha em ai_agent_runs para medir quantos ficaram de fora.
    let skipReason: string | null = ticket.user.role !== 'user' ? 'staff'
      : ticket.created_by_id && ticket.created_by_id !== ticket.user_id ? 'on_behalf'
      : ticket.subcategory?.is_special ? 'special_form' : null
    // Checklist do tipo gravado, mesmo se a regra definiu um tipo e a IA leu outro: item fora do escopo sai por "não se aplica".
    const items = skipReason ? [] : await loadChecklist(ticket.type, ticket.subcategory_id)
    skipReason ??= items.length ? null : 'no_items'
    if (skipReason) {
      await recordRun(info, async () => ({ result: { skipReason }, inputTokens: 0, outputTokens: 0 }))
      if (mode === 'apply') await setStatus(ticketId, 'skipped')
      return
    }

    const { result, error } = await recordRun(info, async () => {
      // Portão lido pela triagem (sem triagem, o intake pergunta).
      const r = await run(await buildEvidence(ticket), items, { ...config, gate: await triageGate(ticketId) })
      return { result: r, inputTokens: r.inputTokens, outputTokens: r.outputTokens, promptVersion: r.promptVersion }
    })
    if (!result) {
      await note(ticketId, `**Completude IA** — não executada: ${shortError(error)} (o chamado segue sem alteração)`)
      return
    }
    if (mode === 'apply') {
      // Import tardio: services/tickets importa este módulo (ciclo).
      const { TicketService } = await import('../../../services/tickets')
      // Só pergunta enquanto o chamado está aberto e nenhum analista respondeu (relê o estado agora).
      const canAsk = !result.asks.length || await canSendQuestion(ticketId, ticket.user_id)
      await note(ticketId, internalNote(result, mode) + (canAsk ? '' : '\nPergunta não enviada: o chamado já está em atendimento.'))
      if (!canAsk) return
      if (result.asks.length) {
        await TicketService.addMessage(ticketId, 'system', publicMessage({ name: firstName(ticket.user.name), displayNumber: ticket.display_number, title: ticket.title }, result.asks), 'agent')
      }
      await setStatus(ticketId, result.skipped ? 'skipped' : result.asks.length ? 'incomplete' : 'complete')
      await TicketService.broadcastTicketUpdate(ticketId) // a marca aparece ao vivo para os analistas
      return
    }
    await note(ticketId, internalNote(result, mode))
  } catch (err: any) {
    console.error(`[AI:${AGENT}] chamado ${ticketId}:`, err?.message ?? err)
  }
}
