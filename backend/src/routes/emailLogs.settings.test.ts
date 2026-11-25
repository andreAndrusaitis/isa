import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  organization: { findMany: vi.fn() },
  emailLog: { groupBy: vi.fn() },
  inboundEmail: { findMany: vi.fn(), count: vi.fn() },
  emailBlock: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
}))
const graphMock = vi.hoisted(() => ({
  isGraphConfigured: vi.fn(() => true),
  certificateInfo: vi.fn(() => ({ subject: 'ISA - E-mail', validTo: '2028-10-29T12:05:34.000Z', thumbprint: '5CDC' })),
  getInboxSummary: vi.fn(async () => ({ totalItemCount: 924, unreadItemCount: 207 })),
}))
const auditMock = vi.hoisted(() => vi.fn())

vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-with-at-least-32-chars',
    MAIL_GRAPH_TENANT_ID: 'tenant-1',
    MAIL_GRAPH_CLIENT_ID: 'client-1',
    MAIL_GRAPH_MAILBOX: 'atendimento@example.com',
    MAIL_GRAPH_CERT: 'SEGREDO-CERTIFICADO',
    MAIL_GRAPH_PRIVATE_KEY: 'SEGREDO-CHAVE-PRIVADA',
    AZURE_COMMUNICATION_CONNECTION_STRING: 'endpoint=https://x;accesskey=SEGREDO-ACS',
    AZURE_EMAIL_SENDER: 'DoNotReply@x.azurecomm.net',
    MAIL_INBOUND_ENABLED: false,
  },
}))
vi.mock('../services/email/graph', () => graphMock)
vi.mock('../services/audit', () => ({ createAuditLog: auditMock }))

import router from './emailLogs'
import { errorHandler } from '../middlewares/errorHandler'

const app = express()
app.use(express.json())
app.use('/api/email-logs', router)
app.use(errorHandler)

const bearer = (role: string) => `Bearer ${jwt.sign({ sub: `${role}-user`, role }, 'test-secret-with-at-least-32-chars', { algorithm: 'HS256' })}`

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve({
    id: where.id, role: where.id.replace('-user', ''), active: true, deleted_at: null, session_invalidated_at: null, queues: [], org_scopes: [],
  }))
  prismaMock.organization.findMany.mockResolvedValue([{ id: 'o1', name: 'Cafeteria Fiorde', active: true }])
  prismaMock.emailLog.groupBy.mockResolvedValue([{ status: 'SUCCESS', _count: { _all: 12 } }])
  prismaMock.inboundEmail.findMany.mockResolvedValue([])
  prismaMock.inboundEmail.count.mockResolvedValue(0)
})

describe('Admin → E-mail: configuração', () => {
  it('mostra o estado sem expor certificado, chave nem a chave do ACS', async () => {
    const res = await request(app).get('/api/email-logs/settings').set('Authorization', bearer('admin'))
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('SEGREDO')
    expect(res.body).toMatchObject({
      provider: 'graph',
      mailbox: 'atendimento@example.com',
      graph: { configured: true, tenantId: 'tenant-1', clientId: 'client-1', certificate: { thumbprint: '5CDC' } },
      acs: { configured: true, sender: 'DoNotReply@x.azurecomm.net' },
      inbound: { enabled: false, since: null, running: false },
      replyEnabledOrgs: [{ name: 'Cafeteria Fiorde' }],
      last24h: { SUCCESS: 12 },
    })
  })

  it('testar conexão lê só os totais da caixa e registra na auditoria', async () => {
    const res = await request(app).post('/api/email-logs/settings/test').set('Authorization', bearer('admin'))
    expect(res.body).toMatchObject({ ok: true, inbox: { total: 924, unread: 207 } })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'EMAIL_CONNECTION_TEST', details: { ok: true, error: undefined } }))
  })

  it('falha de conexão volta como resultado legível, não como erro 500', async () => {
    graphMock.getInboxSummary.mockRejectedValueOnce(new Error('Graph token: 401 invalid_client'))
    const res = await request(app).post('/api/email-logs/settings/test').set('Authorization', bearer('admin'))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: false, error: 'Graph token: 401 invalid_client' })
  })

  it('só admin acessa', async () => {
    for (const path of ['/api/email-logs/settings', '/api/email-logs/inbound']) {
      const res = await request(app).get(path).set('Authorization', bearer('agent'))
      expect(res.status).toBe(403)
    }
  })

  it('lista de recebidos filtra por desfecho e busca', async () => {
    const res = await request(app).get('/api/email-logs/inbound?status=ticket_created&search=fiorde').set('Authorization', bearer('admin'))
    expect(res.status).toBe(200)
    const where = prismaMock.inboundEmail.findMany.mock.calls[0][0].where
    expect(where.status).toBe('ticket_created')
    expect(JSON.stringify(where.OR)).toContain('fiorde')
  })
})

describe('Admin → E-mail: bloqueios', () => {
  it('lista, inclui e exclui pelas rotas /blocks (antes de /:id), com auditoria', async () => {
    prismaMock.emailBlock.findMany.mockResolvedValue([{ id: 'b1', kind: 'domain', value: 'spam.com', hits: 3 }])
    const list = await request(app).get('/api/email-logs/blocks').set('Authorization', bearer('admin'))
    expect(list.status).toBe(200)
    expect(list.body.data).toHaveLength(1)
    expect(list.body.system.length).toBeGreaterThan(0)

    prismaMock.emailBlock.findUnique.mockResolvedValueOnce(null)
    prismaMock.emailBlock.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'b2', ...data }))
    const created = await request(app).post('/api/email-logs/blocks').set('Authorization', bearer('admin')).send({ kind: 'domain', value: '@Promo.COM', reason: 'spam' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ kind: 'domain', value: 'promo.com', created_by_id: 'admin-user' })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'EMAIL_BLOCK_CREATE' }))

    prismaMock.emailBlock.findUnique.mockResolvedValueOnce({ id: 'b2', kind: 'domain', value: 'promo.com', hits: 0 })
    const removed = await request(app).delete('/api/email-logs/blocks/b2').set('Authorization', bearer('admin'))
    expect(removed.status).toBe(204)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'EMAIL_BLOCK_DELETE' }))
  })

  it('valor inválido volta 400', async () => {
    const res = await request(app).post('/api/email-logs/blocks').set('Authorization', bearer('admin')).send({ kind: 'email', value: 'sem-arroba' })
    expect(res.status).toBe(400)
  })

  it('só admin mexe nos bloqueios', async () => {
    expect((await request(app).get('/api/email-logs/blocks').set('Authorization', bearer('manager'))).status).toBe(403)
    expect((await request(app).post('/api/email-logs/blocks').set('Authorization', bearer('supervisor')).send({ kind: 'domain', value: 'x.com' })).status).toBe(403)
    expect((await request(app).delete('/api/email-logs/blocks/b1').set('Authorization', bearer('agent'))).status).toBe(403)
  })
})
