/**
 * Exemplos rotulados para RAG (few-shot por similaridade), comuns a todos os
 * agentes: tabela ai_examples, embeddings do Foundry e cosseno em memória.
 * Índice inteiro do agente em memória e varredura linear — serve até
 * alguns milhares de exemplos por agente. Acima disso: pgvector (vector(1536))
 * + índice HNSW e ORDER BY embedding <=> $1 no Postgres.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../../config/prisma'
import { embed as defaultEmbed, type EmbedFn } from './embeddings'

export interface Example { id: string; text: string; labels: Record<string, unknown>; score: number }
export interface ExampleInput { sourceId: string; text: string; labels: Record<string, unknown> }
interface Row { id: string; text: string; labels: Record<string, unknown>; embedding: ArrayLike<number> }

/**
 * Abaixo disso o "parecido" é ruído. Medido na base da triagem (títulos curtos de TI,
 * text-embedding-3-small): pares aleatórios mediana 0,33 / máx 0,50; top-5 de títulos
 * de teste ≥ 0,45, top-1 ≥ 0,53. Recalibrar quando entrarem chamados com descrição.
 */
export const MIN_SCORE = 0.45

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export function rank(query: ArrayLike<number>, rows: Row[], k: number, minScore: number): Example[] {
  return rows
    .map(r => ({ id: r.id, text: r.text, labels: r.labels, score: cosine(query, r.embedding) }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** Intervalo mínimo entre checagens do count de um agente (cache quente nem consulta o banco). */
const CHECK_MS = 30_000

// Cache por agente com single-flight: uma checagem/carga por agente por vez, e todas
// as triagens simultâneas aguardam a mesma promise (a carga são ~6 MB de embeddings
// e N cargas em rajada esgotavam o pool do Prisma). Recarga completa só quando o
// count muda. Limite: edição de texto/rótulo sem mudar o count (feita por outro
// processo) só aparece no restart; neste processo upsertExamples invalida o cache.
const cache = new Map<string, { count: number; checkedAt: number; rows: Row[] }>()
const inflight = new Map<string, Promise<Row[]>>()

/** Linhas por consulta na carga do índice. Cada página é desserializada pelo Prisma num
 *  bloco síncrono (~0,8 ms/linha com 1536 dims): 50 linhas ≈ 60 ms de trava, medido. */
export const LOAD_BATCH = 50

// Carga paginada por id, cedendo o event loop entre páginas: a carga única de ~1.200
// linhas travava o servidor por segundos. O índice novo é montado à parte e só entra
// no cache no fim; quem chega durante a recarga aguarda a mesma promise (single-flight),
// inclusive quando já havia índice antigo — mais simples que servir o antigo em paralelo,
// e a espera só afeta quem busca exemplos, não o resto do servidor.
async function loadRows(agent: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let after: string | undefined; ;) {
    const page = await prisma.aiExample.findMany({
      where: { agent, active: true, ...(after && { id: { gt: after } }) },
      select: { id: true, text: true, labels: true, embedding: true },
      orderBy: { id: 'asc' },
      take: LOAD_BATCH,
    })
    // Float32Array: metade da memória de number[] e precisão de sobra para o cosseno.
    for (const r of page) rows.push({ id: r.id, text: r.text, labels: r.labels as Record<string, unknown>, embedding: Float32Array.from(r.embedding) })
    if (page.length < LOAD_BATCH) return rows
    after = page[page.length - 1].id
    await new Promise(r => setImmediate(r))
  }
}

async function refresh(agent: string): Promise<Row[]> {
  // Só os ativos: o veto (active=false) muda o count e força a recarga.
  const count = await prisma.aiExample.count({ where: { agent, active: true } })
  const hit = cache.get(agent)
  const rows = hit && hit.count === count ? hit.rows : count === 0 ? [] : await loadRows(agent)
  cache.set(agent, { count, checkedAt: Date.now(), rows })
  return rows
}

function loadIndex(agent: string): Promise<Row[]> {
  const hit = cache.get(agent)
  if (hit && Date.now() - hit.checkedAt < CHECK_MS) return Promise.resolve(hit.rows)
  let p = inflight.get(agent)
  if (!p) {
    p = refresh(agent).finally(() => inflight.delete(agent))
    inflight.set(agent, p)
  }
  return p
}

/** Aquece o cache do agente (boot do servidor); devolve quantos exemplos há. */
export async function warmExamples(agent: string): Promise<number> {
  return (await loadIndex(agent)).length
}

export async function similarExamples(
  agent: string, text: string, k = 5, opts: { embed?: EmbedFn; minScore?: number } = {},
): Promise<Example[]> {
  const rows = await loadIndex(agent)
  if (!rows.length) return []
  const [query] = await (opts.embed ?? defaultEmbed)([text])
  return rank(query, rows, k, opts.minScore ?? MIN_SCORE)
}

/** Embeda e grava (ou atualiza) exemplos; chave = (agent, source, sourceId). */
export async function upsertExamples(
  agent: string, source: 'backlog' | 'ticket', items: ExampleInput[], embedFn: EmbedFn = defaultEmbed,
): Promise<number> {
  const vectors = await embedFn(items.map(i => i.text))
  await prisma.$transaction(items.map((item, i) => {
    const data = { text: item.text, labels: item.labels as Prisma.InputJsonValue, embedding: vectors[i] }
    return prisma.aiExample.upsert({
      where: { agent_source_source_id: { agent, source, source_id: item.sourceId } },
      create: { agent, source, source_id: item.sourceId, ...data },
      update: data,
    })
  }))
  cache.delete(agent)
  return items.length
}

/** Liga ou desliga um exemplo na busca (veto do analista / reativação no Motor IA); o cache recarrega. */
export async function setExampleActive(id: string, active: boolean): Promise<{ agent: string } | null> {
  const row = await prisma.aiExample.update({ where: { id }, data: { active }, select: { agent: true } }).catch(() => null)
  if (row) cache.delete(row.agent)
  return row
}

/** Veto do analista: o exemplo sai da busca. */
export const disableExample = (id: string) => setExampleActive(id, false)
