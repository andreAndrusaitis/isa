/**
 * Agente de triagem: roda depois da abertura, registra em ai_agent_runs e deixa
 * nota interna. Em 'shadow' só sugere; em 'apply' grava no chamado os campos que
 * passaram no limiar (apply.ts). Nunca lança: falha vira linha 'error' e nota curta.
 */
import prisma from '../../../config/prisma'
import { aiProvider } from '../../core/provider'
import { SYSTEM_USER_ID } from '../../../utils/constants'
import { similarExamples } from '../../core/examples'
import { aiConfigured } from '../../core/llm'
import { recordRun, shortError } from '../../core/runs'
import { agentRuntime, type TriageConfig } from '../registry'
import { buildEvidence, type Evidence } from '../../core/ticketEvidence'
import { loadQuestions, loadSubcategoryOptions } from './options'
import { runTriage, type TriageResult } from './triage'
import { applyTriage, planTriage, type ChangedField } from './apply'
import { formatNote } from './note'
import { PROMPT_VERSION } from './prompt'

export const AGENT = 'triage'

const FIELDS: ChangedField[] = ['type', 'priority', 'category', 'subcategory']
/** Campos que o modo apply pode gravar (Motor IA › Triagem; padrão = AI_TRIAGE_APPLY_FIELDS). */
export const applyFields = (config: Pick<TriageConfig, 'applyFields'>) =>
  new Set(config.applyFields.filter((f): f is ChangedField => FIELDS.includes(f as ChangedField)))

// Sem exemplos no banco (ou com o RAG desligado no Motor IA) a triagem roda sem exemplos (= triage-v4, sem o sufixo -rag).
// Opções de categoria = as que a empresa do chamado tem acesso (options.ts).
const defaultRun = async (e: Evidence, config: TriageConfig, orgId?: string | null) =>
  runTriage(e, await loadQuestions(orgId), {
    subcategoryOptions: loadSubcategoryOptions,
    examples: config.useExamples ? ev => similarExamples(AGENT, ev.text) : undefined,
    rigor: config.rigor,
  })

export async function triageTicket(
  ticketId: string,
  run: (e: Evidence, config: TriageConfig, orgId?: string | null) => Promise<TriageResult> = defaultRun,
): Promise<void> {
  if (!aiConfigured()) return
  // Modo e configuração escolhidos no Admin › Motor IA (sem escolha, os padrões); erro ao ler = desligado.
  const { mode, config } = await agentRuntime<TriageConfig>(AGENT).catch(() => ({ mode: 'off' as const, config: null as unknown as TriageConfig }))
  if (mode === 'off') return
  // Chamado já na Lixeira (ex.: regra de abertura que exclui "RE:"): não gasta LLM nem altera.
  const alive = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { deleted_at: true } })
  if (!alive || alive.deleted_at) return
  let userCategory: string | null = null
  const { result, error } = await recordRun(
    { agent: AGENT, ticketId, mode, model: aiProvider().chatModel, promptVersion: PROMPT_VERSION },
    async () => {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { category: true, subcategory: true, attachments: true },
      })
      if (!ticket) throw new Error('Chamado não encontrado')
      const evidence = await buildEvidence(ticket)
      userCategory = evidence.userCategory
      const r: TriageResult = await run(evidence, config, ticket.org_id)
      r.input = { text: evidence.text, images: evidence.images.length, userCategory: evidence.userCategory }
      r.config = { rigor: config.rigor, applyFields: config.applyFields, useExamples: config.useExamples }
      r.ragExampleIds ??= []
      // Falha ao gravar não perde a triagem: fica registrada em applyError.
      try {
        if (mode === 'apply') {
          const { applied, suggested } = await applyTriage(ticketId, r, applyFields(config))
          r.applied = applied
          if (suggested.length) r.proposed = suggested
        } else r.proposed = (await planTriage(ticketId, r)).changes
      } catch (err: any) { r.applyError = String(err?.message ?? err) }
      return { result: r, inputTokens: r.inputTokens, outputTokens: r.outputTokens, promptVersion: r.promptVersion }
    },
  )
  const text = result
    ? formatNote(result, aiProvider().chatModel, userCategory)
    : `**Triagem IA** — não executada: ${shortError(error)} (o chamado segue sem alteração)`
  await prisma.ticketMessage.create({
    data: { ticket_id: ticketId, user_id: SYSTEM_USER_ID, type: 'internal', text },
  }).catch(err => console.error(`[AI:${AGENT}] nota do chamado ${ticketId} falhou:`, err?.message ?? err))
}
