/**
 * Agente guidance: roda depois do intake (ou do complemento do solicitante, quando o
 * intake perguntou algo). 1º duplicidade com chamado aberto do mesmo solicitante;
 * senão, orientação de autoatendimento (base de resoluções + Microsoft Learn).
 * 'shadow' só deixa nota interna; 'apply' fala com o solicitante e marca
 * tickets.guidance_status. Roda uma vez por chamado, nunca lança, nunca muda status nem SLA.
 */
import prisma from '../../../config/prisma'
import { aiProvider } from '../../core/provider'
import { SYSTEM_USER_ID } from '../../../utils/constants'
import { aiConfigured, chat as llmChat, type ChatFn } from '../../core/llm'
import { askGate, gateOf, triageGate, type GateReading } from '../../core/gate'
import type { EmbedFn } from '../../core/embeddings'
import type { SearchLearnFn } from '../../core/learn'
import { recordRun, shortError } from '../../core/runs'
import { buildEvidence } from '../../core/ticketEvidence'
import { agentRuntime, type GuidanceConfig } from '../registry'
import { canSendQuestion } from '../intake/agent'
import { firstName } from '../intake/note'
import { checkDuplicate, type DuplicateResult } from './duplicate'
import { runGuidance, type FindCards, type GuidanceResult } from './guidance'
import { duplicateMessage, gateNote, guidanceMessage, hasContent, internalNote } from './note'
import { contextMessages, PROMPT_VERSION } from './prompt'

export const AGENT = 'guidance'

const OPEN_STATUSES = ['open', 'in_progress', 'pending'] as const

export interface GuidanceRun {
  skipReason?: string
  /** Portão do chamado (da triagem; sem triagem, lido aqui). */
  gate?: GateReading
  duplicate?: DuplicateResult | null
  guidance?: GuidanceResult | null
}

export interface GuidanceDeps { chat?: ChatFn; embed?: EmbedFn; searchLearn?: SearchLearnFn; findCards?: FindCards }

const note = (ticketId: string, text: string) =>
  prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: SYSTEM_USER_ID, type: 'internal', text } })

const setStatus = (ticketId: string, guidance_status: string) =>
  prisma.ticket.update({ where: { id: ticketId }, data: { guidance_status } })

/**
 * Chamados ainda abertos do mesmo solicitante, recentes e ANTERIORES a este: o agente roda em
 * segundo plano e, sem o corte por data, o chamado original via o repetido aberto depois e os
 * dois se ofereciam vínculo um ao outro.
 */
function openTicketsOf(ticket: { id: string; user_id: string; created_at: Date }, windowDays: number) {
  return prisma.ticket.findMany({
    where: {
      user_id: ticket.user_id, id: { not: ticket.id }, deleted_at: null,
      status: { in: [...OPEN_STATUSES] },
      created_at: { gte: new Date(Date.now() - windowDays * 86400_000), lt: ticket.created_at },
    },
    select: { id: true, display_number: true, title: true, description: true },
    orderBy: { created_at: 'desc' },
    take: 20,
  })
}

export async function guidanceTicket(ticketId: string, opts: { skipDuplicate?: boolean } = {}, deps: GuidanceDeps = {}): Promise<void> {
  if (!aiConfigured()) return
  const { mode, config } = await agentRuntime<GuidanceConfig>(AGENT).catch(() => ({ mode: 'off' as const, config: null as unknown as GuidanceConfig }))
  if (mode === 'off') return
  const info = { agent: AGENT, ticketId, mode, model: aiProvider().chatModel, promptVersion: PROMPT_VERSION }
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { user: true, category: true, subcategory: true, attachments: true },
    })
    if (!ticket || ticket.deleted_at || ticket.guidance_status) return
    // O intake perguntou algo: a orientação espera o complemento (complement → guidanceTicket).
    if (ticket.intake_status === 'incomplete') return

    const skipReason = ticket.user.role !== 'user' ? 'staff'
      : ticket.created_by_id && ticket.created_by_id !== ticket.user_id ? 'on_behalf'
      : ticket.subcategory?.is_special ? 'special_form' : null
    if (skipReason) {
      await recordRun(info, async () => ({ result: { skipReason } as GuidanceRun, inputTokens: 0, outputTokens: 0 }))
      if (mode === 'apply') await setStatus(ticketId, 'skipped')
      return
    }

    const { result, error } = await recordRun(info, async () => {
      let input = 0, output = 0
      const evidence = await buildEvidence(ticket)
      // Portão lido pela triagem; sem triagem, a orientação pergunta. Comunicado, teste ou resposta: ninguém a orientar.
      const gate = await triageGate(ticketId) ?? await askGate(contextMessages(evidence), async (m, o) => {
        const r = await (deps.chat ?? llmChat)(m, o)
        input += r.inputTokens
        output += r.outputTokens
        return r
      }, config.rigor)
      if (gateOf(gate) !== 'user') return { result: { skipReason: 'gate', gate } as GuidanceRun, inputTokens: input, outputTokens: output }
      // Duplicidade desligada no Motor IA (ou o solicitante já disse que é outro problema): vai direto à orientação.
      const dup = opts.skipDuplicate || !config.detectDuplicates ? null
        : await checkDuplicate(ticket, await openTicketsOf(ticket, config.duplicateWindowDays), { ...deps, rigor: config.rigor })
      input += dup?.inputTokens ?? 0
      output += dup?.outputTokens ?? 0
      const run: GuidanceRun = { gate, duplicate: dup?.result ?? null }
      if (!run.duplicate?.isDuplicate) {
        run.guidance = await runGuidance(evidence, { ...deps, config })
        input += run.guidance.inputTokens
        output += run.guidance.outputTokens
      }
      return { result: run, inputTokens: input, outputTokens: output }
    })
    if (!result) {
      await note(ticketId, `**Orientação IA** — não executada: ${shortError(error)} (o chamado segue sem alteração)`)
      return
    }

    if (result.skipReason === 'gate') {
      await note(ticketId, gateNote(result.gate!))
      if (mode === 'apply') await setStatus(ticketId, 'skipped')
      return
    }

    if (mode !== 'apply') {
      if (hasContent(result)) await note(ticketId, internalNote(result, mode, false))
      return
    }
    // Import tardio: services/tickets importa este módulo (ciclo).
    const { TicketService } = await import('../../../services/tickets')
    const to = { name: firstName(ticket.user.name) }
    const dup = result.duplicate?.isDuplicate ? result.duplicate : null
    const offer = dup ? duplicateMessage(to, dup.ticket) : result.guidance?.steps.length ? guidanceMessage(to, result.guidance) : null
    const sent = !!offer && await canSendQuestion(ticketId, ticket.user_id)
    if (hasContent(result)) await note(ticketId, internalNote(result, mode, sent))
    if (sent) await TicketService.addMessage(ticketId, 'system', offer!, 'agent')
    await setStatus(ticketId, sent ? (dup ? 'duplicate_offered' : 'offered') : 'none')
    await TicketService.broadcastTicketUpdate(ticketId)
  } catch (err: any) {
    console.error(`[AI:${AGENT}] chamado ${ticketId}:`, err?.message ?? err)
  }
}
