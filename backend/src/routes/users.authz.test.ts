import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
  },
}))

const listUsersMock = vi.hoisted(() => vi.fn())
const getUserByIdMock = vi.hoisted(() => vi.fn())
const createUserMock = vi.hoisted(() => vi.fn())
const updateUserMock = vi.hoisted(() => vi.fn())
const deleteUserMock = vi.hoisted(() => vi.fn())
const getSelfAndAncestorsMock = vi.hoisted(() => vi.fn())
const getAuditInfoMock = vi.hoisted(() => vi.fn(() => ({})))
const getEffectiveModulesMock = vi.hoisted(() => vi.fn())

const { createUserSchema, updateUserSchema } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { z: zHoisted } = require('zod') as typeof import('zod')
  const createSchema = zHoisted.object({
    name: zHoisted.string().min(1),
    email: zHoisted.string().email(),
    password: zHoisted.string().min(6),
    role: zHoisted.enum(['user', 'agent', 'supervisor', 'manager', 'admin']),
    orgId: zHoisted.string().nullable().optional(),
    org_id: zHoisted.string().nullable().optional(),
    queues: zHoisted.array(zHoisted.string()).optional(),
    permissions: zHoisted.array(zHoisted.string()).optional(),
    org_scope_ids: zHoisted.array(zHoisted.string()).optional(),
    position: zHoisted.string().nullable().optional(),
    department: zHoisted.string().nullable().optional(),
    phone: zHoisted.string().nullable().optional(),
    avatar: zHoisted.string().nullable().optional(),
    location: zHoisted.string().nullable().optional(),
    manager_id: zHoisted.string().nullable().optional(),
    active: zHoisted.boolean().optional(),
    module_tickets: zHoisted.boolean().nullable().optional(),
    module_projects: zHoisted.boolean().nullable().optional(),
    module_documents: zHoisted.boolean().nullable().optional(),
  })
  const updateSchema = createSchema.partial().extend({
    password: zHoisted.string().min(6).or(zHoisted.literal('')).optional(),
    authProvider: zHoisted.enum(['local', 'microsoft']).optional(),
  })
  return { createUserSchema: createSchema, updateUserSchema: updateSchema }
})

vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-with-at-least-32-chars',
  },
}))

vi.mock('../config/prisma', () => ({ default: prismaMock }))

vi.mock('../services/users', () => ({
  listUsers: listUsersMock,
  getUserById: getUserByIdMock,
  createUser: createUserMock,
  updateUser: updateUserMock,
  deleteUser: deleteUserMock,
  getSelfAndAncestors: getSelfAndAncestorsMock,
  createUserSchema,
  updateUserSchema,
}))

vi.mock('../utils/audit', () => ({ getAuditInfo: getAuditInfoMock }))
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: getEffectiveModulesMock }))

import router from './users'
import { errorHandler } from '../middlewares/errorHandler'
import { env } from '../config/env'

const app = express()
app.use(express.json())
app.use('/api/users', router)
app.use(errorHandler)

function buildUser(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 'target-user',
    name: 'Foreign User',
    email: 'foreign@example.com',
    password: 'hash',
    role: 'user',
    org_id: 'org-foreign',
    active: true,
    queues: [],
    avatar: null,
    phone: null,
    position: null,
    department: null,
    location: null,
    manager_id: null,
    org: { id: 'org-foreign', name: 'Foreign Org' },
    manager: null,
    org_scopes: [],
    orgId: 'org-foreign',
    managerId: null,
    orgScopeIds: [],
  }

  return { ...base, ...overrides }
}

const AUTH_OK = { active: true, deleted_at: null, session_invalidated_at: null }

/**
 * Organograma para authenticate + loadChain: cada id devolve o próprio registro;
 * ids fora do mapa devolvem só o mínimo do authenticate.
 */
function orgChart(nodes: Record<string, Record<string, unknown>>) {
  prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
    const n = nodes[where.id]
    return Promise.resolve(n
      ? { ...AUTH_OK, id: where.id, role: 'agent', manager_id: null, manager_global: false, queues: [], org_scopes: [], permissions: [], ...n }
      : AUTH_OK)
  })
}

function issueToken(role: string, orgId: string | null = 'org-own', permissions: string[] = []) {
  return jwt.sign({ sub: `${role}-user`, role, orgId, permissions }, env.JWT_SECRET, { algorithm: 'HS256' })
}

function bearer(role: string, orgId: string | null = 'org-own', permissions: string[] = []) {
  return `Bearer ${issueToken(role, orgId, permissions)}`
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ active: true, deleted_at: null, session_invalidated_at: null })
  listUsersMock.mockResolvedValue([])
  getSelfAndAncestorsMock.mockResolvedValue([])
  getAuditInfoMock.mockReturnValue({})
  getEffectiveModulesMock.mockResolvedValue({ tickets: true, projects: false, documents: false })
})

describe('user route authorization boundaries', () => {
  it('blocks an end user from accessing a user from another organization', async () => {
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'foreign-user', role: 'user', org_id: 'org-foreign' }))

    const response = await request(app)
      .get('/api/users/foreign-user')
      .set('Authorization', bearer('user', 'org-own'))

    expect(response.status).toBe(403)
    expect(['ROLE_NOT_ALLOWED', 'PERMISSION_REQUIRED']).toContain(response.body.code)
  })

  // Mesmo registro serve ao authenticate e à carteira (loadChain) de quem pede.
  const withCarteira = (orgIds: string[], extra: Record<string, unknown> = {}) =>
    prismaMock.user.findUnique.mockResolvedValue({
      active: true, deleted_at: null, session_invalidated_at: null,
      role: 'agent', manager_id: null, manager_global: false, queues: [],
      org_scopes: orgIds.map(org_id => ({ org_id })), ...extra,
    })

  it('blocks an agent from updating a user of a company outside the carteira', async () => {
    withCarteira(['org-other'])
    prismaMock.organization.findUnique.mockResolvedValue({ name: 'Foreign Org', deleted_at: null })
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'foreign-user', role: 'user', org_id: 'org-foreign' }))

    const response = await request(app)
      .patch('/api/users/foreign-user')
      .set('Authorization', bearer('agent', 'org-own'))
      .send({ name: 'Attempted Cross-Org Update' })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ORG_OUT_OF_SCOPE')
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('analista edita usuário de empresa da carteira, inclusive login SSO, perfil e empresa', async () => {
    withCarteira(['org-foreign', 'org-b'], { manager_id: 'tm-x' })
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'foreign-user', role: 'user', org_id: 'org-foreign' }))
    updateUserMock.mockResolvedValue(buildUser({ id: 'foreign-user', role: 'agent' }))

    const response = await request(app)
      .patch('/api/users/foreign-user')
      .set('Authorization', bearer('agent', 'org-own'))
      .send({ name: 'Editado', authProvider: 'microsoft', role: 'agent', org_id: 'org-b' })

    expect(response.status).toBe(200)
    expect(updateUserMock).toHaveBeenCalledWith('foreign-user',
      expect.objectContaining({ name: 'Editado', authProvider: 'microsoft', role: 'agent', org_id: 'org-b', manager_id: 'tm-x' }), expect.anything())
  })

  it('analista não promove acima do que pode criar nem move para empresa fora da carteira', async () => {
    withCarteira(['org-foreign'])
    prismaMock.organization.findUnique.mockResolvedValue({ name: 'Org B', deleted_at: null })
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'foreign-user', role: 'user', org_id: 'org-foreign' }))

    const promote = await request(app)
      .patch('/api/users/foreign-user')
      .set('Authorization', bearer('agent', 'org-own'))
      .send({ role: 'supervisor' })
    expect(promote.status).toBe(403)
    expect(promote.body.code).toBe('ROLE_HIERARCHY')

    const move = await request(app)
      .patch('/api/users/foreign-user')
      .set('Authorization', bearer('agent', 'org-own'))
      .send({ org_id: 'org-b' })
    expect(move.status).toBe(403)
    expect(move.body.code).toBe('ORG_OUT_OF_SCOPE')
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('gerente troca perfil e empresa de quem está abaixo dele (antes era descartado em silêncio)', async () => {
    withCarteira([], { role: 'manager', manager_global: true })
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'target-user', role: 'user', org_id: 'org-own' }))
    updateUserMock.mockResolvedValue(buildUser({ id: 'target-user', role: 'supervisor' }))

    const response = await request(app)
      .patch('/api/users/target-user')
      .set('Authorization', bearer('manager', 'org-own'))
      .send({ role: 'supervisor', org_id: 'org-x' })

    expect(response.status).toBe(200)
    expect(updateUserMock).toHaveBeenCalledWith('target-user', expect.objectContaining({ role: 'supervisor', org_id: 'org-x' }), expect.anything())
  })

  it('blocks an agent from deleting a user from another organization', async () => {
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'foreign-user', role: 'user', org_id: 'org-foreign' }))

    const response = await request(app)
      .delete('/api/users/foreign-user')
      .set('Authorization', bearer('agent', 'org-own'))

    expect(response.status).toBe(403)
    expect(['ROLE_NOT_ALLOWED', 'ORG_NOT_OWN', 'PERMISSION_REQUIRED']).toContain(response.body.code)
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  it('blocks an agent from creating a user with a higher role (e.g. manager or admin)', async () => {
    const response = await request(app)
      .post('/api/users')
      .set('Authorization', bearer('agent', 'org-own'))
      .send({
        name: 'Manager Attempt',
        email: 'mgr-attempt@example.com',
        password: 'password123',
        role: 'manager',
        org_id: 'org-own',
      })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ROLE_HIERARCHY')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('blocks a supervisor from creating an admin user', async () => {
    const response = await request(app)
      .post('/api/users')
      .set('Authorization', bearer('supervisor', 'org-own'))
      .send({
        name: 'Admin Attempt',
        email: 'adm-attempt@example.com',
        password: 'password123',
        role: 'admin',
        org_id: 'org-own',
      })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ROLE_HIERARCHY')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('blocks a supervisor from modifying a user with a higher role (e.g. manager or admin)', async () => {
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'manager-user', role: 'manager', org_id: 'org-own' }))

    const response = await request(app)
      .patch('/api/users/manager-user')
      .set('Authorization', bearer('supervisor', 'org-own'))
      .send({ active: false })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ROLE_HIERARCHY')
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('restricts manager role visibility in list users to subordinates only (no manager or admin)', async () => {
    listUsersMock.mockResolvedValue([
      buildUser({ id: 'u1', role: 'supervisor' }),
      buildUser({ id: 'u2', role: 'agent' }),
      buildUser({ id: 'u3', role: 'user' }),
    ])

    const response = await request(app)
      .get('/api/users')
      .set('Authorization', bearer('manager', null))

    expect(response.status).toBe(200)
    expect(listUsersMock).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['supervisor', 'agent', 'user'],
    }))
  })

  it('allows admin to list all roles including manager and admin', async () => {
    listUsersMock.mockResolvedValue([])

    const response = await request(app)
      .get('/api/users')
      .set('Authorization', bearer('admin', null))

    expect(response.status).toBe(200)
    expect(listUsersMock).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['admin', 'manager', 'supervisor', 'agent', 'user'],
    }))
  })

  it('gerente troca o método de login e a senha de quem está abaixo dele', async () => {
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'target-user', role: 'user', org_id: 'org-own' }))
    updateUserMock.mockResolvedValue(buildUser({ id: 'target-user', role: 'user' }))

    const res = await request(app)
      .patch('/api/users/target-user')
      .set('Authorization', bearer('manager', 'org-own'))
      .send({ name: 'Novo Nome', authProvider: 'local', password: 'newPassword123' })

    expect(res.status).toBe(200)
    expect(updateUserMock).toHaveBeenCalledWith('target-user', expect.objectContaining({ name: 'Novo Nome', authProvider: 'local', password: 'newPassword123' }), expect.anything())
  })

  it('credenciais de admin continuam só com admin', async () => {
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'admin-user', role: 'admin', org_id: null }))

    const res = await request(app)
      .patch('/api/users/admin-user')
      .set('Authorization', bearer('manager', 'org-own'))
      .send({ authProvider: 'local', password: 'newPassword123' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ADMIN_RESTRICTED')
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('ninguém amplia a própria carteira nem se dá "Todas as empresas"', async () => {
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'manager-user', role: 'manager', org_id: 'org-own' }))
    updateUserMock.mockResolvedValue(buildUser({ id: 'manager-user', role: 'manager' }))

    const response = await request(app)
      .patch('/api/users/manager-user')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Eu mesmo', org_scope_ids: ['org-x'], manager_global: true })

    expect(response.status).toBe(200)
    const sent = updateUserMock.mock.calls[0][1]
    expect(sent.name).toBe('Eu mesmo')
    expect(sent.org_scope_ids).toBeUndefined()
    expect(sent.manager_global).toBeUndefined()
  })

  it('analista criado pelo gerente entra na equipe dele (senão não veria nenhum chamado)', async () => {
    createUserMock.mockResolvedValue(buildUser({ id: 'new-agent', role: 'agent' }))

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', bearer('manager'))
      .send({ name: 'Novo', email: 'novo@example.com', password: 'password123', role: 'agent', manager_global: true })

    expect(response.status).toBe(201)
    const sent = createUserMock.mock.calls[0][0]
    expect(sent.manager_id).toBe('manager-user')
    expect(sent.manager_global).toBeUndefined()
  })

  it('analista com permissão users lista outros usuários mas NUNCA enxerga perfil admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['users'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const response = await request(app)
      .get('/api/users')
      .set('Authorization', bearer('agent', 'org-own', ['users']))

    expect(response.status).toBe(200)
    expect(listUsersMock).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['manager', 'supervisor', 'agent', 'user'],
    }))
    expect(listUsersMock.mock.calls[0][0].roles).not.toContain('admin')
  })

  it('analista não consegue consultar dados de um administrador (getById)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['users'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'admin-id', role: 'admin' }))

    const response = await request(app)
      .get('/api/users/admin-id')
      .set('Authorization', bearer('agent', 'org-own', ['users']))

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ADMIN_RESTRICTED')
  })

  it('analista não consegue alterar um administrador (update)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['users'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'admin-id', role: 'admin' }))

    const response = await request(app)
      .patch('/api/users/admin-id')
      .set('Authorization', bearer('agent', 'org-own', ['users']))
      .send({ name: 'Admin Renomeado' })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ADMIN_RESTRICTED')
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('analista não consegue criar um administrador (create)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['users'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', bearer('agent', 'org-own', ['users']))
      .send({ name: 'Novo Admin', email: 'admin@example.com', password: 'password123', role: 'admin' })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ADMIN_RESTRICTED')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('analista não consegue remover um administrador (delete)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'agent',
      permissions: ['users'],
      active: true,
      deleted_at: null,
      session_invalidated_at: null,
    })
    getUserByIdMock.mockResolvedValue(buildUser({ id: 'admin-id', role: 'admin' }))

    const response = await request(app)
      .delete('/api/users/admin-id')
      .set('Authorization', bearer('agent', 'org-own', ['users']))

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ADMIN_RESTRICTED')
    expect(deleteUserMock).not.toHaveBeenCalled()
  })
  // Um teste por brecha de escalada de acesso.
  describe('brechas de acesso', () => {
    // g1 → tm1 → a1 (time do gerente) | g2 → a2 (outro time) | solto (sem chefe)
    const chart = (extra: Record<string, Record<string, unknown>> = {}) => orgChart({
      'manager-user': { role: 'manager', manager_global: true },
      'supervisor-user': { role: 'supervisor', manager_id: 'manager-user' },
      'agent-user': { role: 'agent', manager_id: 'supervisor-user' },
      'a1': { role: 'agent', manager_id: 'supervisor-user' },
      'g2': { role: 'manager' },
      'a2': { role: 'agent', manager_id: 'g2' },
      ...extra,
    })
    const ok = (id: string, role = 'agent', extra: Record<string, unknown> = {}) => {
      getUserByIdMock.mockResolvedValue(buildUser({ id, role, org_id: null, ...extra }))
      updateUserMock.mockResolvedValue(buildUser({ id, role }))
    }

    describe('B2 — permissões', () => {
      it('gerente não altera as próprias permissões pela ficha', async () => {
        chart()
        ok('manager-user', 'manager', { permissions: [] })
        const res = await request(app).patch('/api/users/manager-user').set('Authorization', bearer('manager'))
          .send({ name: 'Eu', permissions: ['webhooks', 'trash'] })
        expect(res.status).toBe(200)
        expect(updateUserMock.mock.calls[0][1].permissions).toBeUndefined()
      })

      it('gerente não concede a alguém da equipe uma área que ele não tem', async () => {
        chart()
        ok('a1')
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('manager'))
          .send({ permissions: ['orgs', 'webhooks'] })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('PERMISSION_NOT_OWNED')
        expect(updateUserMock).not.toHaveBeenCalled()
      })

      it('gerente concede a alguém da equipe uma área que ele tem', async () => {
        chart()
        ok('a1')
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('manager'))
          .send({ permissions: ['orgs', 'users', 'macros'] })
        expect(res.status).toBe(200)
        expect(updateUserMock.mock.calls[0][1].permissions).toEqual(['orgs', 'users', 'macros'])
      })

      it('nome de permissão desconhecido é recusado', async () => {
        chart()
        ok('a1')
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('manager'))
          .send({ permissions: ['orgs', 'superpoder'] })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('UNKNOWN_PERMISSION')
      })

      it('gerente não cria conta com acesso que ele não tem', async () => {
        chart()
        const res = await request(app).post('/api/users').set('Authorization', bearer('manager'))
          .send({ name: 'Laranja', email: 'laranja@example.com', password: 'password123', role: 'agent', permissions: ['webhooks'] })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('PERMISSION_NOT_OWNED')
        expect(createUserMock).not.toHaveBeenCalled()
      })
    })

    describe('B3 — a permissão "Usuários" não fura o cargo', () => {
      const agentWithUsers = () => chart({ 'agent-user': { role: 'agent', manager_id: 'supervisor-user', permissions: ['users'] } })

      it('analista com "Usuários" não edita um gerente', async () => {
        agentWithUsers()
        getUserByIdMock.mockResolvedValue(buildUser({ id: 'g2', role: 'manager', org_id: null }))
        const res = await request(app).patch('/api/users/g2').set('Authorization', bearer('agent', 'org-own', ['users']))
          .send({ active: false })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('ROLE_HIERARCHY')
        expect(updateUserMock).not.toHaveBeenCalled()
      })

      it('analista com "Usuários" não remove um gerente', async () => {
        agentWithUsers()
        getUserByIdMock.mockResolvedValue(buildUser({ id: 'g2', role: 'manager', org_id: null }))
        const res = await request(app).delete('/api/users/g2').set('Authorization', bearer('agent', 'org-own', ['users']))
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('ROLE_HIERARCHY')
        expect(deleteUserMock).not.toHaveBeenCalled()
      })

      it('analista com "Usuários" não cria gerente nem Ticket Manager', async () => {
        agentWithUsers()
        for (const role of ['manager', 'supervisor']) {
          const res = await request(app).post('/api/users').set('Authorization', bearer('agent', 'org-own', ['users']))
            .send({ name: 'X', email: `${role}@example.com`, password: 'password123', role })
          expect(res.status).toBe(403)
          expect(res.body.code).toBe('ROLE_HIERARCHY')
        }
        expect(createUserMock).not.toHaveBeenCalled()
      })
    })

    describe('B4 — Gerente e TM só mexem no próprio time', () => {
      it('gerente não edita analista de outro time', async () => {
        chart()
        ok('a2')
        const res = await request(app).patch('/api/users/a2').set('Authorization', bearer('manager'))
          .send({ password: 'novaSenha123' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('NOT_IN_TEAM')
        expect(updateUserMock).not.toHaveBeenCalled()
      })

      it('gerente edita analista do time dois níveis abaixo, inclusive senha', async () => {
        chart()
        ok('a1')
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('manager'))
          .send({ password: 'novaSenha123', authProvider: 'local' })
        expect(res.status).toBe(200)
        expect(updateUserMock.mock.calls[0][1]).toEqual(expect.objectContaining({ password: 'novaSenha123', authProvider: 'local' }))
      })

      it('gerente não edita pessoa da equipe sem chefe definido', async () => {
        chart({ solto: { role: 'agent' } })
        ok('solto')
        const res = await request(app).patch('/api/users/solto').set('Authorization', bearer('manager')).send({ name: 'X' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('NOT_IN_TEAM')
      })

      it('TM não troca a senha de analista de outro time', async () => {
        chart()
        ok('a2')
        const res = await request(app).patch('/api/users/a2').set('Authorization', bearer('supervisor'))
          .send({ password: 'novaSenha123' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('NOT_IN_TEAM')
      })

      it('TM não puxa analista de outro time para si', async () => {
        chart()
        ok('a2')
        const res = await request(app).patch('/api/users/a2').set('Authorization', bearer('supervisor'))
          .send({ manager_id: 'supervisor-user' })
        expect(res.status).toBe(403)
        expect(updateUserMock).not.toHaveBeenCalled()
      })

      it('gerente não move analista do time para um chefe fora da árvore', async () => {
        chart()
        ok('a1', 'agent', { manager_id: 'supervisor-user' })
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('manager'))
          .send({ manager_id: 'g2' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('CHIEF_OUT_OF_TEAM')
      })

      it('gerente move analista para um TM da própria árvore', async () => {
        chart()
        ok('a1', 'agent', { manager_id: 'manager-user' })
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('manager'))
          .send({ manager_id: 'supervisor-user' })
        expect(res.status).toBe(200)
        expect(updateUserMock.mock.calls[0][1].manager_id).toBe('supervisor-user')
      })

      it('gerente não cria analista sob chefe de outro time', async () => {
        chart()
        const res = await request(app).post('/api/users').set('Authorization', bearer('manager'))
          .send({ name: 'Novo', email: 'novo2@example.com', password: 'password123', role: 'agent', manager_id: 'g2' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('CHIEF_OUT_OF_TEAM')
      })

      it('TM não remove analista de outro time', async () => {
        chart()
        getUserByIdMock.mockResolvedValue(buildUser({ id: 'a2', role: 'agent', org_id: null }))
        const res = await request(app).delete('/api/users/a2').set('Authorization', bearer('supervisor'))
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('NOT_IN_TEAM')
        expect(deleteUserMock).not.toHaveBeenCalled()
      })

      it('TM não edita cliente de empresa fora da carteira', async () => {
        chart({ 'supervisor-user': { role: 'supervisor', manager_id: null, org_scopes: [{ org_id: 'org-a' }] } })
        prismaMock.organization.findUnique.mockResolvedValue({ name: 'Foreign Org', deleted_at: null })
        getUserByIdMock.mockResolvedValue(buildUser({ id: 'cli', role: 'user', org_id: 'org-foreign' }))
        const res = await request(app).patch('/api/users/cli').set('Authorization', bearer('supervisor'))
          .send({ password: 'novaSenha123' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('ORG_OUT_OF_SCOPE')
      })

      it('analista não troca a senha de colega do mesmo time', async () => {
        chart()
        ok('a1', 'agent', { manager_id: 'supervisor-user' })
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('agent'))
          .send({ password: 'novaSenha123' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('CREDENTIALS_RESTRICTED')
      })
    })

    // Caminhos alternativos para a mesma brecha.
    describe('revisão — outros caminhos para as mesmas brechas', () => {
      it('A1: analista não promove cliente a analista com carteira maior que a dele', async () => {
        chart({ 'agent-user': { role: 'agent', manager_id: 'supervisor-user', org_scopes: [{ org_id: 'org-own' }] },
          'supervisor-user': { role: 'supervisor', manager_id: null, org_scopes: [{ org_id: 'org-own' }] } })
        prismaMock.organization.findUnique.mockResolvedValue({ name: 'Vítima', deleted_at: null })
        ok('cli', 'user', { org_id: 'org-own' })
        const res = await request(app).patch('/api/users/cli').set('Authorization', bearer('agent'))
          .send({ role: 'agent', org_scope_ids: ['org-vitima'] })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('ORG_OUT_OF_SCOPE')
        expect(updateUserMock).not.toHaveBeenCalled()
      })

      it('A1: cliente promovido por analista entra no time dele', async () => {
        chart()
        ok('cli', 'user', { org_id: 'org-own' })
        const res = await request(app).patch('/api/users/cli').set('Authorization', bearer('agent', 'org-own'))
          .send({ role: 'agent' })
        expect(res.status, JSON.stringify(res.body)).toBe(200)
        expect(updateUserMock.mock.calls[0][1].manager_id).toBe('supervisor-user')
      })

      it('A1: analista sem chefe não cria nem promove ninguém da equipe', async () => {
        chart({ 'agent-user': { role: 'agent', manager_id: null } })
        ok('cli', 'user', { org_id: 'org-own' })
        const res = await request(app).patch('/api/users/cli').set('Authorization', bearer('agent', 'org-own'))
          .send({ role: 'agent' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('CHIEF_REQUIRED')
      })

      it('A1: gerente não deixa analista do time sem chefe (ele passa a ser o chefe)', async () => {
        chart()
        ok('a1', 'agent', { manager_id: 'supervisor-user' })
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('manager'))
          .send({ manager_id: null })
        expect(res.status).toBe(200)
        expect(updateUserMock.mock.calls[0][1].manager_id).toBe('manager-user')
      })

      it('A3: analista não rebaixa colega a cliente (para depois trocar a senha)', async () => {
        chart()
        ok('a1', 'agent', { manager_id: 'supervisor-user' })
        const res = await request(app).patch('/api/users/a1').set('Authorization', bearer('agent'))
          .send({ role: 'user' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('ROLE_HIERARCHY')
      })

      it('A4: ninguém cria cliente em empresa fora da carteira', async () => {
        chart({ 'agent-user': { role: 'agent', manager_id: 'supervisor-user', org_scopes: [{ org_id: 'org-own' }] },
          'supervisor-user': { role: 'supervisor', manager_id: null, org_scopes: [{ org_id: 'org-own' }] } })
        prismaMock.organization.findUnique.mockResolvedValue({ name: 'Vítima', deleted_at: null })
        const res = await request(app).post('/api/users').set('Authorization', bearer('agent'))
          .send({ name: 'Cliente', email: 'cli@vitima.com', password: 'password123', role: 'user', orgId: 'org-vitima' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('ORG_OUT_OF_SCOPE')
        expect(createUserMock).not.toHaveBeenCalled()
      })

      it('A4: orgId e org_id divergentes são recusados', async () => {
        chart()
        ok('cli', 'user', { org_id: 'org-own' })
        const res = await request(app).patch('/api/users/cli').set('Authorization', bearer('manager', 'org-own'))
          .send({ org_id: 'org-own', orgId: 'org-vitima' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('ORG_MISMATCH')
      })
    })

    describe('B5 — autoedição pela ficha', () => {
      it('analista não troca a própria senha, login, filas nem cargo pela ficha', async () => {
        chart()
        ok('agent-user', 'agent', { manager_id: 'supervisor-user', authProvider: 'microsoft' })
        const res = await request(app).patch('/api/users/agent-user').set('Authorization', bearer('agent'))
          .send({ name: 'Eu', password: 'novaSenha123', authProvider: 'local', queues: ['todas'], role: 'agent', org_scope_ids: ['x'] })
        expect(res.status).toBe(200)
        expect(updateUserMock.mock.calls[0][1]).toEqual({ name: 'Eu' })
      })

      it('ninguém remove o próprio usuário', async () => {
        chart()
        getUserByIdMock.mockResolvedValue(buildUser({ id: 'supervisor-user', role: 'supervisor', org_id: null }))
        const res = await request(app).delete('/api/users/supervisor-user').set('Authorization', bearer('supervisor'))
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('SELF_DELETE')
      })
    })
  })
  describe('módulo Projetos (users.module_projects, herdado pela carteira)', () => {
    it('gerente não altera o próprio acesso — ligar a carteira é decisão do admin', async () => {
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'manager-user', role: 'manager', org_id: 'org-own' }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'manager-user', role: 'manager' }))
      const res = await request(app).patch('/api/users/manager-user').set('Authorization', bearer('manager')).send({ module_projects: true })
      expect(res.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1].module_projects).toBeUndefined()
    })

    it('gerente com o módulo libera um analista da equipe', async () => {
      orgChart({ 'agent-x': { manager_id: 'manager-user' }, 'manager-user': { role: 'manager' } })
      getEffectiveModulesMock.mockResolvedValue({ tickets: true, projects: true, documents: false })
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent', org_id: 'org-own', manager_id: 'manager-user' }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent' }))
      const res = await request(app).patch('/api/users/agent-x').set('Authorization', bearer('manager')).send({ module_projects: true })
      expect(res.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1].module_projects).toBe(true)
    })

    it('gerente sem o módulo não libera para ninguém', async () => {
      orgChart({ 'agent-x': { manager_id: 'manager-user' }, 'manager-user': { role: 'manager' } })
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent', org_id: 'org-own', manager_id: 'manager-user' }))
      const res = await request(app).patch('/api/users/agent-x').set('Authorization', bearer('manager')).send({ module_projects: true })
      expect(res.status).toBe(403)
      expect(updateUserMock).not.toHaveBeenCalled()
    })

    it('reenviar o valor atual (formulário manda o usuário inteiro) não exige o módulo do gerente', async () => {
      orgChart({ 'agent-x': { manager_id: 'manager-user' }, 'manager-user': { role: 'manager' } })
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent', org_id: 'org-own', manager_id: 'manager-user', module_projects: true }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent' }))
      const res = await request(app).patch('/api/users/agent-x').set('Authorization', bearer('manager')).send({ name: 'Novo nome', module_projects: true })
      expect(res.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1].name).toBe('Novo nome')
    })

    it('Documentos segue a mesma regra: só libera quem tem, e cliente final nunca recebe', async () => {
      orgChart({ 'agent-x': { manager_id: 'manager-user' }, 'manager-user': { role: 'manager' } })
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent', org_id: 'org-own', manager_id: 'manager-user' }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent' }))
      const negado = await request(app).patch('/api/users/agent-x').set('Authorization', bearer('manager')).send({ module_documents: true })
      expect(negado.status).toBe(403)
      expect(negado.body.code).toBe('MODULE_NOT_OWNED')

      getEffectiveModulesMock.mockResolvedValue({ tickets: true, projects: false, documents: true })
      const ok = await request(app).patch('/api/users/agent-x').set('Authorization', bearer('manager')).send({ module_documents: true })
      expect(ok.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1].module_documents).toBe(true)

      updateUserMock.mockClear()
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'cli', role: 'user', org_id: 'org-own' }))
      await request(app).patch('/api/users/cli').set('Authorization', bearer('admin', null)).send({ name: 'X', module_documents: true })
      expect(updateUserMock.mock.calls[0][1].module_documents).toBeUndefined()
    })

    it('gerente desliga Chamados de alguém da equipe (time só de projetos)', async () => {
      orgChart({ 'agent-x': { manager_id: 'manager-user' }, 'manager-user': { role: 'manager' } })
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent', org_id: 'org-own', manager_id: 'manager-user', module_tickets: null }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent' }))
      const res = await request(app).patch('/api/users/agent-x').set('Authorization', bearer('manager')).send({ module_tickets: false })
      expect(res.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1].module_tickets).toBe(false)
    })

    it('gerente sem Chamados não liga Chamados para ninguém', async () => {
      orgChart({ 'agent-x': { manager_id: 'manager-user' }, 'manager-user': { role: 'manager' } })
      getEffectiveModulesMock.mockResolvedValue({ tickets: false, projects: true, documents: false })
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent', org_id: 'org-own', manager_id: 'manager-user', module_tickets: false }))
      const res = await request(app).patch('/api/users/agent-x').set('Authorization', bearer('manager')).send({ module_tickets: true })
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('MODULE_NOT_OWNED')
    })

    it('gerente sem Chamados não devolve alguém à herança (que religaria pela cadeia)', async () => {
      orgChart({ 'agent-x': { manager_id: 'manager-user' }, 'manager-user': { role: 'manager' } })
      getEffectiveModulesMock.mockResolvedValue({ tickets: false, projects: true, documents: false })
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'agent-x', role: 'agent', org_id: 'org-own', manager_id: 'manager-user', module_tickets: false }))
      const res = await request(app).patch('/api/users/agent-x').set('Authorization', bearer('manager')).send({ module_tickets: null })
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('MODULE_NOT_OWNED')
    })

    it('módulos não são gravados em cliente final', async () => {
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'cli', role: 'user', org_id: 'org-own' }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'cli', role: 'user' }))
      const res = await request(app).patch('/api/users/cli').set('Authorization', bearer('admin', null)).send({ name: 'X', module_projects: true })
      expect(res.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1].module_projects).toBeUndefined()
    })

    it('gerente não mexe no próprio Chamados', async () => {
      orgChart({ 'manager-user': { role: 'manager' } })
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'manager-user', role: 'manager', org_id: 'org-own' }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'manager-user', role: 'manager' }))
      const res = await request(app).patch('/api/users/manager-user').set('Authorization', bearer('manager')).send({ module_tickets: false })
      expect(res.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1].module_tickets).toBeUndefined()
    })

    it('admin desliga Chamados de um gerente (antes era descartado pelo schema)', async () => {
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'ger', role: 'manager', org_id: 'org-own' }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'ger', role: 'manager' }))
      const res = await request(app).patch('/api/users/ger').set('Authorization', bearer('admin', null)).send({ module_tickets: false, module_projects: true })
      expect(res.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1]).toEqual(expect.objectContaining({ module_tickets: false, module_projects: true }))
    })

    it('admin liga o módulo para a carteira de um gerente', async () => {
      getUserByIdMock.mockResolvedValue(buildUser({ id: 'ger', role: 'manager', org_id: 'org-own' }))
      updateUserMock.mockResolvedValue(buildUser({ id: 'ger', role: 'manager' }))
      const res = await request(app).patch('/api/users/ger').set('Authorization', bearer('admin', null)).send({ module_projects: true })
      expect(res.status).toBe(200)
      expect(updateUserMock.mock.calls[0][1].module_projects).toBe(true)
    })
  })
})
