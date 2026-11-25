import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// B1: um gerente (ou quem tinha "organograma") ligava "todas as empresas" em si
// mesmo por PATCH /manager-links/analysts/:id/global. A escrita agora é só do admin.

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  organization: { update: vi.fn(), findMany: vi.fn() },
  orgManagerLink: { findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
}))
const createAuditLogMock = vi.hoisted(() => vi.fn())

vi.mock('../config/env', () => ({ env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' } }))
vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../services/audit', () => ({ createAuditLog: createAuditLogMock }))

import router from './managerLinks'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/manager-links', router)
app.use(errorHandler)

const bearer = (role: string, permissions: string[] = []) =>
  `Bearer ${jwt.sign({ sub: `${role}-user`, role, orgId: null, permissions }, env.JWT_SECRET, { algorithm: 'HS256' })}`

const asUser = (role: string, permissions: string[] = []) =>
  prismaMock.user.findUnique.mockResolvedValue({ active: true, deleted_at: null, session_invalidated_at: null, role, permissions })

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.update.mockResolvedValue({ id: 'x', name: 'X', manager_global: true })
  prismaMock.organization.update.mockResolvedValue({ id: 'o', name: 'O', manager_global: true })
  prismaMock.orgManagerLink.upsert.mockResolvedValue({ id: 'l1' })
  prismaMock.orgManagerLink.delete.mockResolvedValue({ id: 'l1', org_id: 'o', manager_id: 'm' })
  prismaMock.organization.findMany.mockResolvedValue([])
  prismaMock.orgManagerLink.findMany.mockResolvedValue([])
  prismaMock.user.findMany.mockResolvedValue([])
})

describe('manager-links: escrita só do admin (B1)', () => {
  it('gerente não liga "todas as empresas" em si mesmo', async () => {
    asUser('manager')
    const res = await request(app).patch('/api/manager-links/analysts/manager-user/global')
      .set('Authorization', bearer('manager')).send({ managerGlobal: true })
    expect(res.status).toBe(403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('quem tem "organograma" também não liga em ninguém', async () => {
    asUser('supervisor', ['organograma'])
    const res = await request(app).patch('/api/manager-links/analysts/agent-1/global')
      .set('Authorization', bearer('supervisor', ['organograma'])).send({ managerGlobal: true })
    expect(res.status).toBe(403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('gerente não cria, não apaga vínculo nem marca empresa como global', async () => {
    asUser('manager')
    const auth = bearer('manager')
    expect((await request(app).post('/api/manager-links/orgs').set('Authorization', auth).send({ orgId: 'o', managerId: 'manager-user' })).status).toBe(403)
    expect((await request(app).delete('/api/manager-links/orgs/l1').set('Authorization', auth)).status).toBe(403)
    expect((await request(app).patch('/api/manager-links/orgs/o/global').set('Authorization', auth).send({ managerGlobal: true })).status).toBe(403)
    expect(prismaMock.orgManagerLink.upsert).not.toHaveBeenCalled()
    expect(prismaMock.orgManagerLink.delete).not.toHaveBeenCalled()
    expect(prismaMock.organization.update).not.toHaveBeenCalled()
  })

  it('admin liga e a ação fica na auditoria', async () => {
    asUser('admin')
    const res = await request(app).patch('/api/manager-links/analysts/agent-1/global')
      .set('Authorization', bearer('admin')).send({ managerGlobal: true })
    expect(res.status).toBe(200)
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_MANAGER_GLOBAL_SET', userId: 'admin-user', details: { userId: 'agent-1', managerGlobal: true },
    }))
  })

  it('id inexistente devolve 404', async () => {
    asUser('admin')
    prismaMock.user.update.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025', name: 'PrismaClientKnownRequestError' }))
    const res = await request(app).patch('/api/manager-links/analysts/nao-existe/global')
      .set('Authorization', bearer('admin')).send({ managerGlobal: true })
    expect(res.status).toBe(404)
  })

  it('leitura do próprio escopo continua para gerente e TM', async () => {
    for (const role of ['manager', 'supervisor']) {
      asUser(role)
      expect((await request(app).get('/api/manager-links/my/orgs').set('Authorization', bearer(role))).status).toBe(200)
      expect((await request(app).get('/api/manager-links/my/analysts').set('Authorization', bearer(role))).status).toBe(200)
    }
  })
})
