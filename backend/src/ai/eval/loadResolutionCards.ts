/**
 * Destila o histórico antigo (ai-data/historico_backlog.csv, LGPD, fora do git) em
 * cartões da base de resoluções (ai_examples, agent='resolution', source='backlog').
 * Só chamados sem ruído e com worklog útil. Idempotente (upsert por source_id).
 *
 *   npx tsx src/ai/eval/loadResolutionCards.ts [--limit N] [caminho do csv]
 *
 * Usa o banco do DATABASE_URL (.env → local 5435) e o Foundry do .env.
 */
import { readFileSync } from 'node:fs'
import prisma from '../../config/prisma'
import { upsertExamples, type ExampleInput } from '../core/examples'
import { AGENT, distill, toExample } from '../agents/resolution/distill'

/** CSV RFC 4180 mínimo: vírgula, aspas duplas, "" escapado e quebra de linha dentro de aspas. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [head, ...body] = rows
  return body.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

const BATCH = 30
const MIN_WORKLOG = 40

async function main() {
  const args = process.argv.slice(2)
  const li = args.indexOf('--limit')
  const limit = li >= 0 ? Number(args.splice(li, 2)[1]) : Infinity
  const file = args[0] ?? 'ai-data/historico_backlog.csv'
  const rows = parseCsv(readFileSync(file, 'utf8'))
    .filter(r => !r.ruido?.trim() && (r.worklog ?? '').trim().length >= MIN_WORKLOG && r.titulo?.trim())
    .slice(0, limit)
  console.log(`${rows.length} chamados do histórico com resolução útil em ${file}`)
  const stats = { cards: 0, selfService: 0, microsoft: 0, discarded: 0, errors: 0, inputTokens: 0, outputTokens: 0 }
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const out = await Promise.all(batch.map(async r => {
      try {
        const d = await distill({ title: r.titulo, description: '', resolution: r.worklog })
        stats.inputTokens += d.inputTokens
        stats.outputTokens += d.outputTokens
        if (!d.card) { stats.discarded++; return null }
        stats.cards++
        if (d.card.selfService) stats.selfService++
        if (d.card.product === 'microsoft') stats.microsoft++
        return toExample(r['Ticket ID'], r['Ticket ID'], d.card)
      } catch (err: any) {
        stats.errors++
        console.error(`  ${r['Ticket ID']}: ${err?.message ?? err}`)
        return null
      }
    }))
    const items = out.filter((x): x is ExampleInput => !!x)
    if (items.length) await upsertExamples(AGENT, 'backlog', items)
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length} — cartões ${stats.cards} (autoatendimento ${stats.selfService}), descartados ${stats.discarded}, erros ${stats.errors}`)
  }
  console.log(JSON.stringify(stats))
  console.log(`ai_examples (resolution): ${await prisma.aiExample.count({ where: { agent: AGENT } })}`)
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
