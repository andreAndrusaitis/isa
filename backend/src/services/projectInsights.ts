/**
 * Séries para os gráficos de Projetos (Visão Geral, Tempo, Equipe, Minha Área, BI).
 * Tudo deriva do histórico já existente: conclusão = último status_changed para
 * uma etapa de categoria "done" (computeTaskTime), horas = trechos contados do
 * tempo por status recortados por dia em horas úteis.
 * Dias no fuso de São Paulo (UTC-3 fixo desde 2019).
 */
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { visibleProjectsWhere } from './projectAccess'
import { loadProjectTime } from './taskTime'
import { getBusinessHoursConfig } from './businessHours'
import { holidaysAround } from '../utils/businessHours'

const DAY = 86_400_000
// Conta direta (UTC−3): o Intl com timeZone custava ~1s por painel em laços de dias × tasks.
// shortcut: São Paulo sem horário de verão desde 2019; se voltar, trocar pelo Intl.
const SP_OFFSET = 3 * 3_600_000
export const dayKey = (d: Date) => new Date(d.getTime() - SP_OFFSET).toISOString().slice(0, 10)
const dayStart = (key: string) => new Date(`${key}T00:00:00-03:00`)
/** Prazo (gravado 12:00Z do dia) antes disto está atrasado: atrasa só no dia seguinte ao prazo, em SP. */
export const overdueCutoff = (now = new Date()) => dayStart(dayKey(now))

/** Lista de dias (YYYY-MM-DD) de `days` dias atrás até hoje. */
export function lastDays(days: number, now = new Date()) {
  const today = dayStart(dayKey(now))
  return Array.from({ length: days }, (_, i) => dayKey(new Date(today.getTime() - (days - 1 - i) * DAY + 12 * 3_600_000)))
}

/** Segunda-feira (YYYY-MM-DD) da semana do dia. */
export function weekKey(key: string) {
  const d = dayStart(key)
  const dow = (d.getUTCDay() + 6) % 7 // após o deslocamento de -3h, getUTCDay ainda é o dia local às 03:00Z
  return dayKey(new Date(d.getTime() - dow * DAY + 12 * 3_600_000))
}

type Row = Awaited<ReturnType<typeof loadProjectTime>>[number]
const isDone = (r: Row) => r.status?.category === 'done'

export type Burndown = { sprint: { id: string; name: string; start: string; end: string }; unit: 'pontos' | 'tasks'; total: number; days: Array<{ date: string; remaining: number | null; ideal: number }> }

/**
 * Pontos (ou tasks, se ninguém estimou) restantes por dia da sprint, com a linha
 * ideal. `sprintIds` aceita várias: a sprint global soma as cópias de cada projeto.
 */
export function sprintBurndown(rows: Row[], sprintIds: Set<string>, sprint: { id: string; name: string; start: Date; end: Date }, now = new Date()): Burndown {
  const completedAt = (r: Row) => (isDone(r) ? r.time.completedAt ?? null : null)
  const inSprint = rows.filter((r) => r.task.sprint_id && sprintIds.has(r.task.sprint_id))
  const usePoints = inSprint.some((r) => r.task.story_points)
  const weight = (r: Row) => (usePoints ? r.task.story_points ?? 0 : 1)
  const total = inSprint.reduce((n, r) => n + weight(r), 0)
  const startKey = dayKey(sprint.start), endKey = dayKey(sprint.end)
  const span = Math.max(1, Math.round((dayStart(endKey).getTime() - dayStart(startKey).getTime()) / DAY))
  const todayKey = dayKey(now)
  return {
    sprint: { id: sprint.id, name: sprint.name, start: startKey, end: endKey },
    unit: usePoints ? 'pontos' : 'tasks',
    total,
    days: Array.from({ length: span + 1 }, (_, i) => {
      const key = dayKey(new Date(dayStart(startKey).getTime() + i * DAY + 12 * 3_600_000))
      const doneBy = inSprint.filter((r) => { const c = completedAt(r); return c && dayKey(c) <= key }).reduce((n, r) => n + weight(r), 0)
      return { date: key, remaining: key > todayKey ? null : total - doneBy, ideal: Math.round((total * (1 - i / span)) * 10) / 10 }
    }),
  }
}

/**
 * Janela de expediente (ms) de cada dia da lista, ou null em fim de semana/feriado.
 * Recortar horas por dia com isto é aritmética pura; chamar o relógio de horas úteis
 * dia a dia custava segundos no portfólio.
 */
async function businessWindows(keys: string[]) {
  const cfg = await getBusinessHoursConfig()
  const holidays = new Set(holidaysAround(new Date(`${keys[0]}T12:00:00Z`)))
  const [sh, sm] = cfg.business_hours_start.split(':').map(Number)
  const [eh, em] = cfg.business_hours_end.split(':').map(Number)
  return new Map(keys.map((key) => {
    const base = dayStart(key).getTime()
    const weekday = ((new Date(base).getUTCDay() + 6) % 7) + 1 // ISO 1..7 do dia local
    const working = cfg.working_days.includes(weekday) && !holidays.has(key)
    return [key, working ? { start: base + (sh * 60 + sm) * 60_000, end: base + (eh * 60 + em) * 60_000 } : null] as const
  }))
}

// Cache curto por conjunto de projetos: o portfólio recalcula o histórico de ~1000 tasks.
// shortcut: cache em memória por instância (60s); com várias instâncias cada uma tem o seu.
const cache = new Map<string, { at: number; value: Promise<Awaited<ReturnType<typeof computeInsights>>> }>()
export function getInsights(projectIds: string[], opts: { days?: number; weeks?: number } = {}) {
  const key = `${[...projectIds].sort().join(',')}|${opts.days ?? 90}|${opts.weeks ?? 26}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const value = computeInsights(projectIds, opts)
  cache.set(key, { at: Date.now(), value })
  value.catch(() => cache.delete(key))
  return value
}

/** Indicadores de um conjunto de projetos (um projeto ou o portfólio do usuário). */
async function computeInsights(projectIds: string[], opts: { days?: number; weeks?: number } = {}) {
  const days = opts.days ?? 90
  const weeks = opts.weeks ?? 26
  const now = new Date()
  const rows = await loadProjectTime(projectIds)
  const completedAt = (r: Row) => (isDone(r) ? r.time.completedAt ?? null : null)

  // 1. Progresso por tipo de task (anéis).
  const types = await prisma.taskType.findMany({ where: { project_id: { in: projectIds } }, select: { id: true, name: true, prefix: true, color: true } })
  const byTypeName = new Map<string, { name: string; prefix: string; color: string; total: number; done: number }>()
  for (const r of rows) {
    const t = types.find((x) => x.id === r.task.task_type_id)
    const k = t ? t.name : 'Sem tipo'
    const cur = byTypeName.get(k) ?? { name: k, prefix: t?.prefix ?? '', color: t?.color ?? '#6b7f8a', total: 0, done: 0 }
    cur.total++
    if (isDone(r)) cur.done++
    byTypeName.set(k, cur)
  }
  const byType = [...byTypeName.values()].sort((a, b) => b.total - a.total)

  // 2. Entregas no prazo (medidor): concluídas com prazo, concluídas até o dia do prazo.
  let onTime = 0, late = 0
  for (const r of rows) {
    const c = completedAt(r)
    if (!c || !r.task.due_date) continue
    if (dayKey(c) <= r.task.due_date.toISOString().slice(0, 10)) onTime++
    else late++
  }

  // 3. Diário: criadas, concluídas, em aberto e concluídas acumuladas (fluxo cumulativo) e horas.
  const dayList = lastDays(days, now)
  const first = dayStart(dayList[0])
  const windows = await businessWindows(dayList)
  const daily = dayList.map((key) => ({ date: key, created: 0, completed: 0, open: 0, doneTotal: 0, minutes: 0 }))
  const idx = new Map(dayList.map((k, i) => [k, i]))
  for (const r of rows) {
    const ck = dayKey(r.task.created_at)
    const c = completedAt(r)
    const doneKey = c ? dayKey(c) : null
    if (idx.has(ck)) daily[idx.get(ck)!].created++
    if (doneKey && idx.has(doneKey)) daily[idx.get(doneKey)!].completed++
    for (const d of daily) {
      if (ck > d.date) continue
      if (doneKey && doneKey <= d.date) d.doneTotal++
      else d.open++
    }
    // Horas: trechos contados (em andamento/revisão), recortados por dia em minutos úteis.
    for (const seg of r.time.segments) {
      if (!seg.counted || seg.end <= first) continue
      let cursor = seg.start < first ? first : seg.start
      while (cursor < seg.end) {
        const key = dayKey(cursor)
        const next = new Date(Math.min(seg.end.getTime(), dayStart(key).getTime() + DAY))
        const i = idx.get(key)
        const w = windows.get(key)
        if (i !== undefined && w) {
          const overlap = Math.min(next.getTime(), w.end) - Math.max(cursor.getTime(), w.start)
          if (overlap > 0) daily[i].minutes += overlap / 60_000
        }
        cursor = next
      }
    }
  }

  // 4. Entregas por semana + eventos (marcos e épicos concluídos).
  const weekList = [...new Set(lastDays(weeks * 7, now).map(weekKey))].slice(-weeks)
  const weekly = weekList.map((w) => ({ week: w, completed: 0 }))
  const events: Array<{ date: string; week: string; label: string; detail: string }> = []
  for (const r of rows) {
    const c = completedAt(r)
    if (!c) continue
    const wk = weekKey(dayKey(c))
    const w = weekly.find((x) => x.week === wk)
    if (!w) continue
    w.completed++
    if (r.task.is_milestone || (r.task.key ?? '').startsWith('EPIC-')) {
      events.push({ date: dayKey(c), week: wk, label: `${r.task.key ?? `#${r.task.seq}`} concluído`, detail: r.task.title })
    }
  }

  // 5. Burndown da sprint ativa (ou a mais recente com datas): pontos (ou tasks) restantes por dia.
  const sprint = await prisma.sprint.findFirst({
    where: { project_id: { in: projectIds }, start_date: { not: null }, end_date: { not: null }, status: { in: ['active', 'completed'] } },
    orderBy: [{ status: 'asc' }, { end_date: 'desc' }], // 'active' antes de 'completed'
  })
  const burndown = sprint?.start_date && sprint.end_date
    ? sprintBurndown(rows, new Set([sprint.id]), { id: sprint.id, name: sprint.name, start: sprint.start_date, end: sprint.end_date }, now)
    : null

  return {
    byType,
    onTime: { onTime, late, pct: onTime + late ? Math.round((onTime / (onTime + late)) * 100) : null },
    daily: daily.map((d) => ({ ...d, minutes: Math.round(d.minutes), hours: Math.round((d.minutes / 60) * 10) / 10 })),
    weekly,
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
    burndown,
  }
}

/** Mapa de calor: atividades por dia (mudanças em tasks e comentários) no último ano. */
export async function getActivityHeatmap(projectIds: string[], userId?: string, days = 371) {
  if (projectIds.length === 0) return []
  const since = new Date(Date.now() - days * DAY)
  const byUser = userId ? Prisma.sql`AND ta.actor_id = ${userId}` : Prisma.empty
  const byUserComment = userId ? Prisma.sql`AND c.author_id = ${userId}` : Prisma.empty
  const rows = await prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
    SELECT day, SUM(n)::bigint AS n FROM (
      SELECT to_char(ta.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM task_activities ta JOIN tasks t ON t.id = ta.task_id
      WHERE t.project_id IN (${Prisma.join(projectIds)}) AND ta.created_at >= ${since} ${byUser}
      GROUP BY 1
      UNION ALL
      SELECT to_char(c.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM task_comments c JOIN tasks t ON t.id = c.task_id
      WHERE t.project_id IN (${Prisma.join(projectIds)}) AND c.created_at >= ${since} AND c.deleted_at IS NULL ${byUserComment}
      GROUP BY 1
    ) x GROUP BY day ORDER BY day`
  return rows.map((r) => ({ date: r.day, count: Number(r.n) }))
}

/** Projetos ativos de que o usuário é membro (base do portfólio, da equipe e de "minha área"). */
export async function memberProjectIds(userId: string) {
  const projects = await prisma.project.findMany({ where: { archived_at: null, ...(await visibleProjectsWhere(userId)) }, select: { id: true } })
  return projects.map((p) => p.id)
}
