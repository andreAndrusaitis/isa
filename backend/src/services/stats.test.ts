// Prisma real contra o banco de teste (5434). Cleanup restrito aos IDs criados aqui.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { getAnalystStats, startOfDaySP } from './stats'

describe('indicadores do analista (sidebar)', () => {
  const tag = `stats-${Date.now()}`
  let agentId: string
  let requesterId: string
  const ids: string[] = []
  const min = 60_000

  async function ticket(data: Record<string, unknown>) {
    const id = `${tag}-${ids.length}`
    await prisma.ticket.create({ data: { id, display_number: id, title: 't', description: 'd', user_id: requesterId, assigned_to_id: agentId, sla_deadline: new Date(Date.now() + 864e5), ...data } })
    ids.push(id)
  }

  beforeAll(async () => {
    requesterId = (await prisma.user.create({ data: { name: 'Req', email: `${tag}-r@test.com`, role: 'user' } })).id
    agentId = (await prisma.user.create({ data: { name: 'Agt', email: `${tag}-a@test.com`, role: 'agent' } })).id
    const now = Date.now()
    await ticket({ status: 'open', sla_deadline: new Date(now + 10 * min) })          // vence em 10 min: conta
    await ticket({ status: 'in_progress', sla_deadline: new Date(now - 10 * min) })   // já vencido: não é "em breve"
    await ticket({ status: 'pending', sla_deadline: new Date(now + 10 * min) })       // SLA pausado: não conta
    await ticket({ status: 'resolved', resolved_at: new Date(now - 5 * min), created_at: new Date(now - 65 * min) })
  })

  afterAll(async () => {
    await prisma.ticket.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: [agentId, requesterId] } } })
  })

  it('"vencendo em breve" só conta o que ainda está no prazo e vence em 30 min; resolvido agora entra em hoje', async () => {
    const s = await getAnalystStats(agentId)
    expect(s.dueSoonCount).toBe(1)
    expect(s.resolvedToday).toBe(1)
    expect(s.avgResolutionMinutes).toBe(60)
  })

  it('"hoje" começa à meia-noite de Brasília, não de UTC', () => {
    // 13/10 01:30 UTC = 12/10 22:30 em Brasília → o dia é 12/10, que começa 03:00 UTC.
    expect(startOfDaySP(new Date('2026-10-13T01:30:00Z')).toISOString()).toBe('2026-10-12T03:00:00.000Z')
    expect(startOfDaySP(new Date('2026-10-13T15:00:00Z')).toISOString()).toBe('2026-10-13T03:00:00.000Z')
  })
})
