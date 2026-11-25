import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  ticket: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
  },
  queue: {
    findUnique: vi.fn(),
  },
  ticketParticipant: {
    findUnique: vi.fn(),
  },
  reopenSlaConfig: {
    findFirst: vi.fn(),
  },
}))

vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-with-at-least-32-chars',
  },
}))

import router from './tickets'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/tickets', router)
app.use(errorHandler)

// Ticket pertence à org "org-foreign" — fora do escopo do agent/supervisor escopado abaixo.
const foreignTicket = {
  id: 'ticket-1',
  user_id: 'customer-1',
  org_id: 'org-foreign',
  assigned_to_id: null,
  queue: null,
}

const ownTicket = {
  ...foreignTicket,
  id: 'ticket-2',
  org_id: 'org-own',
}

function bearer(role: string, sub = `${role}-user`) {
  const token = jwt.sign({ sub, role, orgId: null }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
  // authenticate() (CWE-613) consulta o usuário para checar active/session_invalidated_at;
  // getEffectiveScope() sobe a cadeia com o mesmo findUnique — carteira = "org-own", fila q1.
  prismaMock.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve({
    id: where.id,
    role: where.id.replace('-user', ''),
    active: true,
    deleted_at: null,
    session_invalidated_at: null,
    queues: ['q1'],
    manager_global: false,
    manager_id: null,
    org_scopes: [{ org_id: 'org-own' }],
  }))
  prismaMock.organization.findUnique.mockResolvedValue({ name: 'Empresa Externa' })
  prismaMock.ticketParticipant.findUnique.mockResolvedValue(null)
  prismaMock.reopenSlaConfig.findFirst.mockResolvedValue(null)
})

describe('ticket single-object access boundaries (IDOR fix)', () => {
  it('blocks a scoped agent from reading a ticket of a foreign org', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(foreignTicket)

    const response = await request(app)
      .get(`/api/tickets/${foreignTicket.id}`)
      .set('Authorization', bearer('agent'))

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ORG_OUT_OF_SCOPE')
    expect(response.body.error).toContain('Empresa Externa')
  })

  it('blocks a scoped supervisor from reading a ticket of a foreign org', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(foreignTicket)

    const response = await request(app)
      .get(`/api/tickets/${foreignTicket.id}`)
      .set('Authorization', bearer('supervisor'))

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ORG_OUT_OF_SCOPE')
    expect(response.body.error).toContain('Empresa Externa')
  })

  it('blocks a scoped agent from patching a ticket of a foreign org', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(foreignTicket)

    const response = await request(app)
      .patch(`/api/tickets/${foreignTicket.id}`)
      .set('Authorization', bearer('agent'))
      .send({ priority: 'high' })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ORG_OUT_OF_SCOPE')
    expect(response.body.error).toContain('Empresa Externa')
    expect(prismaMock.ticket.update).not.toHaveBeenCalled()
  })

  it('allows a scoped agent to read a ticket inside their org scope', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ownTicket)

    const response = await request(app)
      .get(`/api/tickets/${ownTicket.id}`)
      .set('Authorization', bearer('agent'))

    expect(response.status).toBe(200)
    expect(response.body.data.id).toBe(ownTicket.id)
  })

  it('allows an admin to read a ticket of any org (global read access)', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(foreignTicket)

    const response = await request(app)
      .get(`/api/tickets/${foreignTicket.id}`)
      .set('Authorization', bearer('admin'))

    expect(response.status).toBe(200)
    expect(response.body.data.id).toBe(foreignTicket.id)
  })
  it('allows a manager to read a ticket of an org in their UserOrgScope without OrgManagerLink', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ownTicket)

    const response = await request(app)
      .get(`/api/tickets/${ownTicket.id}`)
      .set('Authorization', bearer('manager'))

    expect(response.status).toBe(200)
  })

  it('blocks a scoped manager from reading a ticket of a foreign org', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(foreignTicket)

    const response = await request(app)
      .get(`/api/tickets/${foreignTicket.id}`)
      .set('Authorization', bearer('manager'))

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ORG_OUT_OF_SCOPE')
  })

  it('allows an escalated collaborator to read a ticket outside their carteira', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(foreignTicket)
    prismaMock.ticketParticipant.findUnique.mockResolvedValue({ active: true, role: 'collaborator' })

    const response = await request(app)
      .get(`/api/tickets/${foreignTicket.id}`)
      .set('Authorization', bearer('agent'))

    expect(response.status).toBe(200)
  })

  it('blocks an agent without queues, explaining why', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ownTicket)
    const base = prismaMock.user.findUnique.getMockImplementation()!
    prismaMock.user.findUnique.mockImplementation(async (args: any) => ({ ...(await base(args)), queues: [] }))

    const response = await request(app)
      .get(`/api/tickets/${ownTicket.id}`)
      .set('Authorization', bearer('agent'))

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('NO_QUEUES')
  })
})
