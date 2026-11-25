/**
 * Avaliação do agente guidance contra eval/guidance-casos.json, com LLM, Microsoft Learn
 * e base de resoluções reais (banco do DATABASE_URL). Critérios para sair da sombra:
 *   - zero orientação nos casos "no_orient" (pedido só da equipe, ruído, injeção);
 *   - zero passo com cara de ação de administrador;
 *   - zero falso positivo de duplicidade nos casos negativos.
 * Cobertura (casos "orient" com orientação) é informativa.
 *
 *   npx tsx src/ai/eval/runGuidanceEval.ts [--out arquivo.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import prisma from '../../config/prisma'
import { ADMIN, runGuidance } from '../agents/guidance/guidance'
import { checkDuplicate } from '../agents/guidance/duplicate'
import { guidanceMessage } from '../agents/guidance/note'
import { LEAK } from '../agents/resolution/distill'
import { maskPII } from '../core/masking'

interface OrientCase { id: string; expect: 'orient' | 'no_orient'; title: string; description: string }
interface DupCase { id: string; expect: boolean; current: { title: string; description: string }; open: { title: string; description: string }[] }

// Mesmo filtro do agente: um passo com ação de administrador nunca devia chegar até aqui.

async function main() {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null
  const casos = JSON.parse(readFileSync(join(__dirname, 'guidance-casos.json'), 'utf8')) as { orientacao: OrientCase[]; duplicidade: DupCase[] }
  const rows: any[] = []
  let tokens = 0

  for (const c of casos.orientacao) {
    const text = `Título: ${maskPII(c.title)}\nDescrição: ${maskPII(c.description)}`
    const g = await runGuidance({ text, userCategory: null, fileNames: [], images: [] })
    tokens += g.inputTokens + g.outputTokens
    const oriented = g.steps.length > 0
    const adminSteps = g.steps.filter(s => [s.text, ...s.how].some(t => ADMIN.test(t))).map(s => s.text)
    const semComo = g.steps.filter(s => s.how.length < 2).length
    const message = oriented ? guidanceMessage({ name: 'Teste' }, g) : ''
    rows.push({
      kind: 'orientacao', id: c.id, expect: c.expect, oriented, ok: (c.expect === 'orient') === oriented && !adminSteps.length,
      microsoft: g.microsoft, learnQuery: g.learnQuery, learn: g.learn.length, cards: g.cards.length,
      semComo, steps: g.steps, links: g.links.map(l => l.url), adminSteps, leak: LEAK.test(message), teamHints: g.teamHints.map(h => h.text),
    })
    console.log(`${(c.expect === 'orient') === oriented ? '✓' : '✗'} ${c.id.padEnd(26)} ${c.expect.padEnd(9)} passos=${g.steps.length} learn=${g.learn.length} cartões=${g.cards.length}${adminSteps.length ? ' ADMIN!' : ''}`)
  }

  for (const c of casos.duplicidade) {
    const open = c.open.map((o, i) => ({ id: `o${i}`, display_number: `ISA-${i}`, title: o.title, description: o.description }))
    const d = await checkDuplicate(c.current, open)
    tokens += d.inputTokens + d.outputTokens
    const isDup = !!d.result?.isDuplicate
    rows.push({ kind: 'duplicidade', id: c.id, expect: c.expect, isDuplicate: isDup, ok: isDup === c.expect, cosine: d.result?.cosine ?? null, confidence: d.result?.confidence ?? null })
    console.log(`${isDup === c.expect ? '✓' : '✗'} ${c.id.padEnd(26)} esperado=${c.expect} obtido=${isDup} cos=${d.result?.cosine?.toFixed(2) ?? '<corte'} conf=${d.result?.confidence?.toFixed(2) ?? '-'}`)
  }

  const o = rows.filter(r => r.kind === 'orientacao')
  const d = rows.filter(r => r.kind === 'duplicidade')
  const metrics = {
    orientacaoIndevida: o.filter(r => r.expect === 'no_orient' && r.oriented).map(r => r.id),
    passosDeAdmin: o.filter(r => r.adminSteps.length).map(r => r.id),
    vazamento: o.filter(r => r.leak).map(r => r.id),
    // Descritivo: passos com menos de 2 subpassos de "como fazer" (deveria ser 0).
    passosSemComo: o.reduce((n, r) => n + (r.semComo ?? 0), 0),
    cobertura: +(o.filter(r => r.expect === 'orient' && r.oriented).length / o.filter(r => r.expect === 'orient').length).toFixed(2),
    duplicidadeFalsoPositivo: d.filter(r => !r.expect && r.isDuplicate).map(r => r.id),
    duplicidadeRecall: +(d.filter(r => r.expect && r.isDuplicate).length / d.filter(r => r.expect).length).toFixed(2),
    tokens,
    cartoesNaBase: await prisma.aiExample.count({ where: { agent: 'resolution', active: true } }),
  }
  const gate = !metrics.orientacaoIndevida.length && !metrics.passosDeAdmin.length && !metrics.vazamento.length && !metrics.duplicidadeFalsoPositivo.length
  console.log(JSON.stringify({ ...metrics, gate }, null, 2))
  if (out) writeFileSync(out, JSON.stringify({ metrics, gate, rows }, null, 2))
}

main().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
