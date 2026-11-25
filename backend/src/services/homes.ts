/**
 * Telas iniciais da gestão: Turno (supervisor: o que decidir agora) e Carteira
 * (gerente: como está cada cliente). Usam a mesma carteira da lista de chamados.
 */
import prisma from '../config/prisma'
import { canSeeOrg, canSeeQueue, getEffectiveScope, scopeOrgWhere, scopeTicketWhere, type EffectiveScope } from './scope'
import { getEffectiveModules } from './moduleAccess'
import { getBusinessHoursConfig } from './businessHours'
import { addBusinessHours, holidaysAround } from '../utils/businessHours'

const ACTIVE = ['open', 'in_progress', 'pending'] as const
const DAY = 86_400_000

async function scopedWhere(role: string, userId: string): Promise<{ AND?: any[] }> {
  return role === 'admin' ? {} : scopeTicketWhere(await getEffectiveScope(userId, role))
}

// ── Turno ────────────────────────────────────────────────────────────────────

export type DeadlineState = 'ok' | 'soon' | 'late' | 'paused'
export interface ShiftPerson { id: string; name: string; avatar: string | null; queues: string[]; active: number; late: number; soon: number; tickets: { id: string; number: string; title: string; state: DeadlineState }[] }

/**
 * Quem tem menos chamados ativos entre os que atendem a fila e a empresa (`canTake`,
 * a mesma regra que o servidor aplica ao trocar o responsável). Sem ninguém, não há sugestão.
 */
export async function suggestPerson<T extends { id: string; queues: string[]; active: number; late: number }>(
  people: T[], queueId: string | null, exceptId?: string | null, canTake: (p: T) => Promise<boolean> = async () => true,
): Promise<T | null> {
  const fit = people.filter(p => p.id !== exceptId && (!queueId || p.queues.includes(queueId)))
    .sort((a, b) => a.active - b.active || a.late - b.late)
  for (const p of fit) if (await canTake(p)) return p
  return null
}

const DECISION_LIMIT = 12

export async function getShift(role: string, userId: string) {
  const now = new Date()
  const bh = await getBusinessHoursConfig()
  const soonLimit = addBusinessHours(now, 4, bh, holidaysAround(now))
  const visibility = await scopedWhere(role, userId)

  const [tickets, agents] = await Promise.all([
    prisma.ticket.findMany({
      where: { deleted_at: null, status: { in: [...ACTIVE] }, ...visibility },
      select: {
        id: true, display_number: true, title: true, status: true, priority: true, queue: true, pending_reason: true,
        created_at: true, sla_deadline: true, client_forecast_at: true, assigned_to_id: true, category_id: true,
        org: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        assigned_to: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { sla_deadline: 'asc' },
    }),
    prisma.user.findMany({
      where: { active: true, deleted_at: null, role: 'agent' },
      select: { id: true, name: true, avatar: true, queues: true, manager_id: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const stateOf = (t: { status: string; sla_deadline: Date }): DeadlineState =>
    t.status === 'pending' ? 'paused' : t.sla_deadline < now ? 'late' : t.sla_deadline <= soonLimit ? 'soon' : 'ok'

  // A carga conta tudo o que a pessoa tem, também fora da carteira de quem olha;
  // os blocos mostram só os chamados que quem olha pode abrir.
  const load = await prisma.ticket.findMany({
    where: { deleted_at: null, status: { in: [...ACTIVE] }, assigned_to_id: { in: agents.map(p => p.id) } },
    select: { id: true, status: true, sla_deadline: true, assigned_to_id: true },
  })
  const visible = new Map(tickets.map(t => [t.id, t]))
  const summary = agents.map(({ manager_id, ...p }) => {
    const mine = load.filter(t => t.assigned_to_id === p.id)
    const states = mine.map(stateOf)
    return {
      ...p, inTeam: role !== 'supervisor' || manager_id === userId,
      active: mine.length,
      late: states.filter(s => s === 'late').length,
      soon: states.filter(s => s === 'soon').length,
      tickets: mine.flatMap(t => {
        const full = visible.get(t.id)
        return full ? [{ id: t.id, number: full.display_number, title: full.title, state: stateOf(t) }] : []
      }),
    }
  })
  const people: ShiftPerson[] = summary.filter(p => p.inTeam).sort((a, b) => b.active - a.active)

  const late = tickets.filter(t => stateOf(t) === 'late')
  const soon = tickets.filter(t => stateOf(t) === 'soon')
  const unassigned = tickets.filter(t => !t.assigned_to_id)
  const waiting = tickets.filter(t => t.status === 'pending' && t.pending_reason === 'pending_user')

  const queueNames = new Map((await prisma.queue.findMany({ select: { id: true, name: true } })).map(q => [q.id, q.name]))
  const rank = (t: typeof tickets[number]) => {
    const s = stateOf(t)
    return (t.assigned_to_id ? 4 : 0) + (s === 'late' ? 0 : s === 'soon' ? 1 : t.assigned_to_id ? 9 : 2)
  }
  const pool = tickets.filter(t => t.status !== 'pending' && (!t.assigned_to_id || ['late', 'soon'].includes(stateOf(t))))
  // Carteira e módulo de cada candidato, lidos uma vez por pessoa.
  const access = new Map<string, Promise<{ scope: EffectiveScope; on: boolean }>>()
  const accessOf = (id: string) => {
    if (!access.has(id)) access.set(id, (async () => ({ scope: await getEffectiveScope(id, 'agent'), on: (await getEffectiveModules(id, 'agent')).tickets }))())
    return access.get(id)!
  }
  const top = pool.sort((a, b) => rank(a) - rank(b) || a.sla_deadline.getTime() - b.sla_deadline.getTime())
    .slice(0, DECISION_LIMIT)
  const decisions = await Promise.all(top.map(async t => {
      const canTake = async (p: { id: string }) => {
        const { scope, on } = await accessOf(p.id)
        return on && canSeeOrg(scope, t.org?.id) && canSeeQueue(scope, t.queue)
      }
      const owner = t.assigned_to_id ? people.find(p => p.id === t.assigned_to_id) : null
      // Primeiro a própria equipe; sem ninguém dela na fila, quem atende a fila em outra equipe.
      const pick = (await suggestPerson(people, t.queue, t.assigned_to_id, canTake))
        ?? (t.assigned_to_id ? null : await suggestPerson(summary, t.queue, null, canTake))
      // Passar adiante só vale a pena quando a outra pessoa está de fato mais livre.
      const worth = pick && (!t.assigned_to_id || !owner || pick.active + 2 <= owner.active)
      return {
        id: t.id, number: t.display_number, title: t.title, priority: t.priority, state: stateOf(t),
        queueId: t.queue, queue: (t.queue && queueNames.get(t.queue)) ?? null,
        org: t.org, owner: t.assigned_to, createdAt: t.created_at, deadline: t.sla_deadline,
        // Vencido sem nova previsão: o cliente está sem data.
        needsForecast: stateOf(t) === 'late' && (!t.client_forecast_at || t.client_forecast_at < now),
        suggestion: worth ? { id: pick.id, name: pick.name, avatar: pick.avatar, active: pick.active, otherTeam: !people.some(p => p.id === pick.id) } : null,
      }
    }))

  // Assunto repetido: três ou mais da mesma categoria abertos nas últimas 48 h.
  const recent = tickets.filter(t => t.category && now.getTime() - t.created_at.getTime() <= 2 * DAY)
  const byCategory = new Map<string, typeof tickets>()
  for (const t of recent) byCategory.set(t.category_id!, [...(byCategory.get(t.category_id!) ?? []), t])
  const repeated = [...byCategory.values()].filter(list => list.length >= 3).sort((a, b) => b.length - a.length).slice(0, 2)
    .map(list => ({
      category: list[0].category!, count: list.length,
      orgs: [...new Set(list.map(t => t.org?.name).filter(Boolean))].slice(0, 3),
    }))

  const oldest = unassigned.reduce<Date | null>((min, t) => (!min || t.created_at < min ? t.created_at : min), null)
  const topOrg = (list: typeof tickets) => {
    const n = new Map<string, number>()
    for (const t of list) if (t.org) n.set(t.org.name, (n.get(t.org.name) ?? 0) + 1)
    const [name, count] = [...n].sort((a, b) => b[1] - a[1])[0] ?? []
    return name ? { name, count: count! } : null
  }
  return {
    numbers: {
      late: late.length, lateTop: topOrg(late),
      soon: soon.length,
      unassigned: unassigned.length, unassignedOldest: oldest,
      waiting: waiting.length,
    },
    decisions, pending: Math.max(0, pool.length - decisions.length), repeated, people,
  }
}

// ── Carteira ─────────────────────────────────────────────────────────────────

export interface Punctual { resolved_at: Date | null; sla_deadline: Date; status: string }

/**
 * No prazo no intervalo [from, to): resolvidos dentro dele mais os que venceram
 * dentro dele e continuam abertos. Sem nada no intervalo devolve null (não é 100%).
 */
export function onTimeRate(tickets: Punctual[], from: Date, to: Date, now: Date): { rate: number | null; done: number; late: number } {
  let done = 0, late = 0
  for (const t of tickets) {
    if (t.resolved_at) {
      if (t.resolved_at < from || t.resolved_at >= to) continue
      if (t.resolved_at <= t.sla_deadline) done++
      else late++
    } else if (['open', 'in_progress'].includes(t.status) && t.sla_deadline < now && t.sla_deadline >= from && t.sla_deadline < to) late++
  }
  const total = done + late
  return { rate: total ? Math.round((done / total) * 100) : null, done, late }
}

const WEEKS = 8

export async function getPortfolio(role: string, userId: string, days = 30) {
  const now = new Date()
  const from = new Date(now.getTime() - days * DAY)
  const before = new Date(now.getTime() - 2 * days * DAY)
  const seriesStart = new Date(now.getTime() - WEEKS * 7 * DAY)
  const scope = role === 'admin' ? null : await getEffectiveScope(userId, role)
  const orgs = await prisma.organization.findMany({
    where: { active: true, deleted_at: null, ...(scope ? scopeOrgWhere(scope) : {}) },
    select: { id: true, name: true, tier: true },
    orderBy: { name: 'asc' },
  })
  const orgIds = orgs.map(o => o.id)
  const since = before < seriesStart ? before : seriesStart
  const visibility = await scopedWhere(role, userId)
  const tickets = await prisma.ticket.findMany({
    where: {
      deleted_at: null, ai_resolved: false,
      AND: [...(visibility.AND ?? []), { org_id: { in: orgIds } }, { OR: [{ resolved_at: { gte: since } }, { status: { in: [...ACTIVE] } }] }],
    },
    select: {
      org_id: true, status: true, sla_deadline: true, resolved_at: true, created_at: true,
      category: { select: { name: true } }, assigned_to: { select: { id: true, name: true } },
    },
  })
  const answers = await prisma.surveyAnswer.findMany({
    where: {
      valor_numero: { not: null },
      question: { tipo: { in: ['escala_1_5', 'escala'] } },
      response: { respondido_em: { gte: from }, instance: { ticket: { org_id: { in: orgIds }, deleted_at: null } } },
    },
    select: { valor_numero: true, question: { select: { id: true, opcoes: { select: { valor: true } } } }, response: { select: { id: true, instance: { select: { ticket: { select: { org_id: true } } } } } } },
  })
  // Só notas de 1 a 5: escalas maiores não se somam com elas.
  const fiveScale = answers.filter(a => a.valor_numero! >= 1 && a.valor_numero! <= 5 && a.question.opcoes.every(o => Number(o.valor) <= 5 || Number.isNaN(Number(o.valor))))
  const csat = (list: typeof fiveScale) => list.length ? Math.round((list.reduce((s, a) => s + a.valor_numero!, 0) / list.length) * 10) / 10 : null
  const responses = (list: typeof fiveScale) => new Set(list.map(a => a.response.id)).size

  const clients = orgs.map(org => {
    const mine = tickets.filter(t => t.org_id === org.id)
    const active = mine.filter(t => (ACTIVE as readonly string[]).includes(t.status))
    const overdue = active.filter(t => t.status !== 'pending' && t.sla_deadline < now)
    const current = onTimeRate(mine, from, now, now)
    const previous = onTimeRate(mine, before, from, from)
    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const start = new Date(seriesStart.getTime() + i * 7 * DAY)
      return onTimeRate(mine, start, new Date(start.getTime() + 7 * DAY), now).rate
    })
    const opened = mine.filter(t => t.created_at >= from).length
    const openedBefore = mine.filter(t => t.created_at >= before && t.created_at < from).length
    return { org, active: active.length, overdue: overdue.length, paused: active.filter(t => t.status === 'pending').length, ...current, previous: previous.rate, weeks, opened, openedBefore }
  }).filter(c => c.active > 0 || c.rate !== null || c.opened > 0)

  const all = onTimeRate(tickets, from, now, now)
  const allBefore = onTimeRate(tickets, before, from, from)
  const top = (pick: (t: typeof tickets[number]) => string | null | undefined) => {
    const n = new Map<string, number>()
    for (const t of tickets) {
      if (t.resolved_at || t.status === 'pending' || t.sla_deadline >= now) continue
      const k = pick(t)
      if (k) n.set(k, (n.get(k) ?? 0) + 1)
    }
    const best = [...n].sort((a, b) => b[1] - a[1])[0]
    return best ? { name: best[0], count: best[1] } : null
  }
  // O mesmo grupo somado por pessoa não sai no relatório ao cliente: só o gestor vê.
  return {
    days, from, to: now,
    total: { rate: all.rate, done: all.done, late: all.late, previous: allBefore.rate, active: tickets.filter(t => (ACTIVE as readonly string[]).includes(t.status)).length },
    causes: { category: top(t => t.category?.name), person: top(t => t.assigned_to?.name), unassigned: tickets.filter(t => !t.resolved_at && !t.assigned_to && t.status !== 'pending' && t.sla_deadline < now).length },
    csat: { score: csat(fiveScale), responses: responses(fiveScale) },
    clients: clients
      .map(c => ({ ...c, csat: csat(fiveScale.filter(a => a.response.instance.ticket.org_id === c.org.id)) }))
      .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.overdue - a.overdue),
  }
}
