/**
 * Central "Motor IA" do Admin — leitura de ai_agent_runs e o modo de cada agente (ai_agent_settings).
 * GET /api/ai/status   saúde: LLM configurado, modelo e agentes do registry com contagens
 * GET /api/ai/runs     feed paginado de execuções (decisões) com o chamado e as alterações já achatadas
 * GET /api/ai/metrics  agregados: execuções, erros, latência p50/p95, tokens, custo, % aplicaria por campo,
 *                      alterações por campo e transições mais comuns
 * GET /api/ai/feedback correções humanas de campos decididos pela IA (ai_feedback), com os nomes de categoria/subcategoria
 * GET /api/ai/changes  catálogo do que a IA mudou (applied) ou mudaria (proposed): uma linha por campo
 * PUT /api/ai/agents/:key/mode  liga, desliga ou põe em sombra um agente (off | shadow | apply); vale na hora
 * PUT /api/ai/agents/:key/config  configurações do agente (declaradas no registry); vale na hora
 */
import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { aiProvider } from './core/provider'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { AppError } from '../middlewares/errorHandler'
import { aiConfigured } from './core/llm'
import { AGENTS, AGENT_MODES, agentMode, agentRuntime, checkLoadedOptions, describeSettings, setAgentConfig, setAgentMode, validateConfigInput } from './agents/registry'
import { createAuditLog } from '../services/audit'
import type { FieldChange } from './agents/triage/apply'
import { withValueLabels } from './agents/triage/feedback'

// Preço único do gpt-4.1-mini (US$/1M tokens); tabela por modelo quando houver outro deployment.
export const PRICE_PER_M = { input: 0.44, output: 1.76 }

const HOUR = 3600_000
const KINDS = ['applied', 'proposed'] as const
type ChangeKind = typeof KINDS[number]

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/** result.applied/proposed (FieldChange[]) de uma execução, achatado em snake_case; execução antiga = []. */
export function runChanges(result: unknown) {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  return KINDS.flatMap(kind => (Array.isArray(r[kind]) ? r[kind] as FieldChange[] : []).map(c => ({
    kind, field: c.field, label: c.label, from: c.from ?? null, from_label: c.fromLabel,
    to: c.to, to_label: c.toLabel, confidence: c.confidence,
    rule: c.rule?.name ?? null, reason: c.reason ?? null,
  })))
}

// Uma linha por FieldChange de result.applied e result.proposed (x.kind, x.c, x.ord); sem os campos = zero linhas.
// Achata o JSON a cada consulta (varre as execuções do filtro); tabela ai_field_changes
// gravada junto da execução se o volume deixar /changes e /metrics lentos.
const CHANGES_LATERAL = Prisma.sql`CROSS JOIN LATERAL (
  SELECT k.kind, e.c, e.ord::int AS ord
  FROM (VALUES ('applied'), ('proposed')) k(kind)
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.result->k.kind) = 'array' THEN r.result->k.kind ELSE '[]'::jsonb END)
    WITH ORDINALITY e(c, ord)
) x`

export async function getStatus() {
  const now = Date.now()
  const counts = await prisma.$queryRaw<{ agent: string; runs_24h: number; runs_7d: number; errors_24h: number; last_run_at: Date | null }[]>`
    SELECT agent,
      count(*) FILTER (WHERE created_at >= ${new Date(now - 24 * HOUR)})::int AS runs_24h,
      count(*) FILTER (WHERE created_at >= ${new Date(now - 7 * 24 * HOUR)})::int AS runs_7d,
      count(*) FILTER (WHERE status = 'error' AND created_at >= ${new Date(now - 24 * HOUR)})::int AS errors_24h,
      max(created_at) AS last_run_at
    FROM ai_agent_runs GROUP BY agent`
  const configured = aiConfigured()
  return {
    configured,
    model: aiProvider().chatModel,
    agents: await Promise.all(AGENTS.map(async a => {
      const c = counts.find(r => r.agent === a.key)
      const { mode, config } = await agentRuntime(a.key)
      return {
        key: a.key, name: a.name, description: a.description, mode,
        // Declaração das configurações (a tela monta o formulário) e os valores vigentes.
        settings: await describeSettings(a, config),
        config,
        active: configured && mode !== 'off',
        runs_24h: c?.runs_24h ?? 0, runs_7d: c?.runs_7d ?? 0, errors_24h: c?.errors_24h ?? 0,
        last_run_at: c?.last_run_at ?? null,
      }
    })),
  }
}

export async function listRuns(q: { agent?: string; status?: string; limit?: number; cursor?: string }) {
  const limit = Math.min(Math.max(q.limit || 20, 1), 100)
  const rows = await prisma.aiAgentRun.findMany({
    where: { ...(q.agent ? { agent: q.agent } : {}), ...(q.status ? { status: q.status } : {}) },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: { ticket: { select: { id: true, display_number: true, title: true } } },
  })
  const page = rows.slice(0, limit)
  return {
    data: page.map(r => ({
      ...r,
      changes: runChanges(r.result),
      apply_error: str((r.result as Record<string, unknown> | null)?.applyError) ?? null,
    })),
    next_cursor: rows.length > limit ? page[page.length - 1].id : null,
  }
}

/** Cursor de /changes: `${run_id}~${kind}~${ord}` (posição da última linha na ordenação). */
function parseChangeCursor(c: string) {
  const [id, kind, ord] = c.split('~')
  if (!id || !KINDS.includes(kind as ChangeKind) || !/^\d+$/.test(ord ?? '')) throw new AppError(400, 'Cursor inválido', 'INVALID_CURSOR')
  return { id, kind, ord: Number(ord) }
}

export async function listChanges(q: { agent?: string; field?: string; kind?: string; days?: number; limit?: number; cursor?: string }) {
  const limit = Math.min(Math.max(q.limit || 50, 1), 200)
  const where: Prisma.Sql[] = [Prisma.sql`r.status = 'ok'`]
  if (q.agent) where.push(Prisma.sql`r.agent = ${q.agent}`)
  if (q.field) where.push(Prisma.sql`x.c->>'field' = ${q.field}`)
  if (q.kind) where.push(Prisma.sql`x.kind = ${q.kind}`)
  if (q.days) where.push(Prisma.sql`r.created_at >= ${new Date(Date.now() - Math.min(Math.max(q.days, 1), 365) * 24 * HOUR)}`)
  if (q.cursor) {
    const c = parseChangeCursor(q.cursor)
    where.push(Prisma.sql`(r.created_at, r.id, x.kind, x.ord) < ((SELECT created_at FROM ai_agent_runs WHERE id = ${c.id}), ${c.id}, ${c.kind}, ${c.ord}::int)`)
  }
  const rows = await prisma.$queryRaw<{
    run_id: string; created_at: Date; agent: string; mode: string; kind: ChangeKind; ord: number
    ticket_id: string | null; display_number: string | null; title: string | null
    field: string; label: string; from: string | null; from_label: string; to: string; to_label: string; confidence: number | null
    rule: string | null; reason: string | null
  }[]>`
    SELECT r.id AS run_id, r.created_at, r.agent, r.mode, x.kind, x.ord,
      t.id AS ticket_id, t.display_number, t.title,
      x.c->>'field' AS field, x.c->>'label' AS label, x.c->>'from' AS "from", x.c->>'fromLabel' AS from_label,
      x.c->>'to' AS "to", x.c->>'toLabel' AS to_label, (x.c->>'confidence')::float8 AS confidence,
      x.c->'rule'->>'name' AS rule, x.c->>'reason' AS reason
    FROM ai_agent_runs r ${CHANGES_LATERAL}
    LEFT JOIN tickets t ON t.id = r.ticket_id
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY r.created_at DESC, r.id DESC, x.kind DESC, x.ord DESC
    LIMIT ${limit + 1}`
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    data: page.map(({ ord: _ord, ticket_id, display_number, title, ...c }) => ({
      ...c, ticket: ticket_id ? { id: ticket_id, display_number, title } : null,
    })),
    next_cursor: rows.length > limit ? `${last.run_id}~${last.kind}~${last.ord}` : null,
  }
}

export async function getMetrics(q: { agent?: string; days?: number }) {
  const days = Math.min(Math.max(q.days || 7, 1), 90)
  const since = new Date(Date.now() - days * 24 * HOUR)
  const agentSql = q.agent ? Prisma.sql`AND r.agent = ${q.agent}` : Prisma.empty
  const [agg] = await prisma.$queryRaw<{ runs: number; errors: number; p50: number | null; p95: number | null; input_tokens: number; output_tokens: number }[]>`
    SELECT count(*)::int AS runs,
      count(*) FILTER (WHERE r.status = 'error')::int AS errors,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY r.latency_ms) FILTER (WHERE r.status = 'ok') AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY r.latency_ms) FILTER (WHERE r.status = 'ok') AS p95,
      coalesce(sum(r.input_tokens), 0)::float8 AS input_tokens,
      coalesce(sum(r.output_tokens), 0)::float8 AS output_tokens
    FROM ai_agent_runs r WHERE r.created_at >= ${since} ${agentSql}`
  // Qualidade: qualquer agente que grave result.questions[{key, wouldApply, confidence}] (e result.priority) entra aqui.
  const fields = await prisma.$queryRaw<{ key: string; total: number; would_apply: number; avg_confidence: number | null }[]>`
    SELECT f.key, count(*)::int AS total,
      count(*) FILTER (WHERE f.would_apply)::int AS would_apply,
      avg(f.confidence)::float8 AS avg_confidence
    FROM ai_agent_runs r
    CROSS JOIN LATERAL (
      SELECT q->>'key' AS key, (q->>'wouldApply')::boolean AS would_apply, (q->>'confidence')::float8 AS confidence
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.result->'questions') = 'array' THEN r.result->'questions' ELSE '[]'::jsonb END) q
      UNION ALL
      SELECT 'priority', (r.result->'priority'->>'wouldApply')::boolean, (r.result->'priority'->>'confidence')::float8
      WHERE jsonb_typeof(r.result->'priority') = 'object'
    ) f
    WHERE r.status = 'ok' AND r.created_at >= ${since} ${agentSql}
    GROUP BY f.key ORDER BY f.key`
  const byField = await prisma.$queryRaw<{ field: string; label: string; applied: number; proposed: number }[]>`
    SELECT x.c->>'field' AS field, max(x.c->>'label') AS label,
      count(*) FILTER (WHERE x.kind = 'applied')::int AS applied,
      count(*) FILTER (WHERE x.kind = 'proposed')::int AS proposed
    FROM ai_agent_runs r ${CHANGES_LATERAL}
    WHERE r.status = 'ok' AND r.created_at >= ${since} ${agentSql}
    GROUP BY 1 ORDER BY 1`
  // O rótulo do tipo traz o número do chamado ("Incidente (INC-1)"); sem ele as transições se agrupam.
  const transitions = await prisma.$queryRaw<{ field: string; label: string; from_label: string; to_label: string; applied: number; proposed: number; total: number }[]>`
    SELECT x.c->>'field' AS field, max(x.c->>'label') AS label, l.from_label, l.to_label,
      count(*) FILTER (WHERE x.kind = 'applied')::int AS applied,
      count(*) FILTER (WHERE x.kind = 'proposed')::int AS proposed,
      count(*)::int AS total
    FROM ai_agent_runs r ${CHANGES_LATERAL}
    CROSS JOIN LATERAL (SELECT
      CASE WHEN x.c->>'field' = 'type' THEN regexp_replace(x.c->>'fromLabel', ' [(][^)]*[)]$', '') ELSE x.c->>'fromLabel' END AS from_label,
      CASE WHEN x.c->>'field' = 'type' THEN regexp_replace(x.c->>'toLabel', ' [(][^)]*[)]$', '') ELSE x.c->>'toLabel' END AS to_label) l
    WHERE r.status = 'ok' AND r.created_at >= ${since} ${agentSql}
    GROUP BY x.c->>'field', l.from_label, l.to_label
    ORDER BY total DESC, field, l.from_label, l.to_label
    LIMIT 10`
  const inputTokens = Number(agg.input_tokens)
  const outputTokens = Number(agg.output_tokens)
  return {
    agent: q.agent ?? null,
    days,
    runs: agg.runs,
    errors: agg.errors,
    error_rate: agg.runs ? agg.errors / agg.runs : 0,
    latency_p50_ms: agg.p50 == null ? null : Math.round(agg.p50),
    latency_p95_ms: agg.p95 == null ? null : Math.round(agg.p95),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: (inputTokens * PRICE_PER_M.input + outputTokens * PRICE_PER_M.output) / 1e6,
    fields: fields.map(f => ({
      key: f.key, total: f.total, would_apply: f.would_apply,
      would_apply_rate: f.total ? f.would_apply / f.total : 0,
      avg_confidence: f.avg_confidence,
    })),
    changes: { by_field: byField, top_transitions: transitions },
  }
}

const router = Router()
router.use(authenticate)
router.use(requireCap('system.admin'))

router.get('/status', async (_req, res) => { res.json({ data: await getStatus() }) })
router.put('/agents/:key/mode', async (req, res) => {
  const key = String(req.params.key)
  if (!AGENTS.some(a => a.key === key)) throw new AppError(404, 'Agente não encontrado', 'NOT_FOUND')
  const { mode } = z.object({ mode: z.enum(AGENT_MODES) }).parse(req.body)
  const from = await agentMode(key)
  await setAgentMode(key, mode)
  await createAuditLog({
    userId: req.user!.sub, action: 'UPDATE_AI_AGENT_MODE', resource: 'AI_AGENT',
    details: { agent: key, from, to: mode }, ip: req.ip, userAgent: req.get('user-agent'),
  })
  res.json({ data: { key, mode } })
})

router.put('/agents/:key/config', async (req, res) => {
  const key = String(req.params.key)
  const agent = AGENTS.find(a => a.key === key)
  if (!agent) throw new AppError(404, 'Agente não encontrado', 'NOT_FOUND')
  const changes = validateConfigInput(agent, req.body?.config)
  await checkLoadedOptions(agent, changes)
  const { before, after } = await setAgentConfig(key, changes)
  await createAuditLog({
    userId: req.user!.sub, action: 'UPDATE_AI_AGENT_CONFIG', resource: 'AI_AGENT',
    details: { agent: key, changes, before }, ip: req.ip, userAgent: req.get('user-agent'),
  })
  res.json({ data: { key, config: after } })
})
router.get('/runs', async (req, res) => {
  res.json(await listRuns({
    agent: str(req.query.agent), status: str(req.query.status),
    limit: Number(req.query.limit) || undefined, cursor: str(req.query.cursor),
  }))
})
router.get('/changes', async (req, res) => {
  res.json(await listChanges({
    agent: str(req.query.agent), field: str(req.query.field), kind: str(req.query.kind),
    days: Number(req.query.days) || undefined, limit: Number(req.query.limit) || undefined, cursor: str(req.query.cursor),
  }))
})
router.get('/feedback', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  const field = str(req.query.field)
  const days = Number(req.query.days) || undefined
  const cursor = str(req.query.cursor)
  const rows = await prisma.aiFeedback.findMany({
    where: {
      ...(field ? { field } : {}),
      ...(days ? { created_at: { gte: new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 24 * HOUR) } } : {}),
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { id: true, name: true } }, ticket: { select: { id: true, display_number: true, title: true } } },
  })
  const page = rows.slice(0, limit)
  res.json({ data: await withValueLabels(page), next_cursor: rows.length > limit ? page[page.length - 1].id : null })
})
router.get('/metrics', async (req, res) => {
  res.json({ data: await getMetrics({ agent: str(req.query.agent), days: Number(req.query.days) || undefined }) })
})

export default router
