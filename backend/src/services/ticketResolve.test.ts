import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'

const SUFFIX = `tktres-${Date.now()}`
let orgId: string, reqId: string, supId: string, mgrId: string
const ticketIds: string[] = []

async function newTicket(assigned_to_id: string | null = null) {
  const n = ticketIds.length
  const t = await prisma.ticket.create({ data: { id: `TR-${SUFFIX}-${n}`, display_number: `INC-TR-${SUFFIX}-${n}`, title: 'res', description: 'd', user_id: reqId, org_id: orgId, queue: 'q1', status: 'in_progress', assigned_to_id, sla_deadline: new Date(Date.now() + 86400000) } })
  ticketIds.push(t.id)
  return t.id
}

const RES = { status: 'resolved', resolution_details: 'Reiniciado o serviço de impressão.' }

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  // Carteira do TM: a empresa e a fila do chamado (para poder assumi-lo).
  const sup = await prisma.user.create({ data: { name: `Sup ${SUFFIX}`, email: `sup-${SUFFIX}@t.com`, password: 'x', role: 'supervisor', queues: ['q1'], org_scopes: { create: { org_id: orgId } } } })
  const mgr = await prisma.user.create({ data: { name: `Mgr ${SUFFIX}`, email: `mgr-${SUFFIX}@t.com`, password: 'x', role: 'manager' } })
  reqId = req.id; supId = sup.id; mgrId = mgr.id
})

afterAll(async () => {
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.surveyInstance.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [reqId, supId, mgrId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

// Ticket Manager e Gerente atendem como o analista: resolvem o que assumiram.
describe('updateTicket resolução por papel', () => {
  it('Ticket Manager que não é o responsável não resolve', async () => {
    const id = await newTicket()
    await expect(TicketService.updateTicket(id, supId, 'supervisor', RES)).rejects.toMatchObject({ statusCode: 403, code: 'ROLE_CANNOT_RESOLVE' })
  })

  it('Ticket Manager responsável resolve', async () => {
    const id = await newTicket(supId)
    const t = await TicketService.updateTicket(id, supId, 'supervisor', RES)
    expect(t.status).toBe('resolved')
  })

  it('Ticket Manager assume e resolve na mesma ação', async () => {
    const id = await newTicket()
    const t = await TicketService.updateTicket(id, supId, 'supervisor', { ...RES, assigned_to_id: supId })
    expect(t.status).toBe('resolved')
  })

  it('Gerente responsável resolve; com outro responsável, não', async () => {
    const mine = await newTicket(mgrId)
    expect((await TicketService.updateTicket(mine, mgrId, 'manager', RES)).status).toBe('resolved')
    const other = await newTicket(supId)
    await expect(TicketService.updateTicket(other, mgrId, 'manager', RES)).rejects.toMatchObject({ statusCode: 403, code: 'ROLE_CANNOT_RESOLVE' })
  })
})
