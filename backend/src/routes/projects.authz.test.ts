import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-with-at-least-32-chars',
  },
}))

vi.mock('../config/prisma', () => ({ default: prismaMock }))

import projectsRoutes from './projects'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/projects', projectsRoutes)
app.use(errorHandler)

function bearer(role: string, permissions: string[] = []) {
  const token = jwt.sign(
    { sub: 'test-user-id', role, orgId: null, permissions },
    env.JWT_SECRET,
    { algorithm: 'HS256' }
  )
  return `Bearer ${token}`
}

// Usuários do "banco" por id: o authenticate e o getEffectiveModules leem daqui.
type FakeUser = { role: string; permissions?: string[]; manager_id?: string | null; module_projects?: boolean | null; module_tickets?: boolean | null; module_documents?: boolean | null }
let users: Record<string, FakeUser> = {}
function seed(me: FakeUser, others: Record<string, FakeUser> = {}) {
  users = { 'test-user-id': me, ...others }
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => {
    const u = users[where.id]
    return u && { permissions: [], active: true, deleted_at: null, session_invalidated_at: null, manager_id: null, module_projects: null, module_tickets: null, module_documents: null, ...u }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/projects/access — módulo por carteira do gerente', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/projects/access')
    expect(res.status).toBe(401)
  })

  it('403 para usuário final', async () => {
    seed({ role: 'user' })
    const res = await request(app).get('/api/projects/access').set('Authorization', bearer('user'))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  it('403 para usuário final mesmo com o módulo marcado (cliente não usa Projetos)', async () => {
    seed({ role: 'user', module_projects: true })
    const res = await request(app).get('/api/projects/access').set('Authorization', bearer('user'))
    expect(res.status).toBe(403)
  })

  it('403 para gerente sem o módulo ligado', async () => {
    seed({ role: 'manager' })
    const res = await request(app).get('/api/projects/access').set('Authorization', bearer('manager'))
    expect(res.status).toBe(403)
  })

  it('200 para gerente com o módulo ligado', async () => {
    seed({ role: 'manager', module_projects: true })
    const res = await request(app).get('/api/projects/access').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allowed: true })
  })

  it('200 para analista que herda do gerente da carteira', async () => {
    seed({ role: 'agent', manager_id: 'tm' }, {
      tm: { role: 'supervisor', manager_id: 'ger' },
      ger: { role: 'manager', module_projects: true },
    })
    const res = await request(app).get('/api/projects/access').set('Authorization', bearer('agent'))
    expect(res.status).toBe(200)
  })

  it('403 para analista com exceção individual desligada, mesmo com a carteira ligada', async () => {
    seed({ role: 'agent', manager_id: 'ger', module_projects: false }, { ger: { role: 'manager', module_projects: true } })
    const res = await request(app).get('/api/projects/access').set('Authorization', bearer('agent'))
    expect(res.status).toBe(403)
  })

  it('a permissão antiga "projetos" não dá mais acesso', async () => {
    seed({ role: 'agent', permissions: ['projetos'] })
    const res = await request(app).get('/api/projects/access').set('Authorization', bearer('agent', ['projetos']))
    expect(res.status).toBe(403)
  })

  it('200 para admin', async () => {
    seed({ role: 'admin' })
    const res = await request(app).get('/api/projects/access').set('Authorization', bearer('admin'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allowed: true })
  })
})
