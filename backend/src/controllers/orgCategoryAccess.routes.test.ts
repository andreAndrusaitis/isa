import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { errorHandler } from '../middlewares/errorHandler'
import categoryRoutes from '../routes/categories'
import orgRoutes from '../routes/organizations'

const SUFFIX = `ocar-${Date.now()}`
let cat: string, sla: string, orgIn: string, orgOut: string, adminId: string, mgrId: string, agentId: string, userId: string

const app = express()
app.use(express.json())
app.use('/api/categories', categoryRoutes)
app.use('/api/organizations', orgRoutes)
app.use(errorHandler)
const auth = (sub: string, role: string, orgId?: string) =>
  `Bearer ${jwt.sign({ sub, role, orgId, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })}`

beforeAll(async () => {
  const tier = `t-${SUFFIX}`
  cat = (await prisma.category.create({ data: { name: `Cat ${SUFFIX}` } })).id
  sla = (await prisma.slaConfig.create({ data: { tier, incident_first_response_hours: 1, incident_resolution_hours: 4 } })).id
  await prisma.planCategory.create({ data: { sla_config_id: sla, category_id: cat } })
  orgIn = (await prisma.organization.create({ data: { name: `In ${SUFFIX}`, tier } })).id
  orgOut = (await prisma.organization.create({ data: { name: `Out ${SUFFIX}`, tier } })).id
  const mk = async (role: string, org_id?: string) =>
    (await prisma.user.create({ data: { name: `${role} ${SUFFIX}`, email: `${role}-${SUFFIX}@t.com`, password: 'x', role: role as any, org_id } })).id
  adminId = await mk('admin'); mgrId = await mk('manager'); agentId = await mk('agent'); userId = await mk('user', orgIn)
  // Gerente só atende orgIn; o analista herda dele.
  await prisma.userOrgScope.create({ data: { user_id: mgrId, org_id: orgIn } })
  await prisma.user.update({ where: { id: agentId }, data: { manager_id: mgrId } })
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [adminId, mgrId] } } })
  await prisma.user.deleteMany({ where: { id: { in: [agentId, userId, mgrId, adminId] } } })
  await prisma.organization.deleteMany({ where: { id: { in: [orgIn, orgOut] } } })
  await prisma.slaConfig.deleteMany({ where: { id: sla } })
  await prisma.category.deleteMany({ where: { id: cat } })
  await prisma.$disconnect()
})

describe('rotas de acesso empresa × categoria', () => {
  it('gerente lista só as empresas da carteira', async () => {
    const res = await request(app).get(`/api/categories/${cat}/orgs`).set('Authorization', auth(mgrId, 'manager'))
    expect(res.status).toBe(200)
    expect(res.body.data.inPlan.map((o: any) => o.id)).toEqual([orgIn])
  })

  it('admin desabilita em lote; fora do escopo vira skipped para o gerente', async () => {
    const r1 = await request(app).put(`/api/categories/${cat}/orgs`).set('Authorization', auth(adminId, 'admin'))
      .send({ orgIds: [orgIn, orgOut], enabled: false })
    expect(r1.status).toBe(200)
    expect(r1.body.data.updated).toBe(2)
    const r2 = await request(app).put(`/api/categories/${cat}/orgs`).set('Authorization', auth(mgrId, 'manager'))
      .send({ orgIds: [orgOut], enabled: true })
    expect(r2.body.data).toEqual({ updated: 0, skipped: [{ id: orgOut, reason: 'OUT_OF_PLAN_OR_SCOPE' }] })
  })

  it('body inválido → 400', async () => {
    const res = await request(app).put(`/api/categories/${cat}/orgs`).set('Authorization', auth(adminId, 'admin'))
      .send({ orgIds: 'x', enabled: 'sim' })
    expect(res.status).toBe(400)
  })

  it('analista e usuário final não gerenciam', async () => {
    const a = await request(app).get(`/api/categories/${cat}/orgs`).set('Authorization', auth(agentId, 'agent'))
    const u = await request(app).put(`/api/categories/${cat}/orgs`).set('Authorization', auth(userId, 'user', orgIn)).send({ orgIds: [orgIn], enabled: true })
    expect(a.status).toBe(403)
    expect(u.status).toBe(403)
  })

  it('resumo por categoria', async () => {
    const res = await request(app).get('/api/categories/org-summary').set('Authorization', auth(adminId, 'admin'))
    expect(res.status).toBe(200)
    expect(res.body.data[cat]).toMatchObject({ total: expect.any(Number) })
  })

  it('analista lê as desligadas de uma empresa da carteira; fora dela, 403', async () => {
    await prisma.orgCategoryBlock.upsert({ where: { org_id_category_id: { org_id: orgIn, category_id: cat } }, update: {}, create: { org_id: orgIn, category_id: cat } })
    const ok = await request(app).get(`/api/organizations/${orgIn}/blocked-categories`).set('Authorization', auth(agentId, 'agent'))
    expect(ok.status).toBe(200)
    expect(ok.body.data).toEqual([cat])
    const no = await request(app).get(`/api/organizations/${orgOut}/blocked-categories`).set('Authorization', auth(agentId, 'agent'))
    expect(no.status).toBe(403)
  })
})
