import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { getTimeSeries, getOverview } from './dashboard'

const SUFFIX = `dash-${Date.now()}`
let orgId: string
let userId: string
let ticketId: string

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `Org Dash ${SUFFIX}` }
  })
  orgId = org.id

  const user = await prisma.user.create({
    data: {
      name: `User Dash ${SUFFIX}`,
      email: `user-${SUFFIX}@test.com`,
      password: 'x',
      role: 'user',
      org_id: orgId
    }
  })
  userId = user.id

  const ticket = await prisma.ticket.create({
    data: {
      id: `TKT-${SUFFIX}`,
      display_number: `INC-${SUFFIX}`,
      title: 'Ticket for Dashboard testing',
      description: 'Testing time series',
      user_id: userId,
      org_id: orgId,
      status: 'open',
      priority: 'medium',
      sla_deadline: new Date(Date.now() + 86400000)
    }
  })
  ticketId = ticket.id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('Dashboard Overview & TimeSeries Service', () => {
  it('deve gerar série temporal diária (day) com exatamente 30 pontos e zero-fill', async () => {
    const series = await getTimeSeries({ org_id: orgId }, 'day')
    expect(series).toBeDefined()
    expect(series.length).toBe(30)

    // O último ponto deve ser hoje e conter o ticket criado
    const today = new Date().toISOString().slice(0, 10)
    const todayPoint = series.find(p => p.date === today)
    expect(todayPoint).toBeDefined()
    expect(todayPoint?.count).toBeGreaterThanOrEqual(1)
    expect(todayPoint?.tickets?.some(t => t.id === ticketId)).toBe(true)
  })

  it('deve gerar série temporal semanal (week) com exatamente 12 pontos e zero-fill', async () => {
    const series = await getTimeSeries({ org_id: orgId }, 'week')
    expect(series).toBeDefined()
    expect(series.length).toBe(12)

    // Pelo menos um ponto deve conter o ticket criado
    const pointWithTicket = series.find(p => p.tickets?.some(t => t.id === ticketId))
    expect(pointWithTicket).toBeDefined()
    expect(pointWithTicket?.count).toBeGreaterThanOrEqual(1)
  })

  it('deve gerar série temporal mensal (month) com exatamente 12 pontos e zero-fill', async () => {
    const series = await getTimeSeries({ org_id: orgId }, 'month')
    expect(series).toBeDefined()
    expect(series.length).toBe(12)

    const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const currentMonthPoint = series.find(p => p.date === currentMonth)
    expect(currentMonthPoint).toBeDefined()
    expect(currentMonthPoint?.count).toBeGreaterThanOrEqual(1)
    expect(currentMonthPoint?.tickets?.some(t => t.id === ticketId)).toBe(true)
  })

  it('deve retornar dados completos no getOverview', async () => {
    const overview = await getOverview('admin', 'admin-id', { orgId, period: 'month' })
    expect(overview).toBeDefined()
    expect(overview.counts).toBeDefined()
    expect(overview.counts.open).toBeGreaterThanOrEqual(1)
    expect(overview.timeSeries.length).toBe(12)
    expect(overview.priorityDist).toBeDefined()
    // Heatmap de demanda: 7 dias × 24 horas, e o chamado recém-aberto cai na célula de agora (fuso de Brasília).
    expect(overview.demand.matrix).toHaveLength(7)
    expect(overview.demand.matrix.every((row) => row.length === 24)).toBe(true)
    expect(overview.demand.total).toBe(1)
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value)
    expect(overview.demand.matrix[wd][Number(parts.find((p) => p.type === 'hour')!.value)]).toBe(1)
  })

  it('chamado resolvido pela IA fica fora do heatmap de demanda e entra no total próprio', async () => {
    const before = await getOverview('admin', 'admin-id', { orgId, period: 'month' })
    const ai = await prisma.ticket.create({
      data: {
        id: `TKT-IA-${SUFFIX}`, display_number: `INC-IA-${SUFFIX}`, title: 'Resolvido pela IA', description: 'd', status: 'resolved', ai_resolved: true,
        resolved_at: new Date(), user_id: userId, org_id: orgId, sla_deadline: new Date(Date.now() + 864e5),
      },
    })
    try {
      const after = await getOverview('admin', 'admin-id', { orgId, period: 'month' })
      expect(after.demand.total).toBe(before.demand.total)
      expect(after.counts.resolved).toBe(before.counts.resolved)
      expect(after.counts.ai_resolved).toBe(before.counts.ai_resolved + 1)

      // Reaberto volta a ser demanda: a volta à fila desliga a marca.
      await prisma.ticket.update({ where: { id: ai.id }, data: { status: 'open', ai_resolved: false } })
      expect((await getOverview('admin', 'admin-id', { orgId, period: 'month' })).demand.total).toBe(before.demand.total + 1)
    } finally {
      await prisma.ticket.deleteMany({ where: { id: ai.id } })
    }
  })
})
