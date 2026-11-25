/**
 * Lacunas da base: o que as pessoas perguntaram e a IA não soube responder, ou respondeu
 * e ouviu "não útil". Agrupa por assunto para o admin ver o que vale virar artigo.
 * A pergunta já foi gravada mascarada; quem perguntou nunca sai daqui.
 */
import prisma from '../../config/prisma'
import { embed as defaultEmbed, type EmbedFn } from '../core/embeddings'
import { cosine } from '../core/examples'
import { aiConfigured } from '../core/llm'

/** Teto de interações analisadas por consulta: limita o custo de embedding e o laço O(n·grupos). */
export const MAX_GAP_INTERACTIONS = 500
const GAPS_RETURNED = 10
const MAX_TITLE_CHARS = 200 // mesmo teto do título do artigo

/**
 * Cosseno mínimo para duas perguntas serem o mesmo assunto.
 * Valor inicial sem calibração; acima do MIN_SIMILARITY da busca porque aqui
 * as duas pontas são perguntas, não pergunta e trecho.
 */
const SAME_SUBJECT_SIMILARITY = 0.75
const EMBED_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 5 * 60_000

export interface KnowledgeGap { example: string; title: string; count: number; last_at: Date }
export interface KnowledgeGaps { days: number; gaps: KnowledgeGap[]; analyzed: number; truncated: boolean; grouped_by: 'subject' | 'text' }
export interface GapsDeps { embed?: EmbedFn; limit?: number; similarity?: number }

type Row = { question: string; created_at: Date }
type Group = { example: string; count: number; last_at: Date }

const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const firstLine = (text: string) => (text.split('\n').map(l => l.trim()).find(Boolean) ?? '').slice(0, MAX_TITLE_CHARS).trim()

/**
 * Falha do provedor também grava a interação sem resposta, mas só a execução ok carrega
 * o id dela: sem essa execução, a pergunta não ficou sem resposta por falta de artigo.
 */
function unanswered(since: Date, take: number) {
  return prisma.$queryRaw<Row[]>`
    SELECT i.question, i.created_at
    FROM ai_interactions i
    WHERE i.created_at >= ${since}
      AND (i.feedback = 'not_useful' OR (i.answer IS NULL AND i.id IN (
        SELECT r.result->>'interactionId' FROM ai_agent_runs r
        WHERE r.agent = 'knowledge' AND r.status = 'ok' AND r.created_at >= ${since})))
    ORDER BY i.created_at DESC
    LIMIT ${take}`
}

/** Texto igual a menos de caixa, acento e pontuação: já é o agrupamento de quando não há IA. */
function byText(rows: Row[]): Group[] {
  const groups = new Map<string, Group>()
  for (const r of rows) {
    const key = normalize(r.question) || r.question
    const g = groups.get(key)
    if (!g) groups.set(key, { example: r.question, count: 1, last_at: r.created_at })
    else {
      g.count++
      if (r.created_at > g.last_at) g.last_at = r.created_at
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

/** Guloso: cada grupo entra no primeiro assunto parecido o bastante com o líder, ou abre um novo. */
function bySubject(groups: Group[], vectors: number[][], similarity: number): Group[] {
  const subjects: { leader: number[]; group: Group }[] = []
  groups.forEach((g, i) => {
    const same = subjects.find(s => cosine(s.leader, vectors[i]) >= similarity)
    if (!same) {
      subjects.push({ leader: vectors[i], group: { ...g } })
      return
    }
    same.group.count += g.count
    if (g.last_at > same.group.last_at) same.group.last_at = g.last_at
  })
  return subjects.map(s => s.group)
}

async function compute(days: number, deps: GapsDeps): Promise<KnowledgeGaps> {
  const limit = deps.limit ?? MAX_GAP_INTERACTIONS
  const found = await unanswered(new Date(Date.now() - days * 864e5), limit + 1)
  const rows = found.slice(0, limit)
  let groups = byText(rows)
  let grouped_by: KnowledgeGaps['grouped_by'] = 'text'

  const embed = deps.embed ?? (aiConfigured() ? defaultEmbed : null)
  if (embed && groups.length) {
    try {
      const vectors = await embed(groups.map(g => g.example), { timeoutMs: EMBED_TIMEOUT_MS })
      groups = bySubject(groups, vectors, deps.similarity ?? SAME_SUBJECT_SIMILARITY)
      grouped_by = 'subject'
    } catch (err: any) {
      console.error('[AI:knowledge] lacunas sem embedding, agrupando por texto:', err?.message ?? err)
    }
  }

  const top = groups.sort((a, b) => b.count - a.count || b.last_at.getTime() - a.last_at.getTime()).slice(0, GAPS_RETURNED)
  return {
    days, grouped_by, analyzed: rows.length, truncated: found.length > limit,
    gaps: top.map(g => ({ example: g.example, title: firstLine(g.example), count: g.count, last_at: g.last_at })),
  }
}

const cache = new Map<number, { at: number; value: Promise<KnowledgeGaps> }>()

export function clearGapsCache() {
  cache.clear()
}

/** Cada consulta custa embeddings: a promessa fica guardada, e duas abas abertas pagam uma vez só. */
export function knowledgeGaps(days: number, deps: GapsDeps = {}): Promise<KnowledgeGaps> {
  const hit = cache.get(days)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = compute(days, deps)
  cache.set(days, { at: Date.now(), value })
  // Agrupamento só por texto é o plano B de uma falha: não guarda, a próxima consulta tenta de novo.
  value.then(v => { if (v.grouped_by === 'text') cache.delete(days) }, () => cache.delete(days))
  return value
}
