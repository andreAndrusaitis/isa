/**
 * GET /api/ai/insights — painel do gestor: quanto da triagem é automática, quanto é corrigida,
 * acerto da IA nos chamados já resolvidos, tempo até a primeira atribuição, intake e orientação.
 * GET /api/ai/insights/knowledge — gerente e admin: quanto a base de conhecimento resolve sozinha.
 * Montado antes de /api/ai (aquele router é só admin); o escopo vem da carteira de quem pede.
 */
import { Router } from 'express'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { AppError } from '../middlewares/errorHandler'
import { getEffectiveScope, type EffectiveScope } from '../services/scope'
import { NONE_VALUE } from './agents/triage/options'

const DAY = 24 * 3600_000
const FIELDS = ['type', 'category', 'subcategory', 'priority'] as const
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

// Datas são dias de São Paulo; o Brasil não tem horário de verão desde 2019, então -03:00 fixo basta.
const TZ = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
const dayStart = (s: string) => new Date(`${s}T00:00:00-03:00`)
const shift = (s: string, days: number) => TZ.format(new Date(dayStart(s).getTime() + days * DAY + DAY / 2))
function parseDay(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(dayStart(s).getTime()) || shift(s, 0) !== s) throw new AppError(400, 'Data inválida', 'INVALID_DATE')
  return s
}

type Q = { from?: string; to?: string; org_id?: string; category_id?: string }

function periodOf(q: Q) {
  const today = TZ.format(new Date())
  const to = q.to ? parseDay(q.to) : today
  const from = q.from ? parseDay(q.from) : shift(to, -29) // 30 dias inclusivos
  const start = dayStart(from)
  const end = dayStart(shift(to, 1)) // `to` inclui o dia inteiro
  if (end <= start || end.getTime() - start.getTime() > 366 * DAY) throw new AppError(400, 'Período inválido (máximo de 366 dias)', 'INVALID_DATE')
  return { from, to, start, end }
}

/** Período, carteira e empresa escolhida sobre uma tabela com created_at e org_id. */
function periodAndScope(alias: string, { start, end }: { start: Date; end: Date }, scope: EffectiveScope, orgId?: string) {
  const col = (name: string) => Prisma.raw(`${alias}.${name}`)
  const where = [Prisma.sql`${col('created_at')} >= ${start}`, Prisma.sql`${col('created_at')} < ${end}`]
  if (!scope.scopeAll) where.push(scope.orgIds.length ? Prisma.sql`${col('org_id')} IN (${Prisma.join(scope.orgIds)})` : Prisma.sql`FALSE`)
  if (orgId) where.push(Prisma.sql`${col('org_id')} = ${orgId}`)
  return where
}

export async function getInsights(q: Q, user: { sub: string; role: string }) {
  const { from, to, start, end } = periodOf(q)
  const scope = await getEffectiveScope(user.sub, user.role)

  const where = [...periodAndScope('t', { start, end }, scope, q.org_id), Prisma.sql`t.deleted_at IS NULL`]
  if (q.category_id) where.push(Prisma.sql`t.category_id = ${q.category_id}`)

  // Chamados do filtro + a última triagem ok de cada um.
  const cte = Prisma.sql`WITH base AS (
      SELECT t.id, t.type::text AS type, t.priority::text AS priority, t.category_id, t.subcategory_id, t.status::text AS status,
        t.created_at, t.first_assigned_at, t.intake_status, t.guidance_status
      FROM tickets t WHERE ${Prisma.join(where, ' AND ')}
    ), runs AS (
      SELECT DISTINCT ON (r.ticket_id) r.ticket_id, r.id AS run_id, r.result
      FROM ai_agent_runs r JOIN base b ON b.id = r.ticket_id
      WHERE r.agent = 'triage' AND r.status = 'ok'
      ORDER BY r.ticket_id, r.created_at DESC
    )`

  const [[c], acc, times] = await Promise.all([
    prisma.$queryRaw<{ tickets: number; triaged: number; automatic: number; reclassified: number; incomplete: number; complemented: number; deflected: number; linked: number }[]>`
      ${cte}
      SELECT count(*)::int AS tickets, count(r.ticket_id)::int AS triaged,
        count(*) FILTER (WHERE jsonb_array_length(a.els) > 0)::int AS automatic,
        count(*) FILTER (WHERE jsonb_array_length(a.els) > 0 AND EXISTS (
          SELECT 1 FROM ai_feedback f WHERE f.run_id = r.run_id AND f.from_value = f.ai_value AND f.to_value IS DISTINCT FROM f.ai_value
          AND f.field IN (SELECT e->>'field' FROM jsonb_array_elements(a.els) e)))::int AS reclassified,
        count(*) FILTER (WHERE b.intake_status IN ('incomplete', 'complemented'))::int AS incomplete,
        count(*) FILTER (WHERE b.intake_status = 'complemented')::int AS complemented,
        count(*) FILTER (WHERE b.guidance_status = 'deflected')::int AS deflected,
        count(*) FILTER (WHERE b.guidance_status = 'linked')::int AS linked
      FROM base b LEFT JOIN runs r ON r.ticket_id = b.id
      CROSS JOIN LATERAL (
        -- automática = alguma alteração aplicada sem regra (as com regra são determinísticas)
        SELECT coalesce(jsonb_agg(e), '[]'::jsonb) AS els
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.result->'applied') = 'array' THEN r.result->'applied' ELSE '[]'::jsonb END) e
        WHERE jsonb_typeof(e->'rule') IS DISTINCT FROM 'object'
      ) a`,
    // Acerto: valor da IA × valor atual do chamado resolvido (vale também em sombra).
    prisma.$queryRaw<{ field: string; total: number; correct: number }[]>`
      ${cte}
      SELECT f.field, count(*)::int AS total, count(*) FILTER (WHERE f.ai = f.cur)::int AS correct
      FROM base b JOIN runs r ON r.ticket_id = b.id
      CROSS JOIN LATERAL (
        SELECT x->>'key' AS field, x->>'chosen' AS ai,
          CASE x->>'key' WHEN 'type' THEN b.type WHEN 'category' THEN b.category_id WHEN 'subcategory' THEN b.subcategory_id END AS cur
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.result->'questions') = 'array' THEN r.result->'questions' ELSE '[]'::jsonb END) x
        WHERE x->>'key' IN ('type', 'category', 'subcategory')
        UNION ALL
        SELECT 'priority', r.result->'priority'->>'value', b.priority WHERE jsonb_typeof(r.result->'priority') = 'object'
      ) f
      WHERE b.status IN ('resolved', 'closed') AND f.ai IS NOT NULL AND f.ai <> ${NONE_VALUE}
      GROUP BY f.field`,
    prisma.$queryRaw<{ triaged: boolean; count: number; median: number; p90: number }[]>`
      ${cte}
      SELECT (r.ticket_id IS NOT NULL) AS triaged, count(*)::int AS count,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY m.minutes)::float8 AS median,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY m.minutes)::float8 AS p90
      FROM base b LEFT JOIN runs r ON r.ticket_id = b.id
      CROSS JOIN LATERAL (SELECT EXTRACT(EPOCH FROM (b.first_assigned_at - b.created_at)) / 60 AS minutes) m
      WHERE b.first_assigned_at IS NOT NULL
      GROUP BY 1`,
  ])

  const rate = (n: number, d: number) => (d ? n / d : 0)
  const time = (triaged: boolean) => {
    const t = times.find(x => x.triaged === triaged)
    return { count: t?.count ?? 0, median_minutes: t?.median ?? null, p90_minutes: t?.p90 ?? null }
  }
  return {
    period: { from, to },
    tickets: c.tickets, triaged: c.triaged,
    automatic: c.automatic, manual: c.triaged - c.automatic, automatic_rate: rate(c.automatic, c.triaged),
    reclassified: c.reclassified, reclassification_rate: rate(c.reclassified, c.automatic),
    accuracy: FIELDS.map(field => {
      const a = acc.find(x => x.field === field)
      return { field, total: a?.total ?? 0, correct: a?.correct ?? 0, rate: rate(a?.correct ?? 0, a?.total ?? 0) }
    }),
    time_to_assign: { triaged: time(true), not_triaged: time(false) },
    intake: { incomplete: c.incomplete, complemented: c.complemented },
    guidance: { deflected: c.deflected, linked: c.linked },
    empty: c.tickets === 0,
  }
}

/** Meta do contrato para chamados resolvidos pela IA. */
export const AI_RESOLUTION_TARGET = 0.35
const TOP_ARTICLES = 10
const DAILY_SERIES_MAX_DAYS = 92 // acima disso, um ponto por dia deixa o gráfico ilegível

const share = (n: number, d: number) => (d ? n / d : null)

export async function getKnowledgeMetrics(q: Q, user: { sub: string; role: string }) {
  const period = periodOf(q)
  const { from, to } = period
  const scope = await getEffectiveScope(user.sub, user.role)
  const tickets = Prisma.join([...periodAndScope('t', period, scope, q.org_id), Prisma.sql`t.deleted_at IS NULL`], ' AND ')
  const interactions = Prisma.join(periodAndScope('i', period, scope, q.org_id), ' AND ')

  const monthly = (period.end.getTime() - period.start.getTime()) / DAY > DAILY_SERIES_MAX_DAYS
  // -3h: o mesmo dia de São Paulo do resto do painel.
  const bucket = Prisma.sql`to_char(i.created_at - interval '3 hours', ${monthly ? 'YYYY-MM' : 'YYYY-MM-DD'})`

  const [[t], [i], perBucket, articles] = await Promise.all([
    // Todo chamado do período é da IA ou da equipe; reaberto perde a marca e passa a ser da equipe.
    prisma.$queryRaw<{ ai_resolved: number; team_opened: number }[]>`
      SELECT count(*) FILTER (WHERE t.ai_resolved)::int AS ai_resolved, count(*) FILTER (WHERE NOT t.ai_resolved)::int AS team_opened
      FROM tickets t WHERE ${tickets}`,
    prisma.$queryRaw<{ total: number; answered: number; useful: number; not_useful: number }[]>`
      SELECT count(*)::int AS total, count(i.answer)::int AS answered,
        count(*) FILTER (WHERE i.feedback = 'useful')::int AS useful,
        count(*) FILTER (WHERE i.feedback = 'not_useful')::int AS not_useful
      FROM ai_interactions i WHERE ${interactions}`,
    prisma.$queryRaw<{ date: string; count: number }[]>`
      SELECT ${bucket} AS date, count(*)::int AS count FROM ai_interactions i WHERE ${interactions} GROUP BY 1`,
    prisma.$queryRaw<{ article_id: string; title: string; uses: number }[]>`
      SELECT s.article_id, coalesce(max(a.title), max(s.title)) AS title, count(DISTINCT i.id)::int AS uses
      FROM ai_interactions i
      CROSS JOIN LATERAL (
        SELECT e->>'articleId' AS article_id, e->>'title' AS title
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.sources) = 'array' THEN i.sources ELSE '[]'::jsonb END) e
      ) s
      LEFT JOIN knowledge_articles a ON a.id = s.article_id
      WHERE ${interactions} AND s.article_id IS NOT NULL
      GROUP BY s.article_id
      ORDER BY uses DESC, title
      LIMIT ${TOP_ARTICLES}`,
  ])

  const counted = new Map(perBucket.map(b => [b.date, b.count]))
  const keys = new Set<string>()
  for (let d = from; d <= to; d = shift(d, 1)) keys.add(monthly ? d.slice(0, 7) : d)

  const rated = i.useful + i.not_useful
  return {
    period: { from, to },
    resolution: { ...t, rate: share(t.ai_resolved, t.ai_resolved + t.team_opened), target: AI_RESOLUTION_TARGET },
    feedback: { useful: i.useful, not_useful: i.not_useful, rate: share(i.useful, rated) },
    interactions: { total: i.total, answered: i.answered, bucket: monthly ? 'month' : 'day', series: [...keys].map(date => ({ date, count: counted.get(date) ?? 0 })) },
    top_articles: articles,
    empty: t.ai_resolved + t.team_opened + i.total === 0,
  }
}

const router = Router()
router.use(authenticate)
router.get('/', requireCap('dashboard.view'), async (req, res) => {
  const { from, to, org_id, category_id } = req.query
  res.json({ data: await getInsights({ from: str(from), to: str(to), org_id: str(org_id), category_id: str(category_id) }, req.user!) })
})
router.get('/knowledge', requireCap('knowledge.metrics'), async (req, res) => {
  const { from, to, org_id } = req.query
  res.json({ data: await getKnowledgeMetrics({ from: str(from), to: str(to), org_id: str(org_id) }, req.user!) })
})

export default router
