import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { listTrash, restoreTicket, purgeTicket, purgeExpiredTickets, getTrashConfig } from './trash'

const SUFFIX = `trash-${Date.now()}`
let orgId: string, reqId: string, admId: string
const ids = [`TA-${SUFFIX}`, `TB-${SUFFIX}`]
const DAY = 86400000

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const req = await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  const adm = await prisma.user.create({ data: { name: `Adm ${SUFFIX}`, email: `adm-${SUFFIX}@t.com`, password: 'x', role: 'admin' } })
  reqId = req.id; admId = adm.id
  for (const id of ids) {
    await prisma.ticket.create({ data: { id, display_number: `INC-${id}`, title: `t ${id}`, description: 'd', user_id: reqId, org_id: orgId, status: 'open', sla_deadline: new Date(Date.now() + DAY) } })
    await prisma.ticketMessage.create({ data: { ticket_id: id, user_id: reqId, type: 'user', text: 'oi' } })
  }
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [reqId, admId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('Lixeira de chamados', () => {
  it('excluído some do sistema, aparece na Lixeira e volta ao restaurar', async () => {
    const [a] = ids
    await TicketService.deleteTicket(a, { actorId: admId })
    expect(await TicketService.getTicketById(a)).toBeNull()

    const trash = await listTrash({ page: 1, pageSize: 20, orgId })
    expect(trash.data.map(t => t.id)).toContain(a)
    expect(trash.data.find(t => t.id === a)!.deletedBy?.id).toBe(admId)

    await restoreTicket(a, { actorId: admId })
    const back = await TicketService.getTicketById(a)
    expect(back?.displayNumber ?? (back as any)?.display_number).toBe(`INC-${a}`)
    expect(await prisma.ticketMessage.count({ where: { ticket_id: a } })).toBe(1)
    expect((await listTrash({ page: 1, pageSize: 20, orgId })).data).toHaveLength(0)
  })

  it('visibility restringe a lista sem mexer na busca nem no filtro de empresa', async () => {
    const [a] = ids
    await TicketService.deleteTicket(a, { actorId: admId })
    const page = { page: 1, pageSize: 20 }

    expect((await listTrash({ ...page, orgId, visibility: { org_id: orgId } })).data.map(t => t.id)).toContain(a)
    expect((await listTrash({ ...page, orgId, visibility: { org_id: 'outra-empresa' } })).data).toHaveLength(0)
    expect((await listTrash({ ...page, search: a, visibility: { OR: [{ org_id: 'outra-empresa' }] } })).total).toBe(0)
    expect((await listTrash({ ...page, search: a, visibility: { OR: [{ org_id: orgId }] } })).total).toBe(1)

    await restoreTicket(a, { actorId: admId })
  })

  it('só apaga de vez o que está na Lixeira', async () => {
    await expect(purgeTicket(ids[0], { actorId: admId })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('job apaga de vez o que passou da retenção, com dependências', async () => {
    const [, b] = ids
    const config = await getTrashConfig()
    await prisma.ticket.update({ where: { id: b }, data: { deleted_at: new Date(Date.now() - (config.retention_days + 1) * DAY) } })
    await prisma.trashConfig.update({ where: { id: config.id }, data: { enabled: false } })
    expect(await purgeExpiredTickets()).toBe(0)
    await prisma.trashConfig.update({ where: { id: config.id }, data: { enabled: true } })

    expect(await purgeExpiredTickets()).toBeGreaterThanOrEqual(1)
    expect(await prisma.ticket.findUnique({ where: { id: b } })).toBeNull()
    expect(await prisma.ticketMessage.count({ where: { ticket_id: b } })).toBe(0)
    expect(await prisma.ticket.findUnique({ where: { id: ids[0] } })).not.toBeNull()
  })
})
