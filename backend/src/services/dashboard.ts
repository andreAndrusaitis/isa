import prisma from '../config/prisma'
import { multi } from '../utils/multiFilter'
import { getEffectiveScope, scopeTicketWhere, scopeOrgWhere } from './scope'
import { getBusinessHoursConfig } from './businessHours'
import { ticketVisibilityWhere } from './ticketAccess'
import { addBusinessHours, getBusinessMinutesBetween, holidaysAround } from '../utils/businessHours'

// Chave AAAA-MM-DD na data local: toISOString() converte para UTC e, à noite
// (fuso -03), jogava o chamado numa "semana" inexistente e ele sumia do gráfico.
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ticket.queue guarda o id da fila; os dashboards exibem o nome.
// Id sem fila cadastrada (legado) passa como está.
async function withQueueNames<T extends { queue: string | null }>(rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.map(r => r.queue).filter((id): id is string => !!id))]
  if (!ids.length) return rows
  const queues = await prisma.queue.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  const nameById = new Map(queues.map(q => [q.id, q.name]))
  return rows.map(r => ({ ...r, queue: (r.queue && nameById.get(r.queue)) || r.queue }))
}

// Page 1: Overview — tickets summary + time series
export async function getOverview(role: string, managerId: string, params: {
  period?: string
  orgId?: string
  queue?: string
  status?: string
  priority?: string
}) {
  const where = await buildTicketWhere(role, managerId, params)

  const [totals, timeSeries, priorityDist, queueDistRaw, demand] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['status', 'ai_resolved'],
      where,
      _count: { _all: true }
    }),
    getTimeSeries(where, params.period || 'month'),
    prisma.ticket.groupBy({
      by: ['priority'],
      where,
      _count: { _all: true }
    }),
    prisma.ticket.groupBy({
      by: ['queue'],
      where,
      _count: { _all: true }
    }),
    getDemandHeatmap(where),
  ])

  // Resolvido pela IA é um total próprio, com ou sem o fechamento automático: entra
  // uma vez só, e a soma dos cards segue igual ao total de chamados. Reabrir desliga a marca.
  const counts = { open: 0, in_progress: 0, pending: 0, resolved: 0, ai_resolved: 0, closed: 0 }
  for (const g of totals) counts[g.ai_resolved ? 'ai_resolved' : g.status as keyof typeof counts] += g._count._all

  const queueDist = await withQueueNames(queueDistRaw)

  return { counts, timeSeries, priorityDist, queueDist, demand }
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const SP_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })

/**
 * Demanda por dia da semana × hora de abertura (fuso de Brasília), últimos `days`
 * dias com os mesmos filtros do painel: dimensiona a escala de analistas, por isso
 * fica de fora o que a IA resolveu sem chegar à fila.
 * matrix[weekday 0=dom][hora 0–23] = chamados abertos.
 */
export async function getDemandHeatmap(where: any, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.ticket.findMany({
    where: { ...where, deleted_at: null, ai_resolved: false, created_at: { gte: since } },
    select: { created_at: true },
  })
  const matrix = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const { created_at } of rows) {
    const parts = SP_PARTS.formatToParts(created_at)
    const wd = WEEKDAY_INDEX[parts.find(p => p.type === 'weekday')!.value]
    const hour = Number(parts.find(p => p.type === 'hour')!.value) % 24
    matrix[wd][hour]++
  }
  return { days, total: rows.length, matrix }
}

export async function getTimeSeries(where: any, period: string = 'month') {
  const now = new Date()
  // count = o que chegou à equipe; aiResolved = o que a IA resolveu sem fila. `tickets` lista os dois.
  const buckets = new Map<string, { count: number; aiResolved: number; tickets: { id: string }[] }>()
  const empty = () => ({ count: 0, aiResolved: 0, tickets: [] })

  if (period === 'day') {
    // Últimos 30 dias contínuos
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      buckets.set(key, empty())
    }
  } else if (period === 'week') {
    // Últimas 12 semanas contínuas (segunda-feira como início)
    const currentMonday = new Date(now)
    const dayOfWeek = currentMonday.getDay()
    const diffToMonday = (dayOfWeek + 6) % 7
    currentMonday.setDate(currentMonday.getDate() - diffToMonday)
    currentMonday.setHours(0, 0, 0, 0)

    for (let i = 11; i >= 0; i--) {
      const w = new Date(currentMonday)
      w.setDate(w.getDate() - i * 7)
      const key = localDateKey(w)
      buckets.set(key, empty())
    }
  } else if (period === 'year') {
    // Últimos 5 anos
    const currentYear = now.getFullYear()
    for (let i = 4; i >= 0; i--) {
      const yr = (currentYear - i).toString()
      buckets.set(yr, empty())
    }
  } else {
    // Padrão: 'month' (Últimos 12 meses contínuos)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      buckets.set(key, empty())
    }
  }

  const firstKey = Array.from(buckets.keys())[0]
  let cutoffDate: Date
  if (period === 'day' || period === 'week') {
    cutoffDate = new Date(`${firstKey}T00:00:00.000Z`)
  } else if (period === 'year') {
    cutoffDate = new Date(`${firstKey}-01-01T00:00:00.000Z`)
  } else {
    cutoffDate = new Date(`${firstKey}-01T00:00:00.000Z`)
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      ...where,
      deleted_at: null,
      created_at: { gte: cutoffDate }
    },
    select: { id: true, created_at: true, status: true, ai_resolved: true }
  })

  for (const t of tickets) {
    const d = new Date(t.created_at)
    let key: string

    if (period === 'day') {
      key = d.toISOString().slice(0, 10)
    } else if (period === 'week') {
      const wDate = new Date(d)
      const dow = wDate.getDay()
      const diff = (dow + 6) % 7
      wDate.setDate(wDate.getDate() - diff)
      key = localDateKey(wDate)
    } else if (period === 'year') {
      key = d.getFullYear().toString()
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }

    if (buckets.has(key)) {
      const b = buckets.get(key)!
      if (t.ai_resolved) b.aiResolved += 1
      else b.count += 1
      b.tickets.push({ id: t.id })
    }
  }

  return Array.from(buckets.entries())
    .map(([date, data]) => ({ date, ...data }))
}

// Page 2: Productivity — analyst ranking
export async function getProductivity(role: string, managerId: string, params: {
  period?: string
  orgId?: string
}) {
  // Ticket Manager vê a própria equipe (subordinados diretos).
  const analystIds = role === 'supervisor'
    ? (await prisma.user.findMany({ where: { manager_id: managerId, active: true, deleted_at: null }, select: { id: true } })).map(u => u.id)
    : null

  const since = getPeriodStart(params.period || '30d')
  const analystFilter = analystIds ? { id: { in: analystIds } } : {}

  const analysts = await prisma.user.findMany({
    where: { ...analystFilter, role: { in: ['agent', 'supervisor'] }, active: true, deleted_at: null },
    select: { id: true, name: true, avatar: true, role: true }
  })

  if (analysts.length === 0) return []

  const analystIdList = analysts.map(a => a.id)
  // Mesma carteira dos outros painéis: o analista pode ter chamado de empresa que o gestor não vê.
  const ticketWhere = await buildTicketWhere(role, managerId, { orgId: params.orgId })

  // 2 queries para todos os analistas em vez de 5×N queries no loop
  const [allTickets, activeTicketsRaw] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        ...ticketWhere,
        assigned_to_id: { in: analystIdList },
        ...(since ? { created_at: { gte: since } } : {})
      },
      select: {
        assigned_to_id: true,
        status: true,
        is_reopened: true,
        created_at: true,
        resolved_at: true,
        sla_deadline: true,
      }
    }),
    prisma.ticket.findMany({
      where: {
        ...ticketWhere,
        assigned_to_id: { in: analystIdList },
        status: { in: ['open', 'in_progress', 'pending'] },
      },
      select: {
        id: true, display_number: true, title: true, status: true, priority: true, queue: true,
        assigned_to_id: true,
        updated_at: true, sla_deadline: true,
        org: { select: { id: true, name: true } }
      },
      orderBy: { sla_deadline: 'asc' }
    })
  ])

  const activeTicketsFull = await withQueueNames(activeTicketsRaw)
  const results = analysts.map(analyst => {
    const analystTickets = allTickets.filter(t => t.assigned_to_id === analyst.id)

    const active = analystTickets.filter(t => ['open', 'in_progress', 'pending'].includes(t.status)).length
    const resolved = analystTickets.filter(t => ['resolved', 'closed'].includes(t.status)).length
    const reopened = analystTickets.filter(t => t.is_reopened).length

    const resolvedWithDate = analystTickets.filter(t =>
      ['resolved', 'closed'].includes(t.status) && t.resolved_at !== null
    )

    let avgResolutionHours = 0
    let slaCount = 0
    if (resolvedWithDate.length > 0) {
      const totalMs = resolvedWithDate.reduce((sum, t) =>
        sum + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()), 0)
      avgResolutionHours = Math.round(totalMs / resolvedWithDate.length / 3600000 * 10) / 10
      slaCount = resolvedWithDate.filter(t => new Date(t.resolved_at!) <= new Date(t.sla_deadline)).length
    }

    const slaRate = resolvedWithDate.length > 0 ? Math.round((slaCount / resolvedWithDate.length) * 100) : 100

    const activeTickets = activeTicketsFull
      .filter(t => t.assigned_to_id === analyst.id)
      .slice(0, 10)
      .map(({ assigned_to_id: _aid, ...rest }) => rest)

    return {
      analyst: { id: analyst.id, name: analyst.name, avatar: analyst.avatar, role: analyst.role },
      active,
      resolved,
      reopened,
      avgResolutionHours,
      slaRate,
      activeTickets
    }
  })

  return results.sort((a, b) => b.resolved - a.resolved)
}

// Page 3: Management — unassigned tickets with time alerts
// Só lista o que o gestor pode atribuir: mesma regra do PATCH /tickets/:id
// (getTicketAccess). Antes listava tudo e o OK devolvia 403 em chamado de
// empresa/fila fora da carteira.
export async function getManagement(role: string, managerId: string, params: {
  queue?: string
  priority?: string
  orgId?: string
}) {
  const baseWhere: any = {
    deleted_at: null,
    queue: multi(params.queue),
    priority: multi(params.priority),
    org_id: multi(params.orgId),
  }

  const unassigned = await withQueueNames(await prisma.ticket.findMany({
    where: {
      ...baseWhere,
      assigned_to_id: null,
      status: { in: ['open', 'in_progress', 'pending'] },
      ...ticketVisibilityWhere(managerId, await getEffectiveScope(managerId, role)),
    },
    select: {
      id: true, display_number: true, title: true, status: true, priority: true, queue: true,
      created_at: true, updated_at: true, sla_deadline: true,
      org: { select: { id: true, name: true, tier: true } },
      category: { select: { id: true, name: true } }
    },
    orderBy: { created_at: 'asc' }
  }))

  const now = Date.now()
  const categorized = unassigned.map(t => {
    const hoursOpen = (now - new Date(t.created_at).getTime()) / 3600000
    let level: 'attention' | 'alert' | 'critical' | 'evidence'
    if (hoursOpen > 5) level = 'evidence'
    else if (hoursOpen >= 3) level = 'critical'
    else if (hoursOpen >= 1) level = 'alert'
    else level = 'attention'
    return { ...t, hoursOpen: Math.round(hoursOpen * 10) / 10, level }
  })

  const summary = {
    total: categorized.length,
    attention: categorized.filter(t => t.level === 'attention').length,
    alert: categorized.filter(t => t.level === 'alert').length,
    critical: categorized.filter(t => t.level === 'critical').length,
    evidence: categorized.filter(t => t.level === 'evidence').length,
  }

  // All active agents available for assignment (no scope restriction — anyone can be assigned)
  const agents = await prisma.user.findMany({
    where: { role: { in: ['agent', 'supervisor'] }, active: true, deleted_at: null },
    select: { id: true, name: true, avatar: true }
  })

  return { tickets: categorized, summary, agents }
}

// Page 4: Corporations — orgs with queues and active ticket stats
export async function getCorporations(role: string, managerId: string, params: {
  orgId?: string
  queue?: string
}) {
  // Mesma carteira da lista de chamados (antes o TM usava vínculos OrgManagerLink).
  const scope = role === 'admin' ? null : await getEffectiveScope(managerId, role)

  const orgs = await prisma.organization.findMany({
    where: {
      AND: [
        scope ? scopeOrgWhere(scope) : {},
        { id: multi(params.orgId) },
      ],
      active: true,
      deleted_at: null,
    },
    include: {
      sla_config: true,
      queues: true,
      tickets: {
        where: {
          status: { in: ['open', 'in_progress', 'pending'] },
          deleted_at: null
        },
        select: {
          id: true, status: true, priority: true, queue: true,
          sla_deadline: true, assigned_to_id: true
        }
      }
    },
    orderBy: { name: 'asc' }
  })

  return Promise.all(orgs.map(async org => {
    const queueStats = org.queues.map(q => {
      const qTickets = org.tickets.filter(t => t.queue === q.id)
      const overdue = qTickets.filter(t => t.status !== 'pending' && new Date(t.sla_deadline) < new Date())
      const assigned = [...new Set(qTickets.map(t => t.assigned_to_id).filter(Boolean))]
      return {
        queue: { id: q.id, name: q.name, color: q.color },
        active: qTickets.length,
        overdue: overdue.length,
        analysts: assigned.length
      }
    })

    const activeCount = org.tickets.length
    const overdueCount = org.tickets.filter(t => t.status !== 'pending' && new Date(t.sla_deadline) < new Date()).length

    return {
      org: {
        id: org.id, name: org.name, tier: org.tier,
        slaHours: (org as any).sla_config?.incident_resolution_hours ?? 24, managerGlobal: org.manager_global
      },
      activeTickets: activeCount,
      overdueTickets: overdueCount,
      queueStats
    }
  }))
}

// Page 5: Inactivity — tickets with no updates in N days
export async function getInactivity(role: string, managerId: string, params: {
  analystId?: string
  queue?: string
  orgId?: string
  priority?: string
  useBusinessDays?: boolean
}) {
  const baseWhere = await buildTicketWhere(role, managerId, params)

  const tickets = await prisma.ticket.findMany({
    where: {
      ...baseWhere,
      status: { in: ['open', 'in_progress', 'pending'] }
    },
    select: {
      id: true, display_number: true, title: true, status: true, priority: true, queue: true,
      updated_at: true, created_at: true, sla_deadline: true, assigned_to_id: true,
      org: { select: { id: true, name: true } },
      assigned_to: { select: { id: true, name: true } },
      messages: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { created_at: true, type: true, user_id: true }
      }
    },
    orderBy: { updated_at: 'asc' }
  })

  const now = Date.now()
  const annotated = (await withQueueNames(tickets)).map(t => {
    const lastActivity = t.messages.length > 0
      ? new Date(t.messages[0].created_at).getTime()
      : new Date(t.updated_at).getTime()

    const lastMsg = t.messages[0]
    let lastBy: 'client' | 'agent' | 'system' = 'system'
    if (lastMsg) {
      if (lastMsg.type === 'user') lastBy = 'client'
      else if (lastMsg.type === 'agent' || lastMsg.type === 'internal') lastBy = 'agent'
    }

    const inactiveDays = Math.floor((now - lastActivity) / 86400000)
    let level: 'monitor' | 'attention' | 'alert' | 'critical'
    if (inactiveDays >= 4) level = 'critical'
    else if (inactiveDays >= 3) level = 'alert'
    else if (inactiveDays >= 2) level = 'attention'
    else level = 'monitor'

    return {
      id: t.id, display_number: t.display_number, title: t.title, status: t.status, priority: t.priority,
      queue: t.queue, slaDeadline: t.sla_deadline,
      org: t.org, assignedTo: t.assigned_to,
      lastActivity: new Date(lastActivity).toISOString(),
      lastBy, inactiveDays, level
    }
  })

  const filtered = annotated.filter(t => t.inactiveDays >= 1)

  const summary = {
    total: filtered.length,
    monitor: filtered.filter(t => t.level === 'monitor').length,
    attention: filtered.filter(t => t.level === 'attention').length,
    alert: filtered.filter(t => t.level === 'alert').length,
    critical: filtered.filter(t => t.level === 'critical').length,
  }

  return { tickets: filtered, summary }
}

// Page 6: SLA Expiring — tickets whose SLA is about to expire (within 4 hours)
export async function getSlaExpiring(role: string, managerId: string, params: {
  queue?: string
  priority?: string
  orgId?: string
}) {
  const baseWhere = await buildTicketWhere(role, managerId, params)

  // Janela e restante em horas ÚTEIS: fora do expediente o SLA não corre.
  const now = new Date()
  const bh = await getBusinessHoursConfig()
  const holidays = holidaysAround(now)
  const fourHoursFromNow = addBusinessHours(now, 4, bh, holidays)

  const tickets = await prisma.ticket.findMany({
    where: {
      ...baseWhere,
      status: { in: ['open', 'in_progress'] },
      sla_deadline: {
        gt: now,
        lte: fourHoursFromNow
      }
    },
    select: {
      id: true, display_number: true, title: true, status: true, priority: true, queue: true,
      created_at: true, sla_deadline: true,
      org: { select: { id: true, name: true, tier: true } },
      assigned_to: { select: { id: true, name: true } }
    },
    orderBy: { sla_deadline: 'asc' }
  })

  const annotated = (await withQueueNames(tickets)).map(t => {
    const minutesRemaining = getBusinessMinutesBetween(now, new Date(t.sla_deadline), bh, holidays)
    let level: 'critical' | 'alert' | 'attention'
    if (minutesRemaining <= 30) level = 'critical'
    else if (minutesRemaining <= 120) level = 'alert'
    else level = 'attention'

    return {
      id: t.id, display_number: t.display_number, title: t.title, status: t.status, priority: t.priority,
      queue: t.queue, slaDeadline: t.sla_deadline,
      createdAt: t.created_at,
      org: t.org, assignedTo: t.assigned_to,
      minutesRemaining, level
    }
  })

  // Em projeto com a previsão da task vencida (roadmap ID 1.4): o SLA está pausado,
  // mas o cliente segue esperando — conta como risco.
  const forecastRows = await prisma.ticket.findMany({
    where: {
      ...baseWhere,
      status: 'pending', pending_reason: 'pending_project',
      project_task: { due_date: { lt: now }, archived_at: null, status: { category: { notIn: ['done', 'cancelled'] } } },
    },
    select: {
      id: true, display_number: true, title: true, status: true, priority: true, queue: true,
      org: { select: { id: true, name: true, tier: true } },
      assigned_to: { select: { id: true, name: true } },
      project_task: { select: { id: true, key: true, seq: true, title: true, due_date: true, project: { select: { id: true, name: true } } } },
    },
    orderBy: { project_task: { due_date: 'asc' } },
  })
  const forecastOverdue = (await withQueueNames(forecastRows)).map(t => ({
    id: t.id, display_number: t.display_number, title: t.title, status: t.status, priority: t.priority, queue: t.queue,
    org: t.org, assignedTo: t.assigned_to,
    task: { id: t.project_task!.id, key: t.project_task!.key ?? `#${t.project_task!.seq}`, title: t.project_task!.title, dueDate: t.project_task!.due_date, project: t.project_task!.project },
    overdueDays: Math.max(1, Math.floor((now.getTime() - t.project_task!.due_date!.getTime()) / 86_400_000)),
  }))

  const summary = {
    total: annotated.length + forecastOverdue.length,
    critical: annotated.filter(t => t.level === 'critical').length,
    alert: annotated.filter(t => t.level === 'alert').length,
    attention: annotated.filter(t => t.level === 'attention').length,
    forecastOverdue: forecastOverdue.length,
  }

  return { tickets: annotated, forecastOverdue, summary }
}

// Builds ticket WHERE filter respecting manager scope
async function buildTicketWhere(role: string, managerId: string, params: any) {
  const where: any = { deleted_at: null }

  // MAN-002/SUP-003: usa o MESMO escopo efetivo da lista de chamados
  // (getEffectiveScope) para que os números do dashboard batam com a fila de
  // tickets. Antes o dashboard usava um filtro próprio (org_id OR assigned_to_id)
  // mais restritivo, fazendo o overview mostrar menos chamados do que a lista.
  if (role !== 'admin') {
    // AND: filtros do painel (org/fila) nunca ampliam além da carteira.
    const byScope = scopeTicketWhere(await getEffectiveScope(managerId, role))
    if (byScope.AND) where.AND = byScope.AND
  }

  where.org_id = multi(params.orgId)
  where.queue = multi(params.queue)
  where.status = multi(params.status)
  where.priority = multi(params.priority)
  where.assigned_to_id = multi(params.analystId)

  return where
}

function getPeriodStart(period: string): Date | null {
  const now = new Date()
  if (period === '7d') return new Date(now.getTime() - 7 * 86400000)
  if (period === '30d') return new Date(now.getTime() - 30 * 86400000)
  if (period === '90d') return new Date(now.getTime() - 90 * 86400000)
  if (period === '365d') return new Date(now.getTime() - 365 * 86400000)
  return null
}
