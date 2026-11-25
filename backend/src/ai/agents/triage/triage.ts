/**
 * Agente de triagem: uma pergunta de múltipla escolha por campo (motor de
 * confiança do core), depois uma chamada de justificativa que cita a evidência
 * de cada resposta. As perguntas chegam prontas: do banco em produção, de uma
 * lista fixa na avaliação offline.
 */
import type { Example } from '../../core/examples'
import { chat as llmChat, type ChatFn } from '../../core/llm'
import type { Evidence } from '../../core/ticketEvidence'
import { askChoice, evidenceIsValid, confidenceOf, wouldApply, type Combined, type Option, type Thresholds, withRigor, type Rigor } from '../../core/choice'
import { askGate, gateOf, type GateReading } from '../../core/gate'
import { NONE_VALUE, subcategoryQuestion, priorityFrom, type Level, type TriageKey, type TriageQuestion } from './options'
import type { FieldChange } from './apply'
import { contextMessages, justificationMessages, parseJustification, PROMPT_VERSION, PROMPT_VERSION_RAG } from './prompt'

// Limiares calibrados pela avaliação offline (eval/runEval.ts): menor limiar com acerto ≥ ~95% na cobertura. Urgência/impacto
// só com título não chegam a 95%: por isso 0,9, e prioridade = mín(urgência, impacto).
// Categoria/subcategoria: 0,95: a IA só troca com
// certeza alta; abaixo disso vira sugestão com botão para o analista (apply.ts).
export const THRESHOLDS: Record<TriageKey | 'priority', Thresholds> = {
  type:        { minConfidence: 0.95, minMargin: 0.3 },
  category:    { minConfidence: 0.95, minMargin: 0.3 },
  subcategory: { minConfidence: 0.95, minMargin: 0.3 },
  urgency:     { minConfidence: 0.9,  minMargin: 0.2 },
  impact:      { minConfidence: 0.9,  minMargin: 0.2 },
  priority:    { minConfidence: 0.9,  minMargin: 0 },
}
/** Trocar a categoria que o cliente escolheu exige 95% mesmo no rigor Ousado (que baixa o limiar acima). */
export const CATEGORY_OVERRIDE_CONFIDENCE = 0.95
/** Abaixo do limiar, categoria/subcategoria com ao menos esta confiança viram sugestão; abaixo disto, só "Revisar". */
export const SUGGEST_MIN_CONFIDENCE = 0.5
/** Categoria "firme" para decidir onde perguntar a subcategoria: o limiar calibrado no eval, não o de aplicar. */
const FIRM_CATEGORY: Thresholds = { minConfidence: 0.85, minMargin: 0.3 }
/** Abaixo disto o chamado não diz o suficiente ("ajuda por favor"): a triagem anota, não altera. */
export const MIN_WORDS_TO_APPLY = 6

export interface QuestionResult {
  key: TriageKey
  options: { value: string; label: string }[]
  probs: number[]
  chosen: string
  chosenLabel: string
  probability: number
  margin: number
  roundsAgree: boolean
  evidence: string | null
  evidenceSource: 'texto' | 'anexo' | null
  evidenceValid: boolean
  confidence: number
  wouldApply: boolean
  /** Categoria decidida pela subcategoria unânime (a categoria sozinha divergiu ou hesitou). */
  derivedFromSubcategory?: boolean
}

export interface TriageResult {
  questions: QuestionResult[]
  priority: { value: Level; confidence: number; wouldApply: boolean }
  justification: string
  inputTokens: number
  outputTokens: number
  /** Versão efetiva do prompt (triage-v2-rag quando houve exemplos). Opcional só para fixtures antigas. */
  promptVersion?: string
  /** Quantos chamados parecidos entraram no contexto. */
  ragExamples?: number
  /** Ids dos exemplos do RAG usados (ai_examples). */
  ragExampleIds?: string[]
  /** Entrada vista pela IA (texto já mascarado) e configuração da execução; gravados pelo agente. */
  input?: { text: string; images: number; userCategory: string | null }
  config?: { rigor: Rigor | undefined; applyFields: string[]; useExamples: boolean }
  /** Texto curto demais para decidir: nada é aplicado (só a nota). */
  lowInformation?: boolean
  /** Portão do chamado, lido aqui uma vez e reusado por completude e orientação. Opcional só para fixtures antigas. */
  gate?: GateReading
  /** Modo apply: alterações gravadas no chamado (vazio = nada mudou). */
  applied?: FieldChange[]
  /** Modo sombra: o que a triagem mudaria se estivesse no modo apply. */
  proposed?: FieldChange[]
  applyError?: string
}

export interface TriageDeps {
  /** Subcategorias da categoria escolhida; sem isso a subcategoria não é perguntada. */
  subcategoryOptions?: (categoryValue: string) => Promise<Option[]>
  chat?: ChatFn
  /** Chamados parecidos já classificados (RAG); falha aqui cai para triagem sem exemplos. */
  examples?: (e: Evidence) => Promise<Example[]>
  /** Rigor escolhido no Motor IA (desloca os limiares de THRESHOLDS). */
  rigor?: Rigor
}

/** Só estas perguntas veem os exemplos: o tema da base antiga não é a categoria do banco. */
const RAG_KEYS = new Set<TriageKey>(['type', 'urgency', 'impact'])

interface Asked { q: TriageQuestion; combined: Combined }

/** Palavras do chamado, sem os rótulos que a evidência acrescenta. */
const wordCount = (text: string) =>
  text.replace(/^(Título|Descrição):/gm, ' ').split(/\s+/).filter(w => /\p{L}{2,}/u.test(w)).length

export async function runTriage(e: Evidence, questions: TriageQuestion[], deps: TriageDeps = {}): Promise<TriageResult> {
  const chatFn = deps.chat ?? llmChat
  const T = (k: keyof typeof THRESHOLDS) => withRigor(THRESHOLDS[k], deps.rigor)
  const usage = { input: 0, output: 0 }
  const call: ChatFn = async (m, o) => {
    const r = await chatFn(m, o)
    usage.input += r.inputTokens
    usage.output += r.outputTokens
    return r
  }
  const examples = deps.examples
    ? await deps.examples(e).catch(err => { console.warn('[AI:triage] RAG falhou, seguindo sem exemplos:', err?.message ?? err); return [] })
    : []
  const ask = async (q: TriageQuestion): Promise<Asked> =>
    ({ q, combined: await askChoice(contextMessages(e, !q.blind, RAG_KEYS.has(q.key) ? examples : []), q, call) })

  // Portão em paralelo com as perguntas: não atrasa a triagem.
  const [asked, gate] = await Promise.all([Promise.all(questions.map(ask)), askGate(contextMessages(e, false), call, deps.rigor)])
  const category = asked.find(a => a.q.key === 'category')
  // Índice da categoria deduzida pela subcategoria (quando as rodadas da categoria divergem).
  let derived: number | null = null
  if (category && deps.subcategoryOptions) {
    const { q: cq, combined: cc } = category
    const isReal = (i: number) => cq.options[i].value !== NONE_VALUE
    // Categoria firme (rodadas de acordo e acima do limiar): só a escolhida. Divergindo ou
    // hesitante (ex. Acessos × E-mail para uma conta bloqueada), pergunta a subcategoria dentro
    // das 2 categorias reais mais prováveis.
    let firm = cc.roundsAgree && cc.probability >= withRigor(FIRM_CATEGORY, deps.rigor).minConfidence
    const ranked = cc.probs.map((p, i) => ({ p, i })).filter(x => isReal(x.i)).sort((a, b) => b.p - a.p)
    const trySubs = async (cats: number[]) => (await Promise.all(cats.map(async catIdx => {
      const opts = await deps.subcategoryOptions!(cq.options[catIdx].value)
      return opts.length ? { catIdx, sub: await ask(subcategoryQuestion(opts)) } : null
    }))).filter(t => t !== null)
    const subIs = (t: { sub: Asked }, none: boolean) =>
      t.sub.combined.roundsAgree && (t.sub.q.options[t.sub.combined.chosen].value === NONE_VALUE) === none

    let tried = await trySubs(firm
      ? [cc.chosen].filter(isReal)
      : ranked.filter(x => x.p >= 0.2).slice(0, 2).map(x => x.i))
    // Categoria firme em que nenhuma subcategoria encaixa ("Nenhuma" unânime, ex. conta
    // bloqueada → Segurança): tenta a 2ª categoria mais provável (ex. Acessos > Senha e login).
    if (firm && tried.length === 1 && subIs(tried[0], true)) {
      const second = ranked.find(x => x.i !== cc.chosen)
      if (second) {
        tried = [...tried, ...await trySubs([second.i])]
        firm = false
      }
    }
    // Subcategoria unânime e diferente de "Nenhuma" (que está sempre entre as opções) prova a categoria.
    const solid = tried.filter(t => subIs(t, false))
    const pick = firm ? tried[0]
      : solid.length === 1 ? solid[0]
      : tried.find(t => t.catIdx === cc.chosen)
    if (pick) {
      asked.push(pick.sub)
      if (!firm && solid.length === 1) derived = pick.catIdx
    }
  }

  const answers = asked.map(a => ({
    key: a.q.key, question: a.q.prompt,
    answer: a.q.options[a.q.key === 'category' && derived !== null ? derived : a.combined.chosen].label,
  }))
  const just = parseJustification((await call(justificationMessages(e, answers), { maxTokens: 400, json: true })).text)

  const evidenceOf = (key: string) => {
    const ev = just.evidencias[key] ?? {}
    const source = ev.fonte === 'anexo' ? 'anexo' as const : ev.trecho ? 'texto' as const : null
    const valid = source === 'anexo' ? e.images.length > 0 : evidenceIsValid(ev.trecho, e.text)
    return { trecho: ev.trecho, source, valid }
  }
  const subcategory = asked.find(a => a.q.key === 'subcategory')

  const results = asked.map(({ q, combined }): QuestionResult => {
    let ev = evidenceOf(q.key)
    // A categoria muitas vezes vem citada pelo nome da opção ("Rede e VPN"), que não
    // está no texto; a evidência válida da subcategoria escolhida também prova a categoria.
    if (q.key === 'category' && !ev.valid && subcategory
      && subcategory.q.options[subcategory.combined.chosen].value !== NONE_VALUE) {
      const sub = evidenceOf('subcategory')
      if (sub.valid) ev = sub
    }
    const source = ev.source
    const evidenceValid = q.options.length === 1 || ev.valid
    const confidence = confidenceOf(combined, evidenceValid)
    const chosen = q.options[combined.chosen]
    return {
      key: q.key,
      options: q.options.map(o => ({ value: o.value, label: o.label })),
      probs: combined.probs,
      chosen: chosen.value,
      chosenLabel: chosen.label,
      probability: combined.probability,
      margin: combined.margin,
      roundsAgree: combined.roundsAgree,
      evidence: ev.trecho ?? null,
      evidenceSource: source,
      evidenceValid,
      confidence,
      wouldApply: wouldApply(confidence, combined.margin, T(q.key)),
    }
  })

  if (derived !== null) {
    const cat = results.find(r => r.key === 'category')!
    const sub = results.find(r => r.key === 'subcategory')!
    const opt = category!.q.options[derived]
    Object.assign(cat, {
      chosen: opt.value, chosenLabel: opt.label, probability: category!.combined.probs[derived],
      evidence: sub.evidence, evidenceSource: sub.evidenceSource, evidenceValid: sub.evidenceValid,
      confidence: sub.confidence, derivedFromSubcategory: true,
      wouldApply: wouldApply(sub.confidence, sub.margin, T('category')),
    })
  }

  const urgency = results.find(q => q.key === 'urgency')!
  const impact = results.find(q => q.key === 'impact')!
  const priorityConfidence = Math.min(urgency.confidence, impact.confidence)
  return {
    questions: results,
    priority: {
      value: priorityFrom(urgency.chosen as Level, impact.chosen as Level),
      confidence: priorityConfidence,
      wouldApply: wouldApply(priorityConfidence, 1, T('priority')),
    },
    justification: just.justificativa,
    inputTokens: usage.input,
    outputTokens: usage.output,
    promptVersion: examples.length ? PROMPT_VERSION_RAG : PROMPT_VERSION,
    ragExamples: examples.length,
    ragExampleIds: examples.map(x => x.id),
    lowInformation: wordCount(e.text) < MIN_WORDS_TO_APPLY,
    gate,
  }
}

/** Teste ou resposta/agradecimento (portão confiante): como o texto curto, a nota registra a leitura e nada é aplicado. */
export function heldByGate(r: Pick<TriageResult, 'gate'>): 'test' | 'reply' | null {
  const g = gateOf(r.gate)
  return g === 'test' || g === 'reply' ? g : null
}
