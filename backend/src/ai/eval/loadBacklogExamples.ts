/**
 * Carrega a base antiga rotulada (ai-data/rotulados.json, LGPD, fora do git)
 * como exemplos de RAG da triagem. Só split 'train': val/test ficam para a
 * avaliação, sem vazamento. Idempotente (upsert por agent+source+source_id).
 *
 *   npx tsx src/ai/eval/loadBacklogExamples.ts [caminho do rotulados.json]
 *
 * Usa o banco do DATABASE_URL (.env → local 5435).
 */
import { readFileSync } from 'node:fs'
import prisma from '../../config/prisma'
import { maskPII } from '../core/masking'
import { upsertExamples } from '../core/examples'

interface Labeled {
  id: string; title: string; type: string | null; tema: string
  urgency: string; impact: string; split: 'train' | 'val' | 'test'
}

const BATCH = 100

async function main() {
  const file = process.argv[2] ?? 'ai-data/rotulados.json'
  const train = (JSON.parse(readFileSync(file, 'utf8')) as Labeled[]).filter(r => r.split === 'train' && r.title?.trim())
  console.log(`${train.length} exemplos de treino em ${file}`)
  for (let i = 0; i < train.length; i += BATCH) {
    await upsertExamples('triage', 'backlog', train.slice(i, i + BATCH).map(r => ({
      sourceId: r.id,
      text: maskPII(r.title.trim()),
      labels: { type: r.type, urgency: r.urgency, impact: r.impact, tema: r.tema },
    })))
    console.log(`  ${Math.min(i + BATCH, train.length)}/${train.length}`)
  }
  console.log(`ai_examples (triage): ${await prisma.aiExample.count({ where: { agent: 'triage' } })}`)
}

main().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
