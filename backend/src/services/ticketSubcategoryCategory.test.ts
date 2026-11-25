import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'

const SUFFIX = `subcat-${Date.now()}`
let orgId: string, reqId: string, agentId: string, catA: string, catB: string, subA: string

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  agentId = (await prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'supervisor', org_id: orgId } })).id
  catA = (await prisma.category.create({ data: { name: `Cat A ${SUFFIX}` } })).id
  catB = (await prisma.category.create({ data: { name: `Cat B ${SUFFIX}` } })).id
  subA = (await prisma.subcategory.create({ data: { name: `Sub A ${SUFFIX}`, category_id: catA } })).id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { user_id: reqId } }).catch(() => {})
  await prisma.subcategory.deleteMany({ where: { id: subA } }).catch(() => {})
  await prisma.category.deleteMany({ where: { id: { in: [catA, catB] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

const base = () => ({ title: `T ${SUFFIX}`, description: 'd', user_id: reqId, org_id: orgId })

describe('subcategoria × categoria', () => {
  it('createTicket recusa subcategoria de outra categoria', async () => {
    await expect(TicketService.createTicket({ ...base(), category_id: catB, subcategory_id: subA }))
      .rejects.toMatchObject({ code: 'SUBCATEGORY_CATEGORY_MISMATCH' })
  })

  it('createTicket sem categoria herda a categoria da subcategoria', async () => {
    const t = await TicketService.createTicket({ ...base(), subcategory_id: subA })
    expect(t!.categoryId).toBe(catA)
  })

  it('updateTicket recusa trocar só a subcategoria para uma de outra categoria', async () => {
    const t = await TicketService.createTicket({ ...base(), category_id: catB })
    await expect(TicketService.updateTicket(t!.id, agentId, 'supervisor', { subcategoryId: subA }))
      .rejects.toMatchObject({ code: 'SUBCATEGORY_CATEGORY_MISMATCH' })
  })

  it('updateTicket aceita categoria e subcategoria coerentes', async () => {
    const t = await TicketService.createTicket({ ...base(), category_id: catB })
    const u = await TicketService.updateTicket(t!.id, agentId, 'supervisor', { categoryId: catA, subcategoryId: subA })
    expect(u!.subcategoryId).toBe(subA)
  })
})
