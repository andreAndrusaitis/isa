/**
 * Agente knowledge: sugere a solução ainda no Wizard, antes de o chamado existir.
 * Busca trechos da base, pergunta ao motor de confiança se eles resolvem e só então
 * pede a resposta. 'shadow' faz tudo e grava, mas não devolve nada ao usuário.
 * Nunca lança: sem solução ou com qualquer falha, a abertura do chamado segue normal.
 */
import prisma from '../../../config/prisma'
import { aiProvider } from '../../core/provider'
import { askChoice, confidenceOf, wouldApply } from '../../core/choice'
import type { EmbedFn } from '../../core/embeddings'
import { AiError, aiConfigured, chat as llmChat, type ChatFn } from '../../core/llm'
import { maskPII, sanitizeForModel } from '../../core/masking'
import { recordRun } from '../../core/runs'
import { allowedCategories, searchChunks, type ChunkHit } from '../../knowledge/search'
import { CREDENTIAL_ASK } from '../guidance/guidance'
import { agentRuntime, type KnowledgeConfig } from '../registry'
import { LEAK } from '../resolution/distill'
import { answerMessage, contextMessages, PROMPT_ECHO, PROMPT_VERSION, refOf, RESOLVES_QUESTION } from './prompt'
import { confidenceFor, MIN_SIMILARITY, SUGGEST_BUDGET_MS } from './thresholds'

export const AGENT = 'knowledge'

const MAX_ANSWER_TOKENS = 500

export interface SuggestInput { title: string; description: string; categoryId?: string }
export interface SuggestDeps { chat?: ChatFn; embed?: EmbedFn; budgetMs?: number }
export interface SuggestionSource { articleId: string; title: string }
export interface Suggestion { answer: string; confidence: number; sources: SuggestionSource[]; interactionId: string }

type Outcome = 'no_match' | 'low_confidence' | 'not_answered' | 'filtered' | 'answered'

interface Attempt {
  outcome: Outcome
  topScore: number | null
  confidence: number | null
  answer: string | null
  sources: SuggestionSource[]
  questions: { key: string; confidence: number; margin: number; wouldApply: boolean }[]
}

const NO_ANSWER = { answer: null, sources: [] as SuggestionSource[] }

const parse = (raw: string): any => { try { return JSON.parse(raw) } catch { return {} } }

/** Cada chamada recebe só o que resta; esgotado, a sugestão desiste em vez de segurar o Wizard. */
function budget(totalMs: number) {
  const deadline = Date.now() + totalMs
  return () => {
    const left = deadline - Date.now()
    if (left <= 0) throw new AiError('AI_TIMEOUT', `LLM timeout: orçamento de ${totalMs} ms esgotado`)
    return left
  }
}

/**
 * Filtro de saída. Sem o unsafeForRequester da orientação: artigo interno tem link e
 * e-mail próprios. Telefone e e-mail do artigo passam; documento e senha, não.
 */
const SENSITIVE = /\[(?:CPF|CNPJ|RG|SENHA)\]/
function unsafeAnswer(text: string): boolean {
  return LEAK.test(text) || CREDENTIAL_ASK.test(text) || PROMPT_ECHO.test(text) || SENSITIVE.test(maskPII(text))
}

/** Fontes citadas pelo modelo, sempre entre as recebidas: id que ele inventou não vira artigo. */
function citedSources(cited: unknown, hits: ChunkHit[]): SuggestionSource[] {
  const refs = new Set((Array.isArray(cited) ? cited : []).map(c => String(c).trim().toUpperCase()))
  const used = hits.filter((_, i) => refs.has(refOf(i)))
  return [...new Map(used.map(h => [h.articleId, { articleId: h.articleId, title: h.title }])).values()]
}

/** Categoria só como contexto, e só se o usuário puder vê-la: o id vem do navegador. */
async function categoryName(categoryId: string | undefined, userId: string) {
  if (!categoryId) return null
  return (await allowedCategories(userId)).find(c => c.id === categoryId)?.name ?? null
}

/**
 * Lista vazia = todas. Sem categoria escolhida, basta o usuário alcançar uma do piloto:
 * a busca já fica restrita a elas. O acesso de verdade continua sendo o de searchChunks.
 */
async function inPilot(orgId: string | null, userId: string, config: KnowledgeConfig, categoryId?: string) {
  if (config.pilotOrgIds.length && !(orgId && config.pilotOrgIds.includes(orgId))) return false
  if (!config.pilotCategoryIds.length) return true
  if (categoryId) return config.pilotCategoryIds.includes(categoryId)
  return (await allowedCategories(userId)).some(c => config.pilotCategoryIds.includes(c.id))
}

const orgOf = (userId: string) => prisma.user.findUnique({ where: { id: userId }, select: { org_id: true } })

async function attempt(
  question: string, input: SuggestInput, userId: string, config: KnowledgeConfig,
  deps: SuggestDeps, left: () => number, call: ChatFn,
): Promise<Attempt> {
  const onlyCategoryIds = config.pilotCategoryIds.length ? config.pilotCategoryIds : undefined
  const found = await searchChunks(question, userId, { embed: deps.embed, timeoutMs: left(), onlyCategoryIds })
  const hits = found.filter(h => h.score >= MIN_SIMILARITY)
  const topScore = found[0]?.score ?? null
  if (!hits.length) return { outcome: 'no_match', topScore, confidence: null, questions: [], ...NO_ANSWER }

  const context = contextMessages(question, await categoryName(input.categoryId, userId), hits)
  const c = await askChoice(context, RESOLVES_QUESTION, call)
  // Probabilidade de "resolve", não da opção escolhida: certeza de que NÃO resolve fica perto de zero.
  const confidence = confidenceOf({ ...c, probability: c.probs[0] }, true)
  const passed = wouldApply(confidence, c.margin, confidenceFor(config.rigor))
  const read = { topScore, confidence, questions: [{ key: RESOLVES_QUESTION.key, confidence, margin: c.margin, wouldApply: passed }] }
  if (!passed) return { outcome: 'low_confidence', ...read, ...NO_ANSWER }

  const out = parse((await call([...context, answerMessage()], { maxTokens: MAX_ANSWER_TOKENS, json: true })).text)
  const answer = typeof out.resposta === 'string' ? out.resposta.trim() : ''
  const sources = citedSources(out.fontes, hits)
  if (out.resolve !== true || !answer || !sources.length) return { outcome: 'not_answered', ...read, ...NO_ANSWER }
  if (unsafeAnswer(answer)) return { outcome: 'filtered', ...read, ...NO_ANSWER }
  return { outcome: 'answered', ...read, answer, sources }
}

export async function suggest(input: SuggestInput, userId: string, deps: SuggestDeps = {}): Promise<Suggestion | null> {
  try {
    if (!aiConfigured()) return null
    const { mode, config } = await agentRuntime<KnowledgeConfig>(AGENT)
    if (mode === 'off') return null
    const user = await orgOf(userId)
    if (!user || !await inPilot(user.org_id, userId, config, input.categoryId)) return null

    // Mascarada e cortada antes de tudo: é este texto que vai ao embed, ao chat e ao banco.
    const question = sanitizeForModel(`${input.title}\n${input.description}`)
    const left = budget(deps.budgetMs ?? SUGGEST_BUDGET_MS)
    const save = (a: Pick<Attempt, 'answer' | 'confidence' | 'sources'>) => prisma.aiInteraction.create({
      data: { user_id: userId, org_id: user.org_id, question, answer: a.answer, confidence: a.confidence, sources: a.sources as object[] },
      select: { id: true },
    })

    let suggestion: Suggestion | null = null
    let interactionId: string | null = null
    const { error } = await recordRun({ agent: AGENT, mode, model: aiProvider().chatModel, promptVersion: PROMPT_VERSION }, async () => {
      let inputTokens = 0, outputTokens = 0
      const call: ChatFn = async (m, o) => {
        const r = await (deps.chat ?? llmChat)(m, { ...o, timeoutMs: left() })
        inputTokens += r.inputTokens
        outputTokens += r.outputTokens
        return r
      }
      const a = await attempt(question, input, userId, config, deps, left, call)
      const { id } = await save(a)
      interactionId = id
      if (a.answer) suggestion = { answer: a.answer, confidence: a.confidence!, sources: a.sources, interactionId: id }
      return {
        inputTokens, outputTokens,
        result: {
          outcome: a.outcome, rigor: config.rigor, topScore: a.topScore, confidence: a.confidence,
          articleIds: a.sources.map(s => s.articleId), interactionId: id, questions: a.questions,
        },
      }
    })

    // Falha do provedor também fica registrada, mas sem execução ok: as lacunas a descartam.
    if (error !== null) {
      if (!interactionId) await save({ confidence: null, ...NO_ANSWER })
      return null
    }
    return mode === 'apply' ? suggestion : null
  } catch (err: any) {
    console.error(`[AI:${AGENT}] sugestão falhou:`, err?.message ?? err)
    return null
  }
}

/**
 * Para o Wizard saber se mostra o card (enabled) ou só roda a sugestão calada (shadow).
 * Nunca lança: na dúvida, desligado.
 */
export async function suggestStatus(userId: string): Promise<{ enabled: boolean; shadow: boolean }> {
  const off = { enabled: false, shadow: false }
  try {
    if (!aiConfigured()) return off
    const { mode, config } = await agentRuntime<KnowledgeConfig>(AGENT)
    if (mode === 'off') return off
    const user = await orgOf(userId)
    if (!user || !await inPilot(user.org_id, userId, config)) return off
    return { enabled: mode === 'apply', shadow: mode === 'shadow' }
  } catch (err: any) {
    console.error(`[AI:${AGENT}] status falhou:`, err?.message ?? err)
    return off
  }
}
