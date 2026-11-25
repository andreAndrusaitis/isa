import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../../../config/prisma'
import { env } from '../../../config/env'
import { errorHandler } from '../../../middlewares/errorHandler'
import { TicketService } from '../../../services/tickets'
import intakeRoutes from './routes'

const SUFFIX = `aiintakert-${Date.now()}`
let orgId: string, org2Id: string, adminId: string, agentId: string, reqId: string, foreignId: string, ticketId: string, otherTicketId: string, adminTicketId: string, deletedTicketId: string
const itemIds: string[] = []

const app = express()
app.use(express.json())
app.use('/api/ai/intake', intakeRoutes)
app.use(errorHandler)
const bearer = (id: string, role: string) =>
  `Bearer ${jwt.sign({ sub: id, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  adminId = (await prisma.user.create({ data: { name: `Adm ${SUFFIX}`, email: `adm-${SUFFIX}@t.com`, password: 'x', role: 'admin', org_id: orgId } })).id
  agentId = (await prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId } })).id
  reqId = (await prisma.user.create({ data: { name: `Req ${SUFFIX}`, email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  org2Id = (await prisma.organization.create({ data: { name: `Org2 ${SUFFIX}` } })).id
  foreignId = (await prisma.user.create({ data: { name: `Fo ${SUFFIX}`, email: `fo-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: org2Id } })).id
  adminTicketId = `AIINA-${Date.now()}`
  deletedTicketId = `AIIND-${Date.now()}`
  ticketId = `AIINR-${Date.now()}`
  otherTicketId = `AIINS-${Date.now()}`
  for (const [id, st] of [[ticketId, 'incomplete'], [otherTicketId, 'complete'], [adminTicketId, 'incomplete'], [deletedTicketId, 'incomplete']]) {
    await prisma.ticket.create({
      data: {
        id, title: 'x', user_id: reqId, org_id: orgId, assigned_to_id: agentId, intake_status: st,
        display_number: `INC-${id}`, deleted_at: id === deletedTicketId ? new Date() : null, sla_deadline: new Date(Date.now() + 864e5),
      },
    })
  }
})

afterAll(async () => {
  await prisma.intakeChecklistItem.deleteMany({ where: { id: { in: itemIds } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [adminId, agentId] } } })
  await prisma.ticket.deleteMany({ where: { id: { in: [ticketId, otherTicketId, adminTicketId, deletedTicketId] } } })
  await prisma.user.deleteMany({ where: { id: { in: [adminId, agentId, reqId, foreignId] } } })
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, org2Id] } } })
  await prisma.$disconnect()
})

const item = { type: 'incident', key: `teste_${Date.now()}`, label: 'Teste', criterion: 'O chamado informa o teste.', question: 'Qual é o teste?' }
const admin = () => bearer(adminId, 'admin')

describe('rotas do intake', () => {
  it('admin cria, lista e edita item do checklist', async () => {
    const created = await request(app).post('/api/ai/intake/checklist').set('Authorization', admin()).send(item)
    expect(created.status).toBe(201)
    itemIds.push(created.body.data.id)
    expect(created.body.data).toMatchObject({ ...item, kind: 'text', required: true, active: true })

    const list = await request(app).get('/api/ai/intake/checklist').set('Authorization', admin())
    expect(list.body.data.some((i: any) => i.id === created.body.data.id)).toBe(true)

    const upd = await request(app).put(`/api/ai/intake/checklist/${created.body.data.id}`).set('Authorization', admin()).send({ active: false })
    expect(upd.body.data.active).toBe(false)
  })

  it('PUT parcial não reaplica defaults', async () => {
    const created = await request(app).post('/api/ai/intake/checklist').set('Authorization', admin())
      .send({ ...item, key: `parcial_${Date.now()}`, required: false, sort: 7, kind: 'evidence' })
    itemIds.push(created.body.data.id)
    const upd = await request(app).put(`/api/ai/intake/checklist/${created.body.data.id}`).set('Authorization', admin()).send({ active: false })
    expect(upd.body.data).toMatchObject({ active: false, required: false, sort: 7, kind: 'evidence', type: 'incident' })
  })

  it('valida a key do item', async () => {
    const r = await request(app).post('/api/ai/intake/checklist').set('Authorization', admin()).send({ ...item, key: 'Com Espaço' })
    expect(r.status).toBe(400)
  })

  it('PUT de id inexistente dá 404 e campo inválido dá 400', async () => {
    const nf = await request(app).put('/api/ai/intake/checklist/nao-existe').set('Authorization', admin()).send({ active: false })
    expect(nf.status).toBe(404)
    const bad = await request(app).put(`/api/ai/intake/checklist/${itemIds[0]}`).set('Authorization', admin()).send({ kind: 'xyz' })
    expect(bad.status).toBe(400)
  })

  it('analista não edita o checklist', async () => {
    const r = await request(app).get('/api/ai/intake/checklist').set('Authorization', bearer(agentId, 'agent'))
    expect(r.status).toBe(403)
  })

  it('dispensar só altera chamado incompleto (idempotente)', async () => {
    const r = await request(app).post(`/api/ai/intake/tickets/${otherTicketId}/dismiss`).set('Authorization', bearer(agentId, 'agent'))
    expect(r.status).toBe(200)
    expect(r.body.data.intake_status).toBe('complete')
    expect((await prisma.ticket.findUnique({ where: { id: otherTicketId } }))?.intake_status).toBe('complete')
  })

  it('analista com acesso dispensa a marca; solicitante não', async () => {
    const denied = await request(app).post(`/api/ai/intake/tickets/${ticketId}/dismiss`).set('Authorization', bearer(reqId, 'user'))
    expect(denied.status).toBe(403)
    const ok = await request(app).post(`/api/ai/intake/tickets/${ticketId}/dismiss`).set('Authorization', bearer(agentId, 'agent'))
    expect(ok.status).toBe(200)
    expect((await prisma.ticket.findUnique({ where: { id: ticketId } }))?.intake_status).toBe('dismissed')
  })

  it('admin é somente leitura em chamados: não dispensa', async () => {
    const r = await request(app).post(`/api/ai/intake/tickets/${adminTicketId}/dismiss`).set('Authorization', admin())
    expect(r.status).toBe(403)
  })
})

describe('rotas do intake: validações e acesso', () => {
  const post = (b: object) => request(app).post('/api/ai/intake/checklist').set('Authorization', admin()).send(b)
  const dismiss = (id: string, tok: string) => request(app).post(`/api/ai/intake/tickets/${id}/dismiss`).set('Authorization', tok)

  it('subcategoria inexistente dá 400 no POST e no PUT', async () => {
    const r = await post({ ...item, key: `sub_${Date.now()}`, subcategory_id: 'nao-existe' })
    expect(r.status).toBe(400)
    expect(r.body.error?.code ?? r.body.code).toBe('INVALID_SUBCATEGORY')
    const ok = await post({ ...item, key: `sub2_${Date.now()}` })
    itemIds.push(ok.body.data.id)
    const u = await request(app).put(`/api/ai/intake/checklist/${ok.body.data.id}`).set('Authorization', admin()).send({ subcategory_id: 'nao-existe' })
    expect(u.status).toBe(400)
  })

  it('chave duplicada (tipo + subcategoria + key) dá 409 no POST e no PUT', async () => {
    const key = `dup_${Date.now()}`
    const a = await post({ ...item, key, active: false })
    expect(a.status).toBe(201)
    itemIds.push(a.body.data.id)
    expect((await post({ ...item, key })).status).toBe(409)
    const other = await post({ ...item, key: `dup2_${Date.now()}` })
    itemIds.push(other.body.data.id)
    const u = await request(app).put(`/api/ai/intake/checklist/${other.body.data.id}`).set('Authorization', admin()).send({ key })
    expect(u.status).toBe(409)
    // outro tipo com a mesma key é permitido; editar o próprio item sem mudar a key também
    const diffType = await post({ ...item, key, type: 'request' })
    expect(diffType.status).toBe(201)
    itemIds.push(diffType.body.data.id)
    const self = await request(app).put(`/api/ai/intake/checklist/${a.body.data.id}`).set('Authorization', admin()).send({ label: 'Novo rótulo' })
    expect(self.status).toBe(200)
  })

  it('analista não cria nem edita item', async () => {
    const tok = bearer(agentId, 'agent')
    expect((await request(app).post('/api/ai/intake/checklist').set('Authorization', tok).send(item)).status).toBe(403)
    expect((await request(app).put(`/api/ai/intake/checklist/${itemIds[0]}`).set('Authorization', tok).send({ active: true })).status).toBe(403)
  })

  it('analista de outra organização sem atribuição não dispensa', async () => {
    const r = await dismiss(adminTicketId, bearer(foreignId, 'agent'))
    expect(r.status).toBe(403)
    expect((await prisma.ticket.findUnique({ where: { id: adminTicketId } }))?.intake_status).toBe('incomplete')
  })

  it('chamado excluído ou inexistente dá 404', async () => {
    expect((await dismiss(deletedTicketId, bearer(agentId, 'agent'))).status).toBe(404)
    expect((await dismiss('nao-existe', bearer(agentId, 'agent'))).status).toBe(404)
  })

  it('dispensar transmite a atualização do chamado', async () => {
    const t = `AIINB-${Date.now()}`
    await prisma.ticket.create({ data: { id: t, title: 'x', user_id: reqId, org_id: orgId, assigned_to_id: agentId, intake_status: 'incomplete', display_number: `INC-${t}`, sla_deadline: new Date(Date.now() + 864e5) } })
    const spy = vi.spyOn(TicketService, 'broadcastTicketUpdate').mockResolvedValue(undefined as any)
    try {
      expect((await dismiss(t, bearer(agentId, 'agent'))).status).toBe(200)
      expect(spy).toHaveBeenCalledWith(t)
      spy.mockClear()
      expect((await dismiss(t, bearer(agentId, 'agent'))).status).toBe(200)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      await prisma.ticket.deleteMany({ where: { id: t } })
    }
  })

  it('dispensar grava auditoria', async () => {
    const t = `AIINU-${Date.now()}`
    await prisma.ticket.create({ data: { id: t, title: 'x', user_id: reqId, org_id: orgId, assigned_to_id: agentId, intake_status: 'incomplete', display_number: `INC-${t}`, sla_deadline: new Date(Date.now() + 864e5) } })
    try {
      expect((await dismiss(t, bearer(agentId, 'agent'))).status).toBe(200)
      expect(await prisma.auditLog.count({ where: { user_id: agentId, action: 'DISMISS_INTAKE_FLAG', resource: 'TICKET', details: { path: ['ticketId'], equals: t } } })).toBe(1)
    } finally {
      await prisma.ticket.deleteMany({ where: { id: t } })
    }
  })
})
