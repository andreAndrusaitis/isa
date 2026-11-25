import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() },
  ticketParticipant: { findUnique: vi.fn() },
}))

vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../config/env', () => ({ env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' } }))

import router from './tickets'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'
import { TicketService } from '../services/tickets'

const app = express()
app.use(express.json())
app.use('/api/tickets', router)
app.use(errorHandler)

const row = { id: 't1', user_id: 'user-user', org_id: 'o', assigned_to_id: null, queue: null, status: 'open', intake_status: 'incomplete' }
const bearer = (role: string) =>
  `Bearer ${jwt.sign({ sub: `${role}-user`, role, orgId: null }, env.JWT_SECRET, { algorithm: 'HS256' })}`

beforeEach(() => {
  vi.restoreAllMocks()
  prismaMock.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve({
    id: where.id, role: where.id.replace('-user', ''), active: true, deleted_at: null,
    session_invalidated_at: null, queues: [], manager_global: false, manager_id: null, org_scopes: [],
  }))
  prismaMock.organization.findUnique.mockResolvedValue({ name: 'Org' })
  prismaMock.ticketParticipant.findUnique.mockResolvedValue(null)
  vi.spyOn(TicketService, 'getTicketsPage').mockResolvedValue({ data: [row], total: 1, page: 1, pageSize: 20 } as any)
  vi.spyOn(TicketService, 'getTickets').mockResolvedValue({ data: [row] } as any)
  vi.spyOn(TicketService, 'getTicketById').mockResolvedValue({ ...row, status: 'resolved' } as any)
  vi.spyOn(TicketService, 'reopenTicket').mockResolvedValue({ ...row } as any)
})

describe('intake_status nunca chega ao solicitante', () => {
  it('lista paginada', async () => {
    const r = await request(app).get('/api/tickets?page=1').set('Authorization', bearer('user'))
    expect(r.status).toBe(200)
    expect(r.body.data[0]).not.toHaveProperty('intake_status')
  })
  it('lista legada', async () => {
    const r = await request(app).get('/api/tickets').set('Authorization', bearer('user'))
    expect(r.status).toBe(200)
    expect(r.body.data[0]).not.toHaveProperty('intake_status')
  })
  it('resposta da reabertura', async () => {
    const r = await request(app).post('/api/tickets/t1/reopen').set('Authorization', bearer('user')).send({ reason: 'ainda com problema aqui' })
    expect(r.status).toBe(200)
    expect(r.body.data).not.toHaveProperty('intake_status')
  })
  it('analista continua vendo na lista', async () => {
    const r = await request(app).get('/api/tickets?page=1').set('Authorization', bearer('admin'))
    expect(r.body.data[0].intake_status).toBe('incomplete')
  })
})
