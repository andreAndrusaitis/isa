import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { errorHandler } from '../middlewares/errorHandler'
import ticketRoutes from '../routes/tickets'
import { TicketService } from './tickets'

const SUFFIX = `tcb-${Date.now()}`
let orgBId: string, userBId: string, catX: string
let orgId: string, reqId: string, agentId: string, catOk: string, catBlocked: string, subBlocked: string
const tickets: string[] = []

const app = express()
app.use(express.json())
app.use('/api/tickets', ticketRoutes)
app.use(errorHandler)
const token = (sub: string, role: string) => jwt.sign({ sub, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })

async function newTicket(categoryId: string): Promise<string> {
  const id = `TCB-${Date.now()}-${tickets.length}`
  await prisma.ticket.create({ data: {
    id, title: 'Teste', user_id: reqId, org_id: orgId, category_id: categoryId, priority: 'medium', assigned_to_id: agentId,
    display_number: `INC-${SUFFIX}-${tickets.length}`, sla_deadline: new Date(Date.now() + 864e5),
  } })
  tickets.push(id)
  return id
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `R ${SUFFIX}`, email: `r-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  agentId = (await prisma.user.create({ data: { name: `A ${SUFFIX}`, email: `a-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId } })).id
  catOk = (await prisma.category.create({ data: { name: `Ok ${SUFFIX}` } })).id
  catBlocked = (await prisma.category.create({ data: { name: `Bloq ${SUFFIX}` } })).id
  subBlocked = (await prisma.subcategory.create({ data: { name: `SubBloq ${SUFFIX}`, category_id: catBlocked } })).id
  await prisma.orgCategoryBlock.create({ data: { org_id: orgId, category_id: catBlocked } })
  orgBId = (await prisma.organization.create({ data: { name: `OrgB ${SUFFIX}` } })).id
  userBId = (await prisma.user.create({ data: { name: `RB ${SUFFIX}`, email: `rb-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgBId } })).id
  await prisma.userOrgScope.createMany({ data: [{ user_id: agentId, org_id: orgId }, { user_id: agentId, org_id: orgBId }] })
  catX = (await prisma.category.create({ data: { name: `X ${SUFFIX}` } })).id
  await prisma.orgCategoryBlock.create({ data: { org_id: orgBId, category_id: catX } })
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { OR: [{ id: { in: tickets } }, { user_id: reqId }] } })
  await prisma.userOrgScope.deleteMany({ where: { user_id: agentId } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId, userBId] } } })
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, orgBId] } } })
  await prisma.subcategory.deleteMany({ where: { id: subBlocked } })
  await prisma.category.deleteMany({ where: { id: { in: [catOk, catBlocked, catX] } } })
  await prisma.$disconnect()
})

describe('abertura com categoria desligada', () => {
  it('usuário final recebe 400 CATEGORY_NOT_AVAILABLE (categoria)', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${token(reqId, 'user')}`)
      .send({ title: 'x', description: 'y', categoryId: catBlocked })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('CATEGORY_NOT_AVAILABLE')
  })

  it('usuário final recebe 400 só com a subcategoria', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${token(reqId, 'user')}`)
      .send({ title: 'x', description: 'y', subcategoryId: subBlocked })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('CATEGORY_NOT_AVAILABLE')
  })
})

describe('cliente novo (newRequester) com categoria desligada', () => {
  it('analista recebe 400 e o cliente não é criado', async () => {
    const email = `nr-${SUFFIX}@t.com`
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${token(agentId, 'agent')}`)
      .send({ title: 'x', description: 'y', categoryId: catBlocked, newRequester: { name: `NR ${SUFFIX}`, email, orgId } })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('CATEGORY_NOT_AVAILABLE')
    expect(await prisma.user.count({ where: { email } })).toBe(0)
  })
})

describe('abertura com categoria liberada', () => {
  it('não é rejeitada pela regra', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${token(reqId, 'user')}`)
      .send({ title: 'x', description: 'y', categoryId: catOk })
    expect(res.status).toBe(201)
    expect(res.body.code).not.toBe('CATEGORY_NOT_AVAILABLE')
  })
})

describe('recategorização com categoria desligada', () => {
  it('analista não recategoriza para a desligada', async () => {
    const id = await newTicket(catOk)
    await expect(TicketService.updateTicket(id, agentId, 'agent', { category_id: catBlocked }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_AVAILABLE' })
  })

  it('integração (system) e regra de roteamento não são bloqueadas', async () => {
    const id1 = await newTicket(catOk)
    await expect(TicketService.updateTicket(id1, 'system', 'system', { category_id: catBlocked })).resolves.toBeDefined()
    const id2 = await newTicket(catOk)
    await expect(TicketService.updateTicket(id2, agentId, 'agent', { category_id: catBlocked }, { origin: 'routing' })).resolves.toBeDefined()
  })

  it('chamado que já está na desligada pode ser atualizado sem trocar a categoria', async () => {
    const id = await newTicket(catBlocked)
    await expect(TicketService.updateTicket(id, agentId, 'agent', { priority: 'high' })).resolves.toBeDefined()
  })

  it('troca de solicitante para empresa que desligou a categoria nova é bloqueada', async () => {
    const id = await newTicket(catOk)
    await expect(TicketService.updateTicket(id, agentId, 'agent', { requesterId: userBId, category_id: catX }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_AVAILABLE' })
  })

  it('trocar só o solicitante para empresa que desligou a categoria atual é bloqueado', async () => {
    const id = await newTicket(catX)
    await expect(TicketService.updateTicket(id, agentId, 'agent', { requesterId: userBId }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_AVAILABLE' })
  })
})
