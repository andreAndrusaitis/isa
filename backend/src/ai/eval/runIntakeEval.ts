/**
 * Avaliação offline do agente intake com src/ai/eval/intake-casos.json.
 *   npx tsx src/ai/eval/runIntakeEval.ts [--limit N] [--concurrency 4]
 * Usa o checklist do banco do .env (local) e o Foundry de verdade. Não grava no banco.
 * Métricas: acerto da ação (skip/completo/perguntar), perguntas indevidas e cobertura do que falta.
 * O resultado por caso (com as decisões por item) vai para ai-data/eval/intake-<timestamp>.json (LGPD, fora do git).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { TicketType } from '@prisma/client'
import prisma from '../../config/prisma'
import { buildEvidence } from '../core/ticketEvidence'
import { loadChecklist } from '../agents/intake/checklist'
import { runIntake, type IntakeDecision } from '../agents/intake/intake'
import casos from './intake-casos.json'

type Acao = 'skip' | 'completo' | 'perguntar'
interface Caso {
  key: string; canal: string; solicitante: string; type: TicketType; title: string; description: string
  anexos: { name: string; type: string }[]
  esperado: { acao: Acao; faltam?: string[] }
}

const arg = (nome: string, padrao: number) => {
  const i = process.argv.indexOf(nome)
  return i > 0 ? Number(process.argv[i + 1]) : padrao
}

async function avaliar(c: Caso) {
  let acao: Acao
  let missing: string[] = []
  let tokens = 0
  let questions: Pick<IntakeDecision, 'key' | 'chosen' | 'confidence' | 'wouldApply'>[] = []
  if (c.solicitante !== 'user') acao = 'skip' // mesma regra do agent.ts, sem LLM
  else {
    const evidence = await buildEvidence({
      title: c.title, description: c.description, special_data: null, category: null, subcategory: null,
      attachments: c.anexos.map(a => ({ name: a.name, url: `eval/${a.name}` })),
    })
    const r = await runIntake(evidence, await loadChecklist(c.type, null))
    tokens = r.inputTokens + r.outputTokens
    missing = r.missing
    questions = r.questions.map(({ key, chosen, confidence, wouldApply }) => ({ key, chosen, confidence, wouldApply }))
    acao = r.skipped ? 'skip' : missing.length ? 'perguntar' : 'completo'
  }
  const faltam = c.esperado.faltam ?? []
  return {
    caso: c.key, esperado: c.esperado.acao, obtido: acao, ok: acao === c.esperado.acao,
    indevidas: missing.filter(k => !faltam.includes(k)).join(','),
    faltou_perguntar: faltam.filter(k => !missing.includes(k)).join(','),
    acertadas: missing.filter(k => faltam.includes(k)).length, faltam: faltam.length, tokens, questions,
  }
}

async function main() {
  const all = casos.casos as Caso[]
  const list = all.slice(0, arg('--limit', all.length))
  const conc = arg('--concurrency', 4)
  const rows: Awaited<ReturnType<typeof avaliar>>[] = new Array(list.length)
  let next = 0
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < list.length) { const i = next++; rows[i] = await avaliar(list[i]) }
  }))

  console.table(rows.map(({ acertadas, faltam, tokens, questions, ...r }) => r))
  const naoDevia = rows.filter(r => r.esperado !== 'perguntar')
  const devia = rows.filter(r => r.esperado === 'perguntar')
  const summary = {
    casos: rows.length,
    acerto_acao: rows.filter(r => r.ok).length / rows.length,
    perguntas_indevidas_em_completo_ou_skip: naoDevia.filter(r => r.obtido === 'perguntar').length,
    itens_indevidos_total: rows.reduce((s, r) => s + (r.indevidas ? r.indevidas.split(',').length : 0), 0),
    cobertura: devia.reduce((s, r) => s + r.acertadas, 0) / Math.max(1, devia.reduce((s, r) => s + r.faltam, 0)),
    tokens: rows.reduce((s, r) => s + r.tokens, 0),
  }
  console.log(summary)
  const out = path.resolve(__dirname, '../../../ai-data/eval', `intake-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2))
  console.log('Resultado em', out)
  console.log(summary.perguntas_indevidas_em_completo_ou_skip === 0 && summary.cobertura >= 0.8
    ? 'GATE OK para considerar apply' : 'GATE NÃO atingido: manter em shadow e ajustar critérios/limiares')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
