import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectMember: {
    findUnique: vi.fn(),
  },
  user: { findUnique: vi.fn(), findMany: vi.fn(async () => []) }, // findMany: equipe do gerente (vazia)
  project: { count: vi.fn() },
}))

vi.mock('../config/prisma', () => ({ default: prismaMock }))

import { requireProjectRole } from './projectAuthorize'
import { errorHandler } from './errorHandler'

const app = express()
app.use((req, _res, next) => {
  req.user = { sub: 'user-1', role: 'manager', orgId: null } as any
  next()
})
app.get('/projects/:projectId/thing', requireProjectRole('owner', 'manager'), (_req, res) => {
  res.json({ ok: true })
})
app.use(errorHandler)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireProjectRole', () => {
  it('returns 404 when the user is not a project member (no existence leak)', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue(null)
    const res = await request(app).get('/projects/proj-1/thing')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('returns 403 when the member role is not in the allowed list', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'viewer' })
    const res = await request(app).get('/projects/proj-1/thing')
    expect(res.status).toBe(403)
  })

  it('calls next() when the member role is allowed', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'manager' })
    const res = await request(app).get('/projects/proj-1/thing')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  describe('System admin without membership', () => {
    const adminApp = express()
    adminApp.use((req, _res, next) => {
      req.user = { sub: 'admin-1', role: 'admin', orgId: null } as any
      next()
    })
    adminApp.get('/projects/:projectId/thing', requireProjectRole('owner'), (req, res) => {
      res.json({ role: req.projectMembership?.role })
    })
    adminApp.use(errorHandler)

    beforeEach(() => {
      prismaMock.projectMember.findUnique.mockResolvedValue(null)
      prismaMock.user.findUnique.mockResolvedValue({ role: 'admin' })
    })

    it('enters any existing project as owner', async () => {
      prismaMock.project.count.mockResolvedValue(1)
      const res = await request(adminApp).get('/projects/proj-1/thing')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ role: 'owner' })
    })

    it('still gets 404 for a project that does not exist', async () => {
      prismaMock.project.count.mockResolvedValue(0)
      const res = await request(adminApp).get('/projects/nope/thing')
      expect(res.status).toBe(404)
    })
  })

  it('non-admin without membership gets 404 (role read from the DB, not the token)', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue(null)
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager' })
    const res = await request(app).get('/projects/proj-1/thing')
    expect(res.status).toBe(404)
    expect(prismaMock.project.count).not.toHaveBeenCalled()
  })
})
