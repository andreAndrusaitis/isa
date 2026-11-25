import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'

// Troca de fila/categoria vira TicketEvent por qualquer caminho (inclusive
// "Responder ao Cliente", que não grava nota interna), e a subcategoria segue a categoria.
const SUFFIX = `qch-${Date.now()}`
let orgId: string, reqId: string, agentId: string, catA: string, subA: string, catB: string, queueA: string, queueB: string

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  queueA = (await prisma.queue.create({ data: { name: `Fila A ${SUFFIX}` } })).id
  queueB = (await prisma.queue.create({ data: { name: `Fila B ${SUFFIX}` } })).id
  agentId = (await prisma.user.create({ data: { name: `Agent ${SUFFIX}`, email: `agent-${SUFFIX}@t.com`, password: 'x', role: 'agent', queues: [queueA, queueB] } })).id
  catA = (await prisma.category.create({ data: { name: `Cat A ${SUFFIX}` } })).id
  subA = (await prisma.subcategory.create({ data: { name: `Sub A ${SUFFIX}`, category_id: catA } })).id
  catB = (await prisma.category.create({ data: { name: `Cat B ${SUFFIX}` } })).id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { user_id: reqId } }).catch(() => {})
  await prisma.subcategory.deleteMany({ where: { id: subA } }).catch(() => {})
  await prisma.category.deleteMany({ where: { id: { in: [catA, catB] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId] } } }).catch(() => {})
  await prisma.queue.deleteMany({ where: { id: { in: [queueA, queueB] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('updateTicket → histórico de fila e categoria', () => {
  it('registra a troca de fila e de categoria e limpa a subcategoria da categoria antiga', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId, assigned_to_id: agentId, queue: queueA, category_id: catA, subcategory_id: subA } as any)
    await prisma.ticket.update({ where: { id: ticket.id }, data: { queue: queueA, category_id: catA, subcategory_id: subA } })

    const updated = await TicketService.updateTicket(ticket.id, agentId, 'agent', { queue: queueB, categoryId: catB })

    expect(updated.subcategory_id).toBeNull()
    const notes = (await prisma.ticketEvent.findMany({ where: { ticket_id: ticket.id } })).map(e => e.note)
    expect(notes).toContain(`Alteração de fila: de Fila A ${SUFFIX} para Fila B ${SUFFIX}.`)
    expect(notes).toContain(`Alteração de categoria: de Cat A ${SUFFIX} / Sub A ${SUFFIX} para Cat B ${SUFFIX}.`)
  })

  it('subcategoria enviada vazia ("Geral") limpa a subcategoria', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: reqId, org_id: orgId, assigned_to_id: agentId } as any)
    await prisma.ticket.update({ where: { id: ticket.id }, data: { category_id: catA, subcategory_id: subA } })

    const updated = await TicketService.updateTicket(ticket.id, agentId, 'agent', { categoryId: catA, subcategoryId: '' })

    expect(updated.subcategory_id).toBeNull()
  })
})
