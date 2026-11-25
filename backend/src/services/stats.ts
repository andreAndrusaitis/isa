import prisma from '../config/prisma'

// shortcut: São Paulo sem horário de verão desde 2019 (UTC−3 fixo); se voltar, trocar pelo Intl.
const SP_OFFSET = 3 * 3_600_000

/** Meia-noite de Brasília do dia de `date` — no Azure o relógio é UTC e "hoje" virava às 21h. */
export function startOfDaySP(date: Date): Date {
  const local = new Date(date.getTime() - SP_OFFSET)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + SP_OFFSET)
}

function subMinutes(date: Date, minutes: number): Date {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - minutes)
  return d
}

function subDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - days)
  return d
}

export async function getAnalystStats(userId: string) {
  const now = new Date()
  const today = startOfDaySP(now)
  const yesterday = subDays(today, 1)
  const sameTimeYesterday = subDays(now, 1)
  const sevenDaysAgo = subDays(now, 7)
  const dueSoonThreshold = new Date(now.getTime() + 30 * 60000)

  // 1. Resolved Today (+ trend vs. yesterday same time)
  const [resolvedToday, resolvedYesterdaySameTime] = await Promise.all([
    prisma.ticket.count({
      where: {
        assigned_to_id: userId,
        deleted_at: null,
        status: { in: ['resolved', 'closed'] },
        resolved_at: { gte: today }
      }
    }),
    prisma.ticket.count({
      where: {
        assigned_to_id: userId,
        deleted_at: null,
        status: { in: ['resolved', 'closed'] },
        resolved_at: { gte: yesterday, lte: sameTimeYesterday }
      }
    })
  ])

  let resolvedTrend: 'up' | 'down' | 'flat' = 'flat'
  if (resolvedToday > resolvedYesterdaySameTime) resolvedTrend = 'up'
  else if (resolvedToday < resolvedYesterdaySameTime) resolvedTrend = 'down'

  // 2. SLA Compliance (Percentage of resolved/closed tickets within deadline)
  const allResolved = await prisma.ticket.findMany({
    where: {
      assigned_to_id: userId,
      deleted_at: null,
      status: { in: ['resolved', 'closed'] },
      resolved_at: { not: null }
    },
    select: {
      resolved_at: true,
      sla_deadline: true
    }
  })

  let slaCompliance = 100
  if (allResolved.length > 0) {
    const withinSla = allResolved.filter(t => t.resolved_at! <= t.sla_deadline).length
    slaCompliance = Math.round((withinSla / allResolved.length) * 100)
  }

  // 3. Average resolution time (last 7 days)
  const recentResolved = await prisma.ticket.findMany({
    where: {
      assigned_to_id: userId,
      deleted_at: null,
      status: { in: ['resolved', 'closed'] },
      resolved_at: { gte: sevenDaysAgo, not: null }
    },
    select: {
      created_at: true,
      resolved_at: true
    }
  })

  let avgResolutionMinutes = 0
  if (recentResolved.length > 0) {
    const totalMs = recentResolved.reduce((sum, t) =>
      sum + (t.resolved_at!.getTime() - t.created_at.getTime()), 0)
    avgResolutionMinutes = Math.round(totalMs / recentResolved.length / 60000)
  }

  // 4. Vencendo em breve: ainda no prazo e vence nos próximos 30 min. Vencido já não é
  // "em breve"; pendente tem o SLA pausado (o prazo é empurrado ao retomar).
  const dueSoonCount = await prisma.ticket.count({
    where: {
      assigned_to_id: userId,
      deleted_at: null,
      status: { in: ['open', 'in_progress'] },
      sla_deadline: { gt: now, lte: dueSoonThreshold }
    }
  })

  // 5. Reopened (last 7 days) — same is_reopened + window convention as dashboard.ts
  const reopenedCount = await prisma.ticket.count({
    where: {
      assigned_to_id: userId,
      deleted_at: null,
      is_reopened: true,
      created_at: { gte: sevenDaysAgo }
    }
  })

  return {
    resolvedToday,
    resolvedTrend,
    slaCompliance,
    avgResolutionMinutes,
    dueSoonCount,
    reopenedCount
  }
}

export async function getOnlineTeam() {
  // Activity in the last 15 minutes
  const fifteenMinutesAgo = subMinutes(new Date(), 15)

  const recentActivity = await prisma.auditLog.findMany({
    where: {
      created_at: { gte: fifteenMinutesAgo },
      user_id: { not: null },
      action: { not: 'LOGOUT' }
    },
    select: {
      user_id: true,
      created_at: true
    },
    orderBy: { created_at: 'desc' }
  })

  const uniqueUserIds = Array.from(new Set(recentActivity.map(a => a.user_id as string)))

  const onlineUsers = await prisma.user.findMany({
    where: {
      id: { in: uniqueUserIds },
      active: true,
      role: { not: 'user' } // Only show staff (agents, supervisors, admins)
    },
    select: {
      id: true,
      name: true,
      role: true
    }
  })

  // Sort: online (last 5m) vs away (5-15m)
  const fiveMinutesAgo = subMinutes(new Date(), 5)
  
  return onlineUsers.map(user => {
    const lastAction = recentActivity.find(a => a.user_id === user.id)
    const status = lastAction && lastAction.created_at >= fiveMinutesAgo ? 'online' : 'away'
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      status
    }
  }).sort((a, b) => {
    if (a.status === b.status) return a.name.localeCompare(b.name)
    return a.status === 'online' ? -1 : 1
  })
}
