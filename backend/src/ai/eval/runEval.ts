/**
 * Avaliação offline da triagem (linha de base, sem RAG). Não consulta o banco.
 *   npx tsx src/ai/eval/runEval.ts <arquivo.json> [--split test] [--limit N] [--concurrency 6] [--out caminho] [--rag]
 * Os dados (ai-data/) são reais/LGPD e ficam fora do git; o resultado por item vai
 * para ai-data/eval/<nome>-<timestamp>.json.
 */
import { similarExamples } from '../core/examples'
import fs from 'node:fs'
import path from 'node:path'
import { chat as llmChat, type ChatFn } from '../core/llm'
import type { Option } from '../core/choice'
import { buildEvidence } from '../core/ticketEvidence'
import { buildQuestions, TYPE_OPTIONS, type TriageKey } from '../agents/triage/options'
import { runTriage, type TriageDeps } from '../agents/triage/triage'
import { accuracy, brier, ece, percentile, riskCoverage, type Sample } from './metrics'
import temas from './temas.json'

export interface EvalItem {
  id: string
  title: string
  description?: string | null
  type: string | null
  tema: string | null
  urgency: string | null
  impact: string | null
  hard?: boolean
  split?: string
}

export interface ItemAnswer {
  expected: string | null
  chosen: string
  confidence: number
  probability: number
  margin: number
  roundsAgree: boolean
  evidenceValid: boolean
  correct: boolean | null
}

export interface ItemResult {
  id: string
  title: string
  hard: boolean
  latencyMs: number
  inputTokens: number
  outputTokens: number
  answers: Partial<Record<TriageKey, ItemAnswer>>
}

export interface EvalOptions {
  concurrency?: number
  deps?: Partial<TriageDeps>
  onProgress?: (done: number, total: number) => void
}

export interface EvalRun {
  results: ItemResult[]
  errors: { id: string; error: string }[]
}

const KEYS = ['type', 'category', 'urgency', 'impact'] as const

export const CATEGORY_OPTIONS: Option[] = Object.entries(temas as Record<string, { name: string; description: string }>)
  .map(([value, t]) => ({ value, label: t.name, description: t.description }))
const CATEGORY_VALUES = new Set(CATEGORY_OPTIONS.map(o => o.value))

/** Tema fora da lista (indefinido/outros) não tem resposta certa: não entra na conta. */
const expectedOf = (it: EvalItem, key: (typeof KEYS)[number]) =>
  key === 'category' ? (it.tema && CATEGORY_VALUES.has(it.tema) ? it.tema : null) : it[key]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Repete só a chamada que levou 429 (2s, 4s, 8s… até 5 tentativas). */
export function withRetry(call: ChatFn, attempts = 5): ChatFn {
  return async (m, o) => {
    for (let i = 0; ; i++) {
      try {
        return await call(m, o)
      } catch (err) {
        if (i >= attempts - 1 || !String((err as Error).message).startsWith('LLM 429')) throw err
        await sleep(2000 * 2 ** i)
      }
    }
  }
}

async function evaluateOne(it: EvalItem, deps: TriageDeps): Promise<ItemResult> {
  const evidence = await buildEvidence({
    title: it.title, description: it.description ?? null, special_data: null, category: null, subcategory: null, attachments: [],
  })
  const t0 = Date.now()
  const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORY_OPTIONS), deps)
  const answers: ItemResult['answers'] = {}
  for (const q of r.questions) {
    if (!(KEYS as readonly string[]).includes(q.key)) continue
    const expected = expectedOf(it, q.key as (typeof KEYS)[number])
    answers[q.key] = {
      expected,
      chosen: q.chosen,
      confidence: q.confidence,
      probability: q.probability,
      margin: q.margin,
      roundsAgree: q.roundsAgree,
      evidenceValid: q.evidenceValid,
      correct: expected === null ? null : q.chosen === expected,
    }
  }
  return {
    id: it.id, title: it.title, hard: !!it.hard, latencyMs: Date.now() - t0,
    inputTokens: r.inputTokens, outputTokens: r.outputTokens, answers,
  }
}

export async function evaluate(items: EvalItem[], opts: EvalOptions = {}): Promise<EvalRun> {
  const deps: TriageDeps = { ...opts.deps, chat: withRetry(opts.deps?.chat ?? llmChat) }
  const results: ItemResult[] = []
  const errors: EvalRun['errors'] = []
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++]
      try {
        results.push(await evaluateOne(it, deps))
      } catch (err) {
        errors.push({ id: it.id, error: String((err as Error).message ?? err).slice(0, 200) })
      }
      opts.onProgress?.(results.length + errors.length, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 6) }, worker))
  return { results, errors }
}

// ---------- relatório no console ----------

// gpt-4.1-mini DataZone, US$ por 1M tokens.
const PRICE_IN = 0.44
const PRICE_OUT = 1.76

const pct = (x: number) => (Number.isNaN(x) ? '   — ' : `${(x * 100).toFixed(1).padStart(5)}%`)

/**
 * conf = confiança de produção (zera sem concordância das rodadas ou sem evidência válida);
 * agree = só o gate das rodadas (sem o de evidência); prob = probabilidade crua.
 */
type Measure = 'conf' | 'agree' | 'prob'
const measureOf = (a: ItemAnswer, by: Measure) =>
  by === 'conf' ? a.confidence : by === 'prob' ? a.probability : a.roundsAgree ? a.probability : 0

function samplesOf(results: ItemResult[], key: TriageKey, by: Measure): Sample[] {
  return results.flatMap(r => {
    const a = r.answers[key]
    return a && a.correct !== null ? [{ confidence: measureOf(a, by), correct: a.correct }] : []
  })
}

export function report(run: EvalRun): string {
  const { results, errors } = run
  const out: string[] = []
  out.push(`Itens avaliados: ${results.length} | erros: ${errors.length}`)
  for (const key of KEYS) {
    const prob = samplesOf(results, key, 'prob')
    const answered = results.map(r => r.answers[key]).filter(a => a && a.correct !== null) as ItemAnswer[]
    const hard = samplesOf(results.filter(r => r.hard), key, 'prob')
    out.push('')
    out.push(`== ${key}: n=${prob.length}  acerto=${pct(accuracy(prob))}  ECE=${ece(prob).toFixed(3)}  Brier=${brier(prob).toFixed(3)}` +
      `  rodadas concordam=${pct(answered.filter(a => a.roundsAgree).length / answered.length)}` +
      `  evidência válida=${pct(answered.filter(a => a.evidenceValid).length / answered.length)}` +
      (hard.length ? `  | hard: n=${hard.length} acerto=${pct(accuracy(hard))}` : ''))
    out.push('   limiar |   conf: cob   acerto |  agree: cob   acerto |   prob: cob   acerto')
    const tables = (['conf', 'agree', 'prob'] as const).map(m => riskCoverage(samplesOf(results, key, m)))
    tables[0].forEach((row, i) => out.push(`   ${row.threshold.toFixed(2).padStart(6)} |` +
      tables.map(t => `  ${pct(t[i].coverage).padStart(10)} ${pct(t[i].accuracy).padStart(8)} `).join('|')))
    const confusions = new Map<string, number>()
    for (const a of answered) if (!a.correct) confusions.set(`${a.expected} → ${a.chosen}`, (confusions.get(`${a.expected} → ${a.chosen}`) ?? 0) + 1)
    const top = [...confusions].sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (top.length) out.push(`   confusões (esperado → escolhido): ${top.map(([k, n]) => `${k} ×${n}`).join('; ')}`)
  }
  const lat = results.map(r => r.latencyMs)
  const tin = results.reduce((s, r) => s + r.inputTokens, 0) / (results.length || 1)
  const tout = results.reduce((s, r) => s + r.outputTokens, 0) / (results.length || 1)
  const cost = (tin * PRICE_IN + tout * PRICE_OUT) / 1e6
  out.push('')
  out.push(`Latência por chamado: p50=${(percentile(lat, 50) / 1000).toFixed(2)}s  p95=${(percentile(lat, 95) / 1000).toFixed(2)}s`)
  out.push(`Tokens médios por chamado: entrada=${tin.toFixed(0)} saída=${tout.toFixed(1)}  custo≈US$${cost.toFixed(5)}/chamado` +
    `  (US$${(cost * 1000).toFixed(2)}/mil; total desta execução US$${(cost * results.length).toFixed(3)})`)
  if (errors.length) {
    out.push('')
    out.push('Erros:')
    errors.slice(0, 40).forEach(e => out.push(`   ${e.id}: ${e.error}`))
    if (errors.length > 40) out.push(`   … mais ${errors.length - 40}`)
  }
  return out.join('\n')
}

// ---------- CLI ----------

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const argv = process.argv.slice(2)
  const file = argv[0]
  if (!file || file.startsWith('--')) {
    console.error('uso: npx tsx src/ai/eval/runEval.ts <arquivo.json> [--split test] [--limit N] [--concurrency 6] [--out caminho]')
    process.exit(1)
  }
  const split = arg(argv, 'split')
  const limit = Number(arg(argv, 'limit') ?? Infinity)
  const concurrency = Number(arg(argv, 'concurrency') ?? 6)
  // --rag: exemplos parecidos de ai_examples (banco do .env; só split train foi carregado — sem vazamento).
  const rag = argv.includes('--rag')
  let items: EvalItem[] = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (split) items = items.filter(i => i.split === split)
  items = items.slice(0, limit)

  const name = path.basename(file, '.json') + (split ? `-${split}` : '') + (rag ? '-rag' : '')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outFile = arg(argv, 'out') ?? path.resolve(__dirname, '../../../ai-data/eval', `${name}-${stamp}.json`)

  console.log(`Avaliando ${items.length} itens de ${file} (concorrência ${concurrency}${rag ? ', com RAG' : ''})…`)
  const started = Date.now()
  const run = await evaluate(items, {
    concurrency,
    ...(rag ? { deps: { examples: e => similarExamples('triage', e.text) } } : {}),
    onProgress: (done, total) => { if (done % 20 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`) },
  })
  console.log(report(run))
  console.log(`Tempo total: ${((Date.now() - started) / 1000).toFixed(0)}s`)

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify({ file, split: split ?? null, createdAt: new Date().toISOString(), ...run }, null, 2))
  console.log(`Resultados por item: ${outFile}`)
}

if (require.main === module) {
  main().then(() => process.exit(0), err => { console.error(err); process.exit(1) })
}
