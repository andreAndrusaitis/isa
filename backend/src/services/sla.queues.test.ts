import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { createSlaConfig, updateSlaConfig } from './sla'
import { TicketService } from './tickets'

// Fila padrão / de escalonamento do plano: só filas cadastradas, e a troca vale
// para os próximos chamados da empresa.
const S = `slaq-${Date.now()}`
let q1: string, q2: string, planId: string, orgId: string, reqId: string
const ticketIds: string[] = []

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.queue.create({ data: { id: `${S}-a`, name: `Diagnóstico ${S}` } as any }),
    prisma.queue.create({ data: { id: `${S}-b`, name: `Mesa ${S}` } as any }),
  ])
  q1 = a.id; q2 = b.id
  const plan = await createSlaConfig({ tier: S, incident_first_response_hours: 4, incident_resolution_hours: 24, default_queue: q1, escalation_queue: q2 })
  planId = plan.id
  const org = await prisma.organization.create({ data: { name: `Org ${S}`, tier: S } })
  orgId = org.id
  reqId = (await prisma.user.create({ data: { name: `Req ${S}`, email: `req-${S}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
})

afterAll(async () => {
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: reqId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.slaConfig.deleteMany({ where: { id: planId } }).catch(() => {})
  await prisma.queue.deleteMany({ where: { id: { in: [q1, q2] } } }).catch(() => {})
  await prisma.$disconnect()
})

const newTicket = async () => {
  const t = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId }, reqId)
  ticketIds.push(t!.id)
  return t!
}

describe('fila padrão e de escalonamento do plano', () => {
  it('recusa criar plano com fila que não existe (fila fantasma), explicando', async () => {
    await expect(createSlaConfig({ tier: `${S}-x`, incident_first_response_hours: 4, incident_resolution_hours: 24, default_queue: 'fila-que-nao-existe', escalation_queue: q2 }))
      .rejects.toMatchObject({ statusCode: 400, code: 'QUEUE_NOT_FOUND' })
  })

  it('recusa trocar para fila inexistente e mantém a anterior', async () => {
    await expect(updateSlaConfig(planId, { escalation_queue: 'fila-que-nao-existe' })).rejects.toMatchObject({ code: 'QUEUE_NOT_FOUND' })
    const plan = await prisma.slaConfig.findUnique({ where: { id: planId } })
    expect(plan!.escalation_queue).toBe(q2)
  })

  it('chamado novo cai na fila padrão do plano', async () => {
    expect((await newTicket()).queue).toBe(q1)
  })

  it('trocar a fila padrão vale para os próximos chamados', async () => {
    const updated = await updateSlaConfig(planId, { default_queue: q2, escalation_queue: q1 })
    expect(updated.default_queue).toBe(q2)
    expect(updated.escalation_queue).toBe(q1)
    expect((await newTicket()).queue).toBe(q2)
  })

  it('atualizar outro campo não reseta as filas (sem padrão "geral" escondido)', async () => {
    const updated = await updateSlaConfig(planId, { escalation_minutes: 45 })
    expect(updated.default_queue).toBe(q2)
    expect(updated.escalation_queue).toBe(q1)
  })
})
