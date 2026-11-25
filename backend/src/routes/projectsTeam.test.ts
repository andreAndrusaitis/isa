import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  task: { findMany: vi.fn() },
  projectMember: { findMany: vi.fn() },
  project: { findMany: vi.fn() },
}))

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-with-at-least-32-chars' },
}))
// Acesso ao módulo tem teste próprio (projects.authz.test): aqui o usuário já tem o módulo.
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: vi.fn(async () => ({ tickets: true, projects: true, documents: false })) }))
vi.mock('../middlewares/projectScope', () => ({ scopeParamsToProject: () => {}, assertRefsInProject: async () => {} })) // IDOR tem teste próprio (projects.idor.test)
vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../services/projectInsights', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/projectInsights')>()),
  memberProjectIds: vi.fn(async () => []),
  getActivityHeatmap: vi.fn(async () => []),
}))

import projectsTeamRoutes from './projectsTeam'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'
import { getEffectiveModules } from '../services/moduleAccess'

const app = express()
app.use(express.json())
app.use('/api/projects', projectsTeamRoutes)
app.use(errorHandler)

function bearer(role: string, sub = 'manager-1') {
  const token = jwt.sign({ sub, role, orgId: null, permissions: [] }, env.JWT_SECRET, { algorithm: 'HS256' })
  return `Bearer ${token}`
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/projects/team', () => {
  it('returns 403 for a role when the projects module is off', async () => {
    vi.mocked(getEffectiveModules).mockResolvedValueOnce({ tickets: true, projects: false, documents: false })
    prismaMock.user.findUnique.mockResolvedValue({ role: 'agent', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    const res = await request(app).get('/api/projects/team').set('Authorization', bearer('agent'))
    expect(res.status).toBe(403)
  })

  it('returns subordinates with task counts, scoped to projects the manager sees (his and his team)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    prismaMock.user.findMany.mockResolvedValue([{ id: 'sub-1', name: 'Subordinado 1' }])
    prismaMock.project.findMany.mockResolvedValue([{ id: 'proj-1' }])
    prismaMock.task.findMany.mockResolvedValue([{ id: 'task-1', assignee_id: 'sub-1', project_id: 'proj-1', archived_at: null }])

    const res = await request(app).get('/api/projects/team').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data[0].userId).toBe('sub-1')
    expect(res.body.data[0].taskCount).toBe(1)
    // Projetos visíveis = do gerente + da equipe (organograma), não só onde ele é membro.
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { archived_at: null, members: { some: { user_id: { in: ['manager-1', 'sub-1'] } } } },
    }))
  })
})

const session = (role: string, permissions: string[] = []) =>
  prismaMock.user.findUnique.mockResolvedValue({ role, permissions, active: true, deleted_at: null, session_invalidated_at: null })

// Relatórios de Projetos: Gerente e TM pelo cargo; Analista só com a liberação na ficha.
describe('liberação "Relatórios de Projetos"', () => {
  beforeEach(() => {
    prismaMock.project.findMany.mockResolvedValue([])
    prismaMock.task.findMany.mockResolvedValue([])
  })

  it('analista sem a liberação recebe 403 nos painéis', async () => {
    session('agent')
    const res = await request(app).get('/api/projects/dashboard-global').set('Authorization', bearer('agent', 'agent-1'))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERMISSION_REQUIRED')
  })

  it('analista com a liberação concedida, TM e Gerente veem os painéis', async () => {
    for (const [role, permissions] of [['agent', ['projects_reports']], ['supervisor', []], ['manager', []]] as const) {
      session(role, [...permissions])
      const res = await request(app).get('/api/projects/dashboard-global').set('Authorization', bearer(role, `${role}-1`))
      expect(res.status, role).toBe(200)
    }
  })

  it('mapa de atividade: a própria é de todos; a do time exige a liberação', async () => {
    session('agent')
    expect((await request(app).get('/api/projects/activity?userId=me').set('Authorization', bearer('agent', 'agent-1'))).status).toBe(200)
    expect((await request(app).get('/api/projects/activity').set('Authorization', bearer('agent', 'agent-1'))).status).toBe(403)
    session('agent', ['projects_reports'])
    expect((await request(app).get('/api/projects/activity').set('Authorization', bearer('agent', 'agent-1'))).status).toBe(200)
  })
})

describe('GET /api/projects/dashboard-global', () => {
  it('returns aggregate counts without a ranking field', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'manager', permissions: [], active: true, deleted_at: null, session_invalidated_at: null })
    prismaMock.project.findMany.mockResolvedValue([{ id: 'proj-1' }])
    prismaMock.task.findMany.mockResolvedValue([
      { id: 'task-1', archived_at: null, due_date: null, status: { category: 'open' } },
      { id: 'task-2', archived_at: null, due_date: null, status: { category: 'done' } },
    ])

    const res = await request(app).get('/api/projects/dashboard-global').set('Authorization', bearer('manager'))
    expect(res.status).toBe(200)
    expect(res.body.data.totalTasks).toBe(2)
    expect(res.body.data.byStatus).not.toHaveProperty('ranking')
  })
})
