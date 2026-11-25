import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../../../config/prisma'
import { env } from '../../../config/env'
import { errorHandler } from '../../../middlewares/errorHandler'
import { TicketService } from '../../../services/tickets'
import guidanceRoutes, { DEFLECTED_RESOLUTION } from './routes'

const SUFFIX = `aiguidrt-${Date.now()}`
let orgId: string, reqId: string, otherReqId: string, agentId: string, adminId: string, exampleId: string, cardId: string
const ticketIds: string[] = []
let seq = 0

const app = express()
app.use(express.json())
app.use('/api/ai/guidance', guidanceRoutes)
app.use(errorHandler)
const bearer = (id: string, role: string) =>
  `Bearer ${jwt.sign({ sub: id, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

async function makeTicket(guidance_status: string | null, extra: Record<string, unknown> = {}) {
  const id = `AIGR-${Date.now()}-${seq++}`
  await prisma.ticket.create({
    data: { id, title: 'Outlook', user_id: reqId, org_id: orgId, guidance_status, display_number: `ISA-${id}`, sla_deadline: new Date(Date.now() + 864e5), ...extra },
  })
  ticketIds.push(id)
  return id
}

async function guidanceRun(ticketId: string, result: object) {
  await prisma.aiAgentRun.create({ data: { agent: 'guidance', ticket_id: ticketId, mode: 'apply', model: 'm', prompt_version: 'v', status: 'ok', latency_ms: 1, result } })
}

beforeAll(async () => {
  vi.spyOn(TicketService, 'broadcastTicketUpdate').mockResolvedValue(undefined as any)
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  otherReqId = (await prisma.user.create({ data: { name: `Req2 ${SUFFIX}`, email: `req2-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  agentId = (await prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId } })).id
  adminId = (await prisma.user.create({ data: { name: `Adm ${SUFFIX}`, email: `adm-${SUFFIX}@t.com`, password: 'x', role: 'admin', org_id: orgId } })).id
  cardId = (await prisma.aiExample.create({ data: { agent: 'resolution', source: 'ticket', source_id: `card-${SUFFIX}`, text: `Problema único ${SUFFIX}`, labels: { selfService: true, steps: ['Reinicie'], teamAction: '', sourceDisplay: 'ISA-1' }, embedding: [1, 0] } })).id
  exampleId = (await prisma.aiExample.create({ data: { agent: `resolution-${SUFFIX}`, source: 'ticket', source_id: 'x', text: 't', labels: {}, embedding: [1, 0] } })).id
})

afterAll(async () => {
  vi.restoreAllMocks()
  await prisma.aiExample.deleteMany({ where: { id: { in: [exampleId, cardId] } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [reqId, otherReqId, agentId, adminId] } } })
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, otherReqId, agentId, adminId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('respostas do solicitante', () => {
  it('"Resolveu" resolve o chamado como deflexão; segunda vez = 409', async () => {
    const id = await makeTicket('offered')
    const r = await request(app).post(`/api/ai/guidance/tickets/${id}/resolved`).set('Authorization', bearer(reqId, 'user'))
    expect(r.status).toBe(200)
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ status: 'resolved', guidance_status: 'deflected', resolution_details: DEFLECTED_RESOLUTION })
    const again = await request(app).post(`/api/ai/guidance/tickets/${id}/resolved`).set('Authorization', bearer(reqId, 'user'))
    expect(again.status).toBe(409)
  })

  it('só o solicitante do chamado responde', async () => {
    const id = await makeTicket('offered')
    expect((await request(app).post(`/api/ai/guidance/tickets/${id}/resolved`).set('Authorization', bearer(otherReqId, 'user'))).status).toBe(403)
    expect((await request(app).post(`/api/ai/guidance/tickets/${id}/resolved`).set('Authorization', bearer(agentId, 'agent'))).status).toBe(403)
    expect((await prisma.ticket.findUnique({ where: { id } }))?.guidance_status).toBe('offered')
  })

  it('"Não resolveu" mantém o chamado na fila', async () => {
    const id = await makeTicket('offered')
    expect((await request(app).post(`/api/ai/guidance/tickets/${id}/declined`).set('Authorization', bearer(reqId, 'user'))).status).toBe(200)
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ status: 'open', guidance_status: 'declined' })
  })

  it('vincular fecha o novo e cria o vínculo; o solicitante vê só o chamado relacionado', async () => {
    const older = await makeTicket(null)
    const id = await makeTicket('duplicate_offered')
    await guidanceRun(id, { duplicate: { ticket: { id: older, display_number: `ISA-${older}`, title: 'Outlook' }, isDuplicate: true } })
    const g = await request(app).get(`/api/ai/guidance/tickets/${id}`).set('Authorization', bearer(reqId, 'user'))
    expect(g.body.data).toEqual({ guidance_status: 'duplicate_offered', related: { id: older, display_number: `ISA-${older}`, title: 'Outlook' } })
    const r = await request(app).post(`/api/ai/guidance/tickets/${id}/link`).set('Authorization', bearer(reqId, 'user'))
    expect(r.status).toBe(200)
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ status: 'closed', guidance_status: 'linked' })
    expect(await prisma.ticketLink.findFirst({ where: { ticket_id: id, related_id: older } })).toMatchObject({ kind: 'duplicate', created_by_id: reqId })
  })

  it('"É outro problema" libera a orientação normal', async () => {
    const id = await makeTicket('duplicate_offered')
    const r = await request(app).post(`/api/ai/guidance/tickets/${id}/not-duplicate`).set('Authorization', bearer(reqId, 'user'))
    expect(r.status).toBe(200)
    expect((await prisma.ticket.findUnique({ where: { id } }))?.guidance_status).toBeNull()
  })
})

describe('equipe', () => {
  it('analista vê a última execução completa', async () => {
    const id = await makeTicket('offered', { assigned_to_id: agentId })
    await guidanceRun(id, { guidance: { steps: [{ text: 'x', source: 'C1' }] } })
    const r = await request(app).get(`/api/ai/guidance/tickets/${id}`).set('Authorization', bearer(agentId, 'agent'))
    expect(r.status).toBe(200)
    expect(r.body.data.run.result.guidance.steps).toHaveLength(1)
  })

  it('👎 desativa o cartão; solicitante não pode', async () => {
    expect((await request(app).patch(`/api/ai/guidance/examples/${exampleId}/disable`).set('Authorization', bearer(reqId, 'user'))).status).toBe(403)
    expect((await request(app).patch(`/api/ai/guidance/examples/${exampleId}/disable`).set('Authorization', bearer(agentId, 'agent'))).status).toBe(200)
    expect((await prisma.aiExample.findUnique({ where: { id: exampleId } }))?.active).toBe(false)
    expect((await request(app).patch('/api/ai/guidance/examples/nao-existe/disable').set('Authorization', bearer(agentId, 'agent'))).status).toBe(404)
  })
})

describe('base de resoluções (Motor IA)', () => {
  it('admin busca, desativa e reativa um cartão; outros papéis não', async () => {
    const auth = bearer(adminId, 'admin')
    const list = await request(app).get('/api/ai/guidance/examples').query({ q: `único ${SUFFIX}` }).set('Authorization', auth)
    expect(list.status).toBe(200)
    expect(list.body.data).toMatchObject([{ id: cardId, active: true, selfService: true, steps: ['Reinicie'], sourceDisplay: 'ISA-1' }])
    expect(list.body.total).toBeGreaterThanOrEqual(1)
    expect((await request(app).patch(`/api/ai/guidance/examples/${cardId}`).set('Authorization', auth).send({ active: false })).status).toBe(200)
    const off = await request(app).get('/api/ai/guidance/examples').query({ q: `único ${SUFFIX}`, active: 'false' }).set('Authorization', auth)
    expect(off.body.data.map((c: any) => c.id)).toEqual([cardId])
    expect((await request(app).patch(`/api/ai/guidance/examples/${cardId}`).set('Authorization', auth).send({ active: true })).status).toBe(200)
    expect((await prisma.aiExample.findUnique({ where: { id: cardId } }))?.active).toBe(true)
    expect((await request(app).get('/api/ai/guidance/examples').set('Authorization', bearer(agentId, 'agent'))).status).toBe(403)
    expect((await request(app).patch(`/api/ai/guidance/examples/${cardId}`).set('Authorization', bearer(agentId, 'agent')).send({ active: false })).status).toBe(403)
  })
})
