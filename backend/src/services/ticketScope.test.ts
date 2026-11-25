import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'

const SUFFIX = `tktscope-${Date.now()}`
let orgAId: string, orgBId: string, reqId: string, agentId: string
let tInScope: string, tWrongOrg: string, tWrongQueue: string

beforeAll(async () => {
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: `OrgA ${SUFFIX}` } }),
    prisma.organization.create({ data: { name: `OrgB ${SUFFIX}` } }),
  ])
  orgAId = orgA.id; orgBId = orgB.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgAId } })
  reqId = req.id
  // Responsável ≠ solicitante: o solicitante sempre vê os próprios chamados (regra do escopo).
  agentId = (await prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })).id

  const base = { description: 'd', user_id: reqId, status: 'open' as const, sla_deadline: new Date(Date.now() + 86400000) }
  const [a, b, c] = await Promise.all([
    prisma.ticket.create({ data: { id: `TIN-${SUFFIX}`, display_number: `INC-TIN-${SUFFIX}`, title: 'in', org_id: orgAId, queue: 'q1', ...base } }),
    prisma.ticket.create({ data: { id: `TWO-${SUFFIX}`, display_number: `INC-TWO-${SUFFIX}`, title: 'wrongorg', org_id: orgBId, queue: 'q1', ...base } }),
    prisma.ticket.create({ data: { id: `TWQ-${SUFFIX}`, display_number: `INC-TWQ-${SUFFIX}`, title: 'wrongqueue', org_id: orgAId, queue: 'q9', ...base } }),
  ])
  tInScope = a.id; tWrongOrg = b.id; tWrongQueue = c.id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: [tInScope, tWrongOrg, tWrongQueue] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => {})
  await prisma.$disconnect()
})

describe('getTickets com escopo (interseção fila ∩ empresa)', () => {
  it('analista sem fila não vê nada pela carteira (fail-closed)', async () => {
    const { data } = await TicketService.getTickets({
      scope: { scopeAll: false, orgIds: [orgAId], queueIds: [], enforceQueues: true },
    })
    expect(data.map((t: any) => t.id)).not.toContain(tInScope)
  })

  it('responsável vê o chamado mesmo fora da carteira (envolvimento direto)', async () => {
    await prisma.ticket.update({ where: { id: tWrongOrg }, data: { assigned_to_id: agentId } })
    const { data } = await TicketService.getTickets({
      scope: { scopeAll: false, orgIds: [orgAId], queueIds: ['q1'], enforceQueues: true },
      scope_user_id: agentId,
    })
    await prisma.ticket.update({ where: { id: tWrongOrg }, data: { assigned_to_id: null } })
    const ids = data.map((t: any) => t.id)
    expect(ids).toContain(tWrongOrg)
    expect(ids).not.toContain(tWrongQueue)
  })

  it('solicitante vê os próprios chamados mesmo fora da carteira', async () => {
    const { data } = await TicketService.getTickets({
      scope: { scopeAll: false, orgIds: [orgAId], queueIds: ['q1'], enforceQueues: true },
      scope_user_id: reqId,
    })
    const ids = data.map((t: any) => t.id)
    expect(ids).toEqual(expect.arrayContaining([tInScope, tWrongOrg, tWrongQueue]))
  })

  it('filtro explícito de empresa não fura a carteira', async () => {
    const { data } = await TicketService.getTickets({
      org_id: orgBId,
      scope: { scopeAll: false, orgIds: [orgAId], queueIds: ['q1'], enforceQueues: true },
    })
    expect(data.map((t: any) => t.id)).not.toContain(tWrongOrg)
  })

  it('analista com atribuição vê só o ticket dentro de fila+empresa do escopo', async () => {
    const { data } = await TicketService.getTickets({
      scope: { scopeAll: false, orgIds: [orgAId], queueIds: ['q1'], enforceQueues: true },
    })
    const ids = data.map((t: any) => t.id)
    expect(ids).toContain(tInScope)
    expect(ids).not.toContain(tWrongOrg)
    expect(ids).not.toContain(tWrongQueue)
  })

  it('admin (scopeAll) vê os três', async () => {
    const { data } = await TicketService.getTickets({ scope: { scopeAll: true, orgIds: [], queueIds: [], enforceQueues: false } })
    const ids = data.map((t: any) => t.id)
    expect(ids).toContain(tInScope)
    expect(ids).toContain(tWrongOrg)
    expect(ids).toContain(tWrongQueue)
  })
})
