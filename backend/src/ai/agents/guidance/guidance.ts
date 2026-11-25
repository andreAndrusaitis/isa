/**
 * Agente guidance (função pura): Microsoft? → busca no Learn; cartões parecidos da
 * base de resoluções; a LLM compõe passos de autoatendimento só a partir dessas
 * fontes (cada passo cita a fonte; fonte inexistente = passo descartado; links só
 * os recebidos da busca). Cartões "equipe" viram dicas internas, sem LLM.
 */
import { askChoice, confidenceOf, wouldApply, withRigor, type Thresholds } from '../../core/choice'
import { chat as llmChat, type ChatFn } from '../../core/llm'
import { searchLearn as defaultSearchLearn, type LearnDoc, type SearchLearnFn } from '../../core/learn'
import { similarExamples } from '../../core/examples'
import type { Evidence } from '../../core/ticketEvidence'
import { AGENT as RESOLUTION, LEAK, type CardLabels } from '../resolution/distill'
import type { GuidanceConfig } from '../registry'
import { analyzeMessage, composeMessage, contextMessages, KIND_QUESTION, PROMPT_VERSION, type SourceBlock } from './prompt'

export interface CardHit { id: string; problem: string; score: number; labels: CardLabels }
export type FindCards = (text: string) => Promise<CardHit[]>

export const MAX_STEPS = 5
export const MAX_LINKS = 3
export const MAX_HOW = 4
/** Ação que o usuário final não consegue (ou não deve) fazer sozinho: o passo inteiro é descartado. */
export const ADMIN = /powershell|centro de administração|admin center|portal (do )?azure|exchange admin|entra admin|regedit|editor de registro|registro do windows|prompt de comando|\bcmd\b|desativ\w+ (o )?(antiv[ií]rus|firewall)|como administrador/i
/** Domínios que a documentação oficial manda o usuário final acessar. */
const TRUSTED_HOST = /(^|\.)(microsoft\.com|microsoft365\.com|office\.com|office365\.com|live\.com|outlook\.com|aka\.ms)$/i
/** "Outlook.exe" e "ncpa.cpl" têm forma de domínio, mas são arquivos citados nos passos. */
const FILE_NAME = /\.(exe|msi|msc|cpl|pst|ost|ini|log|txt|csv|pdf|docx?|xlsx?|pptx?|png|jpe?g|eml|msg)$/i
/** Pedir que o usuário entregue um segredo; "digite sua senha" na tela do aplicativo é passo legítimo. */
export const CREDENTIAL_ASK = /\b(informe|envie|mande|forne[çc]a|compartilhe|responda|encaminhe)\b[^.!?\n]{0,40}\b(senhas?|password|c[oó]digos?|tokens?|credenci(al|ais)|mfa|otp|pix|cart[aã]o)\b|\bpix\b|cart[aã]o de (cr[eé]dito|d[eé]bito)/i

/**
 * O texto do chamado entra no prompt, então pode ditar o passo que sai assinado pelo
 * Skadi. Link em passo só de domínio oficial; os demais saem pelo array `links`.
 */
export function unsafeForRequester(text: string): boolean {
  if (CREDENTIAL_ASK.test(text) || /[\w.+-]+@[\w-]+\.\w/.test(text)) return true
  const urlHosts = [...text.matchAll(/https?:\/\/([^\s/?#]+)/gi)].map(m => m[1])
  const bareHosts = (text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? []).filter(h => !FILE_NAME.test(h))
  return [...urlHosts, ...bareHosts].some(h => !TRUSTED_HOST.test(h))
}

export const MAX_TEAM_HINTS = 3
// Limiar sem calibração; na dúvida não orienta (orientação indevida é o erro caro).
export const PROBLEM_THRESHOLD: Thresholds = { minConfidence: 0.7, minMargin: 0.3 }
/** Trechos do Learn enviados à composição (somando as duas consultas). */
export const MAX_DOCS = 5

export interface GuidanceResult {
  /** Portão: problem | request | other, e se "problem" passou no limiar. */
  kind: { chosen: string; probability: number; margin: number; roundsAgree: boolean; confidence: number; problem: boolean }
  microsoft: boolean
  learnQuery: string | null
  learn: { id: string; title: string; url: string }[]
  cards: { id: string; ref: string; problem: string; score: number; selfService: boolean; sourceDisplay: string }[]
  /** Passos para o solicitante, com a fonte (C1, L2…). Vazio = nada a oferecer. */
  steps: { text: string; how: string[]; source: string }[]
  links: { title: string; url: string }[]
  /** Cartões efetivamente citados nos passos (para o 👎). */
  usedCards: string[]
  teamHints: { cardId: string; text: string; sourceDisplay: string; score: number }[]
  inputTokens: number
  outputTokens: number
  promptVersion: string
}

export const defaultFindCards: FindCards = async text =>
  (await similarExamples(RESOLUTION, text, 6)).map(x => ({ id: x.id, problem: x.text, score: x.score, labels: x.labels as unknown as CardLabels }))

const parse = (raw: string): any => { try { return JSON.parse(raw) } catch { return {} } }

/** Configuração do Motor IA › Orientação que muda a orientação (sem ela, os padrões). */
export type GuidanceOptions = Partial<Pick<GuidanceConfig, 'rigor' | 'useInternalBase' | 'useLearn' | 'maxSteps' | 'howTo'>>

export async function runGuidance(
  e: Evidence,
  deps: { chat?: ChatFn; searchLearn?: SearchLearnFn; findCards?: FindCards; config?: GuidanceOptions } = {},
): Promise<GuidanceResult> {
  const cfg = deps.config ?? {}
  const chatFn = deps.chat ?? llmChat
  const usage = { input: 0, output: 0 }
  const call: ChatFn = async (m, o) => {
    const r = await chatFn(m, o)
    usage.input += r.inputTokens
    usage.output += r.outputTokens
    return r
  }
  const ctx = contextMessages(e)

  // Portão, análise e cartões em paralelo: os três só dependem do texto.
  const [k, analysis, hits] = await Promise.all([
    askChoice(ctx, KIND_QUESTION, call),
    call([...ctx, analyzeMessage()], { maxTokens: 160, json: true }).then(r => parse(r.text)),
    cfg.useInternalBase === false ? Promise.resolve([] as CardHit[]) : (deps.findCards ?? defaultFindCards)(e.text),
  ])
  const kindConfidence = confidenceOf(k, true)
  const kindValue = KIND_QUESTION.options[k.chosen].value
  const kind = {
    chosen: kindValue, probability: k.probability, margin: k.margin, roundsAgree: k.roundsAgree, confidence: kindConfidence,
    problem: kindValue === 'problem' && wouldApply(kindConfidence, k.margin, withRigor(PROBLEM_THRESHOLD, cfg.rigor)),
  }
  // Pedido para a equipe ou comunicado: sem Learn nem composição; as dicas de equipe seguem para o analista.
  const microsoft = kind.problem && analysis.microsoft === true
  // Duas consultas em paralelo: a busca do Learn é sensível à redação e às vezes só devolve o fórum (filtrado).
  const queries = microsoft && Array.isArray(analysis.queries)
    ? [...new Set((analysis.queries as unknown[]).filter((q): q is string => typeof q === 'string' && !!q.trim()).map(q => q.trim().slice(0, 200)))].slice(0, 2)
    : []
  const learnQuery = queries.length ? queries.join(' | ') : null
  const found = cfg.useLearn === false ? [] : await Promise.all(queries.map(q => (deps.searchLearn ?? defaultSearchLearn)(q)))
  const docs: LearnDoc[] = [...new Map(found.flat().map(d => [d.url.split('#')[0], d])).values()].slice(0, MAX_DOCS)

  const learn = docs.map((d, i) => ({ id: `L${i + 1}`, title: d.title, url: d.url }))
  const cards = hits.map((h, i) => ({
    id: h.id, ref: `C${i + 1}`, problem: h.problem, score: h.score,
    selfService: h.labels.selfService === true, sourceDisplay: String(h.labels.sourceDisplay ?? ''),
  }))
  // Comunicado ou resposta sem pedido: dica de equipe seria ruído.
  const teamHints = (kind.chosen === 'other' ? [] : hits).filter(h => h.labels.teamAction).slice(0, MAX_TEAM_HINTS).map(h => ({
    cardId: h.id, text: h.labels.teamAction, sourceDisplay: String(h.labels.sourceDisplay ?? ''), score: h.score,
  }))

  const sources: SourceBlock[] = [
    ...docs.map((d, i) => ({ id: `L${i + 1}`, text: `${d.title}\n${d.content}` })),
    ...hits.flatMap((h, i) => h.labels.selfService
      ? [{ id: `C${i + 1}`, text: `Problema: ${h.problem}\nPassos: ${h.labels.steps.join(' | ')}` }]
      : []),
  ]
  const result = (steps: GuidanceResult['steps'] = [], linkIds: string[] = []): GuidanceResult => {
    const links = [...new Set([...linkIds, ...steps.map(s => s.source).filter(s => s.startsWith('L'))])]
      .map(id => learn.find(l => l.id === id)).filter((l): l is typeof learn[number] => !!l)
      .slice(0, MAX_LINKS).map(({ title, url }) => ({ title, url }))
    const usedCards = [...new Set(steps.map(s => cards.find(c => c.ref === s.source)?.id).filter((id): id is string => !!id))]
    return {
      kind, microsoft, learnQuery, learn, cards, steps, links, usedCards, teamHints,
      inputTokens: usage.input, outputTokens: usage.output, promptVersion: PROMPT_VERSION,
    }
  }
  if (!kind.problem || !sources.length) return result()

  const out = parse((await call([...ctx, composeMessage(sources, microsoft, cfg.howTo !== false)], { maxTokens: cfg.howTo === false ? 700 : 1500, json: true })).text)
  if (out.aplicavel !== true || !Array.isArray(out.passos)) return result()
  const valid = new Set(sources.map(s => s.id))
  type Step = GuidanceResult['steps'][number]
  const steps: Step[] = out.passos
    .map((p: any): Step => ({
      text: typeof p?.texto === 'string' ? p.texto.trim().slice(0, 200) : '',
      how: (Array.isArray(p?.como) ? p.como : []).filter((h: unknown): h is string => typeof h === 'string' && !!h.trim())
        .map((h: string) => h.trim().slice(0, 300)).slice(0, MAX_HOW),
      source: String(p?.fonte ?? '').trim().toUpperCase(),
    }))
    // Passo sem fonte recebida, vazio, com rastro de chamado/dado mascarado, ação de administrador,
    // link de fora ou pedido de credencial é descartado.
    .filter((p: Step) => p.text && valid.has(p.source) && ![p.text, ...p.how].some(t => LEAK.test(t) || ADMIN.test(t) || unsafeForRequester(t)))
    .map((p: Step) => (cfg.howTo === false ? { ...p, how: [] } : p))
    .slice(0, Math.min(MAX_STEPS, cfg.maxSteps ?? MAX_STEPS))
  const linkIds = (Array.isArray(out.links) ? out.links : []).map((l: unknown) => String(l).trim().toUpperCase()).filter((l: string) => valid.has(l) && l.startsWith('L'))
  return steps.length ? result(steps, linkIds) : result()
}
