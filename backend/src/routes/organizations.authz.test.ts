import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  organization: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  orgQueueAccess: {
    findMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
}))

const createAuditLogMock = vi.hoisted(() => vi.fn())
const emitWebhookEventMock = vi.hoisted(() => vi.fn())
const getAuditInfoMock = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-with-at-least-32-chars',
  },
}))
vi.mock('../services/audit', () => ({ createAuditLog: createAuditLogMock }))
vi.mock('../services/webhookEvents', () => ({ emitWebhookEvent: emitWebhookEventMock }))
vi.mock('../utils/audit', () => ({ getAuditInfo: getAuditInfoMock }))

import router from './organizations'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/organizations', router)
app.use(errorHandler)

const foreignOrg = {
  id: 'org-foreign',
  name: 'Foreign Org',
  domains: ['foreign.example'],
  deleted_at: null,
  queues: [],
  queue_access: [],
  sla_config: null,
}
const ownOrg = { ...foreignOrg, id: 'org-own', name: 'Own Org' }

function issueToken(role: string, orgId = 'org-own') {
  return jwt.sign({ sub: `${role}-user`, role, orgId }, env.JWT_SECRET, { algorithm: 'HS256' })
}

function bearer(role: string, orgId = 'org-own') {
  return `Bearer ${issueToken(role, orgId)}`
}

// Carteira de todo usuário autenticado = "org-own"; `global-manager-user` atende Todas.
function mockUser(overrides: Record<string, any> = {}) {
  prismaMock.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve({
    id: where.id,
    role: where.id.replace('-user', '').replace('global-', ''),
    active: true,
    deleted_at: null,
    session_invalidated_at: null,
    manager_id: null,
    manager_global: where.id.startsWith('global-'),
    queues: [],
    org_scopes: [{ org_id: 'org-own' }],
    ...overrides,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUser()
  prismaMock.organization.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.id === ownOrg.id ? ownOrg : foreignOrg))
  prismaMock.organization.update.mockImplementation(async ({ where, data }: any) => ({
    ...(where.id === ownOrg.id ? ownOrg : foreignOrg),
    ...data,
    id: where.id,
  }))
  prismaMock.orgQueueAccess.findMany.mockResolvedValue([
    { id: 'access-1', org_id: ownOrg.id, queue_id: 'queue-1', queue: { id: 'queue-1', name: 'Queue 1' } },
  ])
  getAuditInfoMock.mockReturnValue({})
})

describe('organization route authorization boundaries (carteira)', () => {
  for (const role of ['agent', 'supervisor', 'manager']) {
    it(`${role} lê empresa da própria carteira`, async () => {
      const response = await request(app).get(`/api/organizations/${ownOrg.id}`).set('Authorization', bearer(role))
      expect(response.status).toBe(200)
      expect(response.body.data.id).toBe(ownOrg.id)
    })

    it(`${role} é bloqueado em empresa fora da carteira, com explicação`, async () => {
      const response = await request(app).get(`/api/organizations/${foreignOrg.id}`).set('Authorization', bearer(role))
      expect(response.status).toBe(403)
      expect(response.body.code).toBe('ORG_OUT_OF_SCOPE')
      expect(response.body.error).toContain('Foreign Org')
    })

    it(`${role} não lê acesso a filas de empresa fora da carteira`, async () => {
      const response = await request(app).get(`/api/organizations/${foreignOrg.id}/queue-access`).set('Authorization', bearer(role))
      expect(response.status).toBe(403)
      expect(prismaMock.orgQueueAccess.findMany).not.toHaveBeenCalled()
    })

    it(`${role} não edita empresa fora da carteira`, async () => {
      const response = await request(app)
        .patch(`/api/organizations/${foreignOrg.id}`)
        .set('Authorization', bearer(role))
        .send({ name: 'Tentativa' })
      expect(response.status).toBe(403)
      expect(prismaMock.organization.update).not.toHaveBeenCalled()
    })
  }

  it('analista edita empresa da própria carteira', async () => {
    const response = await request(app)
      .patch(`/api/organizations/${ownOrg.id}`)
      .set('Authorization', bearer('agent'))
      .send({ name: 'Updated by agent', domains: ['updated.example'] })
    expect(response.status).toBe(200)
    expect(response.body.data.name).toBe('Updated by agent')
  })

  it('gerente com "Todas as empresas" lê qualquer empresa', async () => {
    const token = jwt.sign({ sub: 'global-manager-user', role: 'manager', orgId: null }, env.JWT_SECRET, { algorithm: 'HS256' })
    const response = await request(app).get(`/api/organizations/${foreignOrg.id}`).set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
  })

  it('sem carteira configurada → SCOPE_NOT_CONFIGURED', async () => {
    mockUser({ org_scopes: [] })
    const response = await request(app).get(`/api/organizations/${ownOrg.id}`).set('Authorization', bearer('manager'))
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('SCOPE_NOT_CONFIGURED')
  })

  it('só o admin adiciona empresa à carteira de um gerente pela tela da empresa', async () => {
    const response = await request(app)
      .post(`/api/organizations/${ownOrg.id}/served-by`)
      .set('Authorization', bearer('manager'))
      .send({ userId: 'x' })
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ROLE_NOT_ALLOWED')
  })

  it('nem quem tem "orgs" explícito (A2: concedido por um gerente) mexe na carteira do gerente', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ active: true, deleted_at: null, session_invalidated_at: null, role: 'agent', permissions: ['orgs'] })
    const response = await request(app)
      .post(`/api/organizations/${ownOrg.id}/served-by`)
      .set('Authorization', bearer('agent'))
      .send({ userId: 'gerente' })
    expect(response.status).toBe(403)
  })
})
