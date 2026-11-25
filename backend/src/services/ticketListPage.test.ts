import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService, buildTicketListWhere } from './tickets'

const SUFFIX = `tktpage-${Date.now()}`
let orgId: string, reqId: string
const ids: string[] = []

// Todos os filtros restringem à empresa do teste — independente do resto do banco.
const where = (q: Parameters<typeof buildTicketListWhere>[0] = {}) => buildTicketListWhere({ orgId, ...q }, {}, reqId)
const page = (q: Parameters<typeof buildTicketListWhere>[0], opts: Partial<Parameters<typeof TicketService.getTicketsPage>[1]> = {}) =>
  TicketService.getTicketsPage(where(q), { page: 1, pageSize: 25, sort: 'date', dir: 'desc', ...opts })

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  reqId = req.id

  const hour = 3600_000
  // 7 chamados: 5 abertos com SLA crescente, 1 vencido, 1 resolvido
  const specs = [
    ...[1, 2, 3, 4, 5].map(i => ({ title: `Impressora ${i}`, status: 'open' as const, sla: 48 * hour + i * hour, assigned: true })),
    { title: 'Vencido', status: 'in_progress' as const, sla: -hour, assigned: true },
    { title: 'Concluído', status: 'resolved' as const, sla: 10 * hour, assigned: true },
  ]
  for (const [i, s] of specs.entries()) {
    const t = await prisma.ticket.create({
      data: {
        id: `TP${i}-${SUFFIX}`, display_number: `REQ-${SUFFIX}-${i}`, title: s.title, description: 'd',
        user_id: reqId, org_id: orgId, status: s.status, sla_deadline: new Date(Date.now() + s.sla),
        assigned_to_id: s.assigned ? reqId : null, created_at: new Date(Date.now() - (10 - i) * 60_000),
      },
    })
    ids.push(t.id)
  }
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: reqId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('getTicketsPage', () => {
  it('pagina no servidor e devolve o total filtrado', async () => {
    const p1 = await page({}, { pageSize: 3 })
    const p3 = await page({}, { pageSize: 3, page: 3 })
    expect(p1.total).toBe(7)
    expect(p1.data).toHaveLength(3)
    expect(p3.data).toHaveLength(1)
    expect(p1.data[0].id).toBe(ids[6]) // mais recente primeiro
  })

  it('busca casa título e número exibido (REQ-…)', async () => {
    expect((await page({ search: 'impressora' })).total).toBe(5)
    const byNumber = await page({ search: `REQ-${SUFFIX}-5` })
    expect(byNumber.data.map(t => t.id)).toEqual([ids[5]])
  })

  it('status "active" exclui resolvidos/fechados', async () => {
    expect((await page({ status: ['active'] })).total).toBe(6)
  })

  it('filtros aceitam vários valores (status + empresa)', async () => {
    expect((await page({ status: ['open', 'in_progress'] })).total).toBe(6)
    expect((await page({ status: ['in_progress', 'resolved'], orgId: [orgId, 'outra'] })).total).toBe(2)
  })

  it('analistas + "Sem responsável" somam (OR) e nunca saem da carteira', async () => {
    expect((await page({ unassigned: true })).total).toBe(0)
    expect((await page({ assignedToId: ['outro'], unassigned: true })).total).toBe(0)
    expect((await page({ assignedToId: ['outro', reqId], unassigned: true })).total).toBe(7)
    const foraDaCarteira = buildTicketListWhere({ orgId: [orgId], assignedToId: [reqId] }, { org_id: 'outra' }, reqId)
    expect((await TicketService.getTicketsPage(foraDaCarteira, { page: 1, pageSize: 25, sort: 'date', dir: 'desc' })).total).toBe(0)
  })

  it('"Sem responsável" não traz chamado resolvido pela IA, que nunca foi da equipe', async () => {
    const data = { title: 't', description: 'd', user_id: reqId, org_id: orgId, sla_deadline: new Date(Date.now() + 3600_000) }
    const [ai, human] = await Promise.all([
      prisma.ticket.create({ data: { ...data, id: `TPIA-${SUFFIX}`, display_number: `REQ-${SUFFIX}-IA`, status: 'resolved', ai_resolved: true } }),
      prisma.ticket.create({ data: { ...data, id: `TPHU-${SUFFIX}`, display_number: `REQ-${SUFFIX}-HU`, status: 'open' } }),
    ])
    try {
      expect((await page({ unassigned: true })).data.map(t => t.id)).toEqual([human.id])
      expect((await page({ assignedToId: ['outro'], unassigned: true })).data.map(t => t.id)).toEqual([human.id])
      // Só o filtro exclui: fora dele o chamado segue listado, com a marca que a tela usa.
      expect((await page({ status: ['resolved'] })).data.find(t => t.id === ai.id)).toMatchObject({ aiResolved: true })
    } finally {
      await prisma.ticket.deleteMany({ where: { id: { in: [ai.id, human.id] } } })
    }
  })

  it('recortes da Visão geral: IA (resolvido ou já fechado), resolvido e fechado pela equipe', async () => {
    const data = { title: 't', description: 'd', user_id: reqId, org_id: orgId, sla_deadline: new Date(Date.now() + 3600_000) }
    const made = await Promise.all([
      prisma.ticket.create({ data: { ...data, id: `TPA1-${SUFFIX}`, display_number: `REQ-${SUFFIX}-A1`, status: 'resolved', ai_resolved: true } }),
      prisma.ticket.create({ data: { ...data, id: `TPA2-${SUFFIX}`, display_number: `REQ-${SUFFIX}-A2`, status: 'closed', ai_resolved: true } }),
      prisma.ticket.create({ data: { ...data, id: `TPC1-${SUFFIX}`, display_number: `REQ-${SUFFIX}-C1`, status: 'closed' } }),
    ])
    try {
      const idsOf = async (status: string[]) => (await page({ status })).data.map(t => t.id).sort()
      expect(await idsOf(['ai_resolved'])).toEqual([`TPA1-${SUFFIX}`, `TPA2-${SUFFIX}`].sort())
      expect(await idsOf(['team_resolved'])).toEqual([ids[6]])
      expect(await idsOf(['team_closed'])).toEqual([`TPC1-${SUFFIX}`])
      expect(await idsOf(['team_resolved', 'team_closed'])).toEqual([ids[6], `TPC1-${SUFFIX}`].sort())
    } finally {
      await prisma.ticket.deleteMany({ where: { id: { in: made.map(t => t.id) } } })
    }
  })

  it('urgência: vencido primeiro, resolvido por último', async () => {
    const { data } = await page({}, { sort: 'urgency', dir: 'asc' })
    expect(data[0].id).toBe(ids[5])
    expect(data[data.length - 1].id).toBe(ids[6])
  })

  it('ordenação calculada respeita a página pedida', async () => {
    const all = (await page({}, { sort: 'urgency', dir: 'asc' })).data.map(t => t.id)
    const p2 = (await page({}, { sort: 'urgency', dir: 'asc', pageSize: 2, page: 2 })).data.map(t => t.id)
    expect(p2).toEqual(all.slice(2, 4))
  })

  it('contadores: ativos (aberto/em atendimento), meus e por status', async () => {
    const counts = await TicketService.getTicketCounts(where(), reqId)
    expect(counts.total).toBe(6)
    expect(counts.my).toBe(6)
    expect(counts.status_open).toBe(5)
    expect(counts.status_resolved).toBe(1)
  })

  it('contagem agrupada por responsável e por solicitante', async () => {
    expect(await TicketService.getGroupedCounts(where(), 'assignee')).toEqual({ [reqId]: { open: 5, in_progress: 1, resolved: 1 } })
    expect((await TicketService.getGroupedCounts(where(), 'requester'))[reqId].open).toBe(5)
  })
})
