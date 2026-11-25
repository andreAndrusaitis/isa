// Prisma real contra o banco de teste (5434). Cleanup restrito aos IDs criados aqui.
//   DATABASE_URL=… DIRECT_URL=… npx vitest run --fileParallelism=false src/services/inactivityRedirect.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { runInactivityRedirectJob, raisedPriority, getInactivityConfig, upsertInactivityConfig, getRedirectLogs } from './inactivityRedirect'

describe('atribuição automática de chamados sem atendimento', () => {
  const tag = `${Date.now()}`
  const queue = `fila-inatividade-${tag}`
  const ticketIds: string[] = []
  let requesterId: string
  let agentId: string
  let otherAgentId: string
  let savedConfig: Awaited<ReturnType<typeof getInactivityConfig>>
  const old = new Date(Date.now() - 10 * 864e5) // 10 dias: passa de 24h úteis em qualquer dia da semana

  async function ticket(extra: Record<string, unknown> = {}) {
    const id = `INAT-${tag}-${ticketIds.length}`
    await prisma.ticket.create({
      data: { id, title: 'parado', description: 'x', user_id: requesterId, display_number: id, queue, priority: 'medium', sla_deadline: new Date(Date.now() + 864e5), created_at: old, ...extra },
    })
    ticketIds.push(id)
    return id
  }

  beforeAll(async () => {
    requesterId = (await prisma.user.create({ data: { name: 'Solicitante', email: `inat-req-${tag}@test.com`, role: 'user' } })).id
    agentId = (await prisma.user.create({ data: { name: 'Analista Fila', email: `inat-agt-${tag}@test.com`, role: 'agent', queues: [queue] } })).id
    otherAgentId = (await prisma.user.create({ data: { name: 'Analista Outro', email: `inat-agt2-${tag}@test.com`, role: 'agent', queues: ['outra'] } })).id
    savedConfig = await getInactivityConfig()
    await upsertInactivityConfig({ enabled: true, inactivity_hours: 24, target_priority: 'high', vip_queue_id: null })
  })

  afterAll(async () => {
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = savedConfig
    await upsertInactivityConfig(rest)
    await prisma.inactivityRedirectLog.deleteMany({ where: { ticket_id: { in: ticketIds } } })
    await prisma.notification.deleteMany({ where: { ticket_id: { in: ticketIds } } })
    await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: ticketIds } } })
    await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ticketIds } } })
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
    await prisma.user.deleteMany({ where: { id: { in: [requesterId, agentId, otherAgentId] } } })
  })

  describe('carteira', () => {
    let orgA: string, orgB: string, agentA: string, tmA: string
    const q = `fila-carteira-${tag}`

    beforeAll(async () => {
      orgA = (await prisma.organization.create({ data: { name: `Inat A ${tag}` } })).id
      orgB = (await prisma.organization.create({ data: { name: `Inat B ${tag}` } })).id
      agentA = (await prisma.user.create({ data: { name: 'Analista A', email: `inat-a-${tag}@test.com`, role: 'agent', queues: [q], org_scopes: { create: { org_id: orgA } } } })).id
      tmA = (await prisma.user.create({ data: { name: 'TM A', email: `inat-tm-${tag}@test.com`, role: 'supervisor', org_scopes: { create: { org_id: orgA } } } })).id
    })

    afterAll(async () => {
      await prisma.inactivityRedirectLog.deleteMany({ where: { new_assigned_to_id: agentA } })
      await prisma.ticket.updateMany({ where: { assigned_to_id: agentA }, data: { assigned_to_id: null } })
      await prisma.ticket.updateMany({ where: { org_id: { in: [orgA, orgB] } }, data: { org_id: null } })
      await prisma.user.deleteMany({ where: { id: { in: [agentA, tmA] } } })
      await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
    })

    it('fila compartilhada não leva chamado a quem não atende a empresa', async () => {
      const own = await ticket({ org_id: orgA, queue: q })
      const foreign = await ticket({ org_id: orgB, queue: q })
      await runInactivityRedirectJob({ force: true })
      const rows = await prisma.ticket.findMany({ where: { id: { in: [own, foreign] } } })
      const by = new Map(rows.map(r => [r.id, r.assigned_to_id]))
      expect(by.get(own)).toBe(agentA)
      expect(by.get(foreign)).toBeNull()
    })

    it('histórico mostra só o que a carteira enxerga', async () => {
      const foreign = await ticket({ org_id: orgB, queue: q })
      const log = await prisma.inactivityRedirectLog.create({
        data: { ticket_id: foreign, original_queue: q, new_assigned_to_id: agentA, previous_priority: 'medium', new_priority: 'high' },
      })
      expect(await getRedirectLogs({ ticketId: foreign }, { sub: tmA, role: 'supervisor' })).toMatchObject({ items: [], total: 0 })
      expect((await getRedirectLogs({ ticketId: foreign }, { sub: 'admin', role: 'admin' })).items.map(i => i.id)).toEqual([log.id])
    })
  })

  it('só atribui o aberto, sem analista, em que ninguém da equipe atuou', async () => {
    const untouched = await ticket()
    // Abrir em nome do cliente não é atuação; o solicitante cobrando também não.
    const openedByAgent = await ticket({ created_by_id: otherAgentId })
    await prisma.ticketEvent.create({ data: { ticket_id: openedByAgent, user_id: otherAgentId, to_status: 'open' } })
    await prisma.ticketMessage.create({ data: { ticket_id: untouched, user_id: requesterId, type: 'user', text: 'alguém?' } })

    const pending = await ticket({ status: 'pending', pending_reason: 'pending_user' })
    const assigned = await ticket({ assigned_to_id: otherAgentId })
    const withNote = await ticket()
    await prisma.ticketMessage.create({ data: { ticket_id: withNote, user_id: otherAgentId, type: 'internal', text: 'vendo' } })
    const statusTouched = await ticket()
    await prisma.ticketEvent.create({ data: { ticket_id: statusTouched, user_id: otherAgentId, from_status: 'in_progress', to_status: 'open' } })
    const high = await ticket({ priority: 'high' })

    await runInactivityRedirectJob({ force: true })

    const rows = await prisma.ticket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, assigned_to_id: true, priority: true } })
    const by = new Map(rows.map((r) => [r.id, r]))
    expect(by.get(untouched)).toMatchObject({ assigned_to_id: agentId, priority: 'high' })
    expect(by.get(openedByAgent)?.assigned_to_id).toBe(agentId)
    expect(by.get(high)).toMatchObject({ assigned_to_id: agentId, priority: 'high' })
    expect(by.get(pending)?.assigned_to_id).toBeNull()
    expect(by.get(assigned)?.assigned_to_id).toBe(otherAgentId)
    expect(by.get(withNote)?.assigned_to_id).toBeNull()
    expect(by.get(statusTouched)?.assigned_to_id).toBeNull()

    // Depois de atribuído sai da regra: uma segunda rodada não mexe de novo.
    await runInactivityRedirectJob({ force: true })
    expect(await prisma.inactivityRedirectLog.count({ where: { ticket_id: untouched } })).toBe(1)
  })

  it('prioridade só sobe, nunca rebaixa', () => {
    expect(raisedPriority('low', 'high')).toBe('high')
    expect(raisedPriority('high', 'medium')).toBe('high')
    expect(raisedPriority('medium', 'medium')).toBe('medium')
  })
})
