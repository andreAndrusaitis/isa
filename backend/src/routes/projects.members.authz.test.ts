// Gestão de membros: sem escalada para dono, sem projeto órfão de dono e só
// entra quem pode usar o módulo. Prisma real: rodar contra banco de teste.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'

const S = `mem-${Date.now()}`
const u: Record<string, string> = {}
let projectId = ''
const as = (who: string) => `Bearer ${jwt.sign({ sub: u[who], role: 'agent', orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`
const role = async (who: string) => (await prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: u[who] } } }))?.role

beforeAll(async () => {
  for (const [k, extra] of Object.entries({ dono: {}, gerente: {}, colega: {}, novo: {}, semModulo: { module_projects: false }, cliente: { role: 'user' }, inativo: { active: false } } as Record<string, any>)) {
    u[k] = (await prisma.user.create({ data: { name: k, email: `${k}-${S}@t.local`, role: 'agent', module_projects: true, ...extra } })).id
  }
  projectId = (await prisma.project.create({
    data: { name: `P ${S}`, owner_id: u.dono, members: { create: [{ user_id: u.dono, role: 'owner' }, { user_id: u.gerente, role: 'manager' }, { user_id: u.colega, role: 'member' }] } },
  })).id
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: projectId } })
  await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } })
})

describe('membros do projeto', () => {
  it('gerente do projeto não adiciona ninguém como dono', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/members`).set('Authorization', as('gerente')).send({ userId: u.novo, role: 'owner' })
    expect(res.status).toBe(403)
  })

  it('gerente do projeto não remove o dono', async () => {
    const res = await request(app).delete(`/api/projects/${projectId}/members/${u.dono}`).set('Authorization', as('gerente'))
    expect(res.status).toBe(403)
    expect(await role('dono')).toBe('owner')
  })

  it('não remove nem rebaixa o último dono', async () => {
    const del = await request(app).delete(`/api/projects/${projectId}/members/${u.dono}`).set('Authorization', as('dono'))
    expect(del.status).toBe(400)
    const demote = await request(app).patch(`/api/projects/${projectId}/members/${u.dono}`).set('Authorization', as('dono')).send({ role: 'member' })
    expect(demote.status).toBe(400)
    expect(await role('dono')).toBe('owner')
  })

  it('só entra quem pode usar o módulo (ativo, com módulo, não cliente)', async () => {
    for (const who of ['semModulo', 'cliente', 'inativo']) {
      const res = await request(app).post(`/api/projects/${projectId}/members`).set('Authorization', as('dono')).send({ userId: u[who], role: 'member' })
      expect(res.status, who).toBe(400)
    }
  })

  it('gerente do projeto adiciona membro comum normalmente', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/members`).set('Authorization', as('gerente')).send({ userId: u.novo, role: 'member' })
    expect(res.status).toBe(201)
    expect(await role('novo')).toBe('member')
  })
})
