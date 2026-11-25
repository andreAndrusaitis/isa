import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../../../config/prisma'
import { SYSTEM_USER_ID } from '../../../utils/constants'
import { TicketService } from '../../../services/tickets'
import { recordTriageFeedback } from './feedback'

const SUFFIX = `aifb-${Date.now()}`
let subA: string, orgId: string, reqId: string, agentId: string, agent2Id: string, catA: string, catB: string
const tickets: string[] = []

async function newTicket(withRun: boolean, assignedTo?: string): Promise<string> {
  const id = `AIFB-${Date.now()}-${tickets.length}`
  await prisma.ticket.create({
    data: {
      id, title: 'Antivírus travou o PC', description: 'urgente', user_id: reqId, org_id: orgId, category_id: catA,
      priority: 'medium', display_number: `INC-8${Date.now() % 100000}${tickets.length}`,
      sla_deadline: new Date(Date.now() + 864e5), assigned_to_id: assignedTo,
    },
  })
  tickets.push(id)
  if (withRun) {
    await prisma.aiAgentRun.create({
      data: {
        agent: 'triage', ticket_id: id, mode: 'apply', model: 'm', prompt_version: 'v', status: 'ok', latency_ms: 1,
        result: {
          questions: [{ key: 'category', chosen: catA, chosenLabel: 'A' }, { key: 'subcategory', chosen: '__none__', chosenLabel: 'Nenhuma' }],
          priority: { value: 'medium' },
        },
      },
    })
  }
  return id
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  const mk = async (n: string, role: 'user' | 'agent') =>
    (await prisma.user.create({ data: { name: `${n} ${SUFFIX}`, email: `${n}-${SUFFIX}@t.com`, password: 'x', role, org_id: orgId } })).id
  reqId = await mk('req', 'user')
  agentId = await mk('ag', 'agent')
  agent2Id = await mk('ag2', 'agent')
  catA = (await prisma.category.create({ data: { name: `A ${SUFFIX}` } })).id
  catB = (await prisma.category.create({ data: { name: `B ${SUFFIX}` } })).id
  subA = (await prisma.subcategory.create({ data: { name: `SA ${SUFFIX}`, category_id: catA } })).id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: tickets } } }) // cascata: runs, feedback
  await prisma.subcategory.deleteMany({ where: { id: subA } })
  await prisma.category.deleteMany({ where: { id: { in: [catA, catB] } } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, agentId, agent2Id] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('feedback da triagem', () => {
  it('troca de categoria por pessoa via TicketService.updateTicket vira feedback', async () => {
    const id = await newTicket(true, agentId)
    await TicketService.updateTicket(id, agentId, 'agent', { category_id: catB })
    const fb = await prisma.aiFeedback.findMany({ where: { ticket_id: id } })
    expect(fb).toHaveLength(1)
    expect(fb[0]).toMatchObject({
      agent: 'triage', field: 'category', ai_value: catA, ai_label: 'A', from_value: catA, to_value: catB, user_id: agentId,
    })
  })

  it('troca de categoria não gera linha extra de subcategoria', async () => {
    const id = await newTicket(true, agentId)
    await prisma.aiAgentRun.updateMany({ where: { ticket_id: id }, data: { result: {
      questions: [{ key: 'category', chosen: catA, chosenLabel: 'A' }, { key: 'subcategory', chosen: 'sub-ai', chosenLabel: 'S' }],
      priority: { value: 'medium' },
    } } })
    await prisma.ticket.update({ where: { id }, data: { subcategory_id: subA } })
    await TicketService.updateTicket(id, agentId, 'agent', { category_id: catB })
    const fb = await prisma.aiFeedback.findMany({ where: { ticket_id: id } })
    expect(fb.map(f => f.field)).toEqual(['category'])
  })

  it('sem execução da IA não grava nada', async () => {
    const id = await newTicket(false)
    await recordTriageFeedback(id, { priority: 'medium' }, { priority: 'high' }, agentId)
    expect(await prisma.aiFeedback.count({ where: { ticket_id: id } })).toBe(0)
  })

  it('usuário do sistema não gera feedback; NONE da IA vira ai_value nulo', async () => {
    const id = await newTicket(true)
    await recordTriageFeedback(id, { priority: 'medium' }, { priority: 'high' }, SYSTEM_USER_ID)
    await recordTriageFeedback(id, { priority: 'medium' }, { priority: 'high' }, 'system')
    expect(await prisma.aiFeedback.count({ where: { ticket_id: id } })).toBe(0)
    await recordTriageFeedback(id, { subcategory_id: null }, { subcategory_id: 'sub-x' }, agentId)
    const fb = await prisma.aiFeedback.findMany({ where: { ticket_id: id } })
    expect(fb).toHaveLength(1)
    expect(fb[0]).toMatchObject({ field: 'subcategory', ai_value: null, ai_label: null, to_value: 'sub-x' })
  })
})

describe('first_assigned_at (trigger)', () => {
  it('preenche na 1ª atribuição e não sobrescreve na reatribuição', async () => {
    const id = await newTicket(false)
    expect((await prisma.ticket.findUnique({ where: { id } }))!.first_assigned_at).toBeNull()
    await prisma.ticket.update({ where: { id }, data: { assigned_to_id: agentId } })
    const first = (await prisma.ticket.findUnique({ where: { id } }))!.first_assigned_at
    expect(first).not.toBeNull()
    await new Promise(r => setTimeout(r, 20))
    await prisma.ticket.update({ where: { id }, data: { assigned_to_id: agent2Id } })
    expect((await prisma.ticket.findUnique({ where: { id } }))!.first_assigned_at).toEqual(first)
  })

  it('chamado criado já atribuído recebe a data', async () => {
    const id = await newTicket(false, agentId)
    expect((await prisma.ticket.findUnique({ where: { id } }))!.first_assigned_at).not.toBeNull()
  })
})
