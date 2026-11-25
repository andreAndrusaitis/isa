import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { issueTokens } from '../services/auth'
import * as McpTokens from '../services/mcpTokens'

vi.mock('../services/email/mailer', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendWelcomeEmail: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
}))

// Banco real. Organograma: chefe (carteira X e Y) → analistas A e B (só X) e TM → analista C.
// Outro gerente (carteira Y) fica fora da árvore.
const S = `acc-${Date.now()}`
const u: Record<string, any> = {}
const orgs: Record<string, string> = {}
const createdIds: string[] = []

const bearer = (user: { id: string; role: string; org_id?: string | null }) =>
  `Bearer ${jwt.sign({ sub: user.id, role: user.role, orgId: user.org_id ?? null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`

async function mkUser(key: string, data: Record<string, any>, scope: string[] = []) {
  const user = await prisma.user.create({ data: { name: `${key} ${S}`, email: `${key}-${S}@t.local`, password: 'hash-de-fixture', ...data } as any })
  if (scope.length) await prisma.userOrgScope.createMany({ data: scope.map(org_id => ({ user_id: user.id, org_id })) })
  u[key] = user
  createdIds.push(user.id)
  return user
}

const api = (by: any) => ({
  get: (url: string) => request(app).get(url).set('Authorization', bearer(by)),
  post: (url: string, body: object) => request(app).post(url).set('Authorization', bearer(by)).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set('Authorization', bearer(by)).send(body),
})

const newAgent = (extra: object = {}) => ({
  name: 'Novo', email: `novo-${createdIds.length}-${Math.random().toString(36).slice(2)}-${S}@t.local`,
  password: 'senha-de-teste', role: 'agent', orgId: orgs.x, ...extra,
})

function track(res: request.Response) {
  if (res.body?.data?.id) createdIds.push(res.body.data.id)
  return res
}

beforeAll(async () => {
  orgs.x = (await prisma.organization.create({ data: { name: `X ${S}`, domains: [], notes: 'observacao-interna' } })).id
  orgs.y = (await prisma.organization.create({ data: { name: `Y ${S}`, domains: [] } })).id

  await mkUser('chefe', { role: 'manager', org_id: orgs.x }, [orgs.x, orgs.y])
  await mkUser('outroGerente', { role: 'manager', org_id: orgs.y }, [orgs.y])
  await mkUser('tm', { role: 'supervisor', org_id: orgs.x, manager_id: u.chefe.id })
  await mkUser('a', { role: 'agent', org_id: orgs.x, manager_id: u.chefe.id, queues: ['fila-a'] }, [orgs.x])
  await mkUser('b', { role: 'agent', org_id: orgs.x, manager_id: u.chefe.id, queues: ['fila-b'] }, [orgs.x])
  await mkUser('herda', { role: 'agent', org_id: orgs.x, manager_id: u.chefe.id })
  await mkUser('c', { role: 'agent', org_id: orgs.x, manager_id: u.tm.id })
  await mkUser('clienteX', { role: 'user', org_id: orgs.x, password: await bcrypt.hash('senha-antiga', 4) })
  await mkUser('clienteY', { role: 'user', org_id: orgs.y })
  await mkUser('admin', { role: 'admin', password: await bcrypt.hash('senha-antiga', 4) })
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { user_id: { in: createdIds } } })
  await prisma.refreshToken.deleteMany({ where: { user_id: { in: createdIds } } })
  await prisma.userOrgScope.deleteMany({ where: { user_id: { in: createdIds } } })
  await prisma.user.updateMany({ where: { id: { in: createdIds } }, data: { manager_id: null } })
  await prisma.user.deleteMany({ where: { id: { in: createdIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: Object.values(orgs) } } })
})

describe('GET /api/users/:id', () => {
  it('cliente só pela carteira de quem consulta', async () => {
    const fora = await api(u.a).get(`/api/users/${u.clienteY.id}`)
    expect(fora.status).toBe(403)
    expect(fora.body.code).toBe('ORG_OUT_OF_SCOPE')

    expect((await api(u.a).get(`/api/users/${u.clienteX.id}`)).status).toBe(200)
    expect((await api(u.chefe).get(`/api/users/${u.clienteY.id}`)).status).toBe(200)
  })

  it('colega de equipe continua visível, mesmo fora do time', async () => {
    expect((await api(u.a).get(`/api/users/${u.b.id}`)).status).toBe(200)
    expect((await api(u.a).get(`/api/users/${u.outroGerente.id}`)).status).toBe(200)
  })

  it('não leva a ficha da empresa junto com a pessoa', async () => {
    const res = await api(u.a).get(`/api/users/${u.clienteX.id}`)
    expect(res.body.data.org).toEqual({ id: orgs.x, name: `X ${S}` })
    expect(JSON.stringify(res.body)).not.toContain('observacao-interna')
    expect(res.body.data.password).toBeUndefined()
  })
})

describe('GET /api/users/:id/scope', () => {
  it('abre a própria, a de quem está abaixo e a dos chefes acima', async () => {
    expect((await api(u.tm).get(`/api/users/${u.tm.id}/scope`)).status).toBe(200)
    expect((await api(u.tm).get(`/api/users/${u.c.id}/scope`)).status).toBe(200)
    expect((await api(u.tm).get(`/api/users/${u.chefe.id}/scope`)).status).toBe(200)
  })

  it('fecha a de quem está fora da árvore', async () => {
    const res = await api(u.tm).get(`/api/users/${u.outroGerente.id}/scope`)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_IN_TEAM')
    expect((await api(u.outroGerente).get(`/api/users/${u.c.id}/scope`)).status).toBe(403)
  })

  it('o admin segue vendo todas', async () => {
    expect((await api(u.admin).get(`/api/users/${u.c.id}/scope`)).status).toBe(200)
  })
})

describe('Analista não dá mais do que tem', () => {
  it('não cria colega que herda carteira maior que a dele', async () => {
    const res = await api(u.a).post('/api/users', newAgent())
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('CARTEIRA_INHERIT_RESTRICTED')
  })

  it('cria colega com empresas da própria carteira e filas que tem', async () => {
    const res = track(await api(u.a).post('/api/users', newAgent({ org_scope_ids: [orgs.x], queues: ['fila-a'] })))
    expect(res.status).toBe(201)
  })

  it('analista que já herda a carteira do chefe cria colega que herda', async () => {
    const res = track(await api(u.herda).post('/api/users', newAgent()))
    expect(res.status).toBe(201)
  })

  it('não cria conta com fila que não tem', async () => {
    const res = await api(u.a).post('/api/users', newAgent({ org_scope_ids: [orgs.x], queues: ['fila-a', 'fila-alheia'] }))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('QUEUE_NOT_OWNED')
  })

  it('cliente criado com fila alheia também é recusado (promoção depois não lava a fila)', async () => {
    const res = await api(u.a).post('/api/users', { ...newAgent({ queues: ['fila-alheia'] }), role: 'user' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('QUEUE_NOT_OWNED')
  })

  it('não limpa a carteira de colega para ele herdar a do chefe', async () => {
    const res = await api(u.a).patch(`/api/users/${u.b.id}`, { org_scope_ids: [] })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('CARTEIRA_INHERIT_RESTRICTED')
    expect(await prisma.userOrgScope.count({ where: { user_id: u.b.id } })).toBe(1)
  })

  it('não promove cliente a analista que herda a carteira do chefe', async () => {
    const res = await api(u.a).patch(`/api/users/${u.clienteX.id}`, { role: 'agent' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('CARTEIRA_INHERIT_RESTRICTED')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.clienteX.id } })).role).toBe('user')
  })

  it('não dá a colega fila que não tem, mas o colega mantém as dele', async () => {
    const alheia = await api(u.a).patch(`/api/users/${u.b.id}`, { queues: ['fila-b', 'fila-alheia'] })
    expect(alheia.status).toBe(403)
    expect(alheia.body.code).toBe('QUEUE_NOT_OWNED')

    const propria = await api(u.a).patch(`/api/users/${u.b.id}`, { queues: ['fila-b', 'fila-a'] })
    expect(propria.status).toBe(200)
    expect(propria.body.data.queues).toEqual(['fila-b', 'fila-a'])
  })

  it('colega sem filas gravadas (coluna nula) recebe fila do Analista sem erro', async () => {
    const res = await api(u.a).patch(`/api/users/${u.herda.id}`, { queues: ['fila-a'] })
    expect(res.status).toBe(200)
    await prisma.user.update({ where: { id: u.herda.id }, data: { queues: [] } })
  })

  it('salvar a ficha de quem já herda segue funcionando (a tela reenvia carteira vazia)', async () => {
    const res = await api(u.a).patch(`/api/users/${u.herda.id}`, { phone: '11999998888', org_scope_ids: [], queues: [] })
    expect(res.status).toBe(200)
  })

  it('TM e Gerente estão na cadeia de quem criam: herdar segue valendo', async () => {
    const res = track(await api(u.tm).post('/api/users', newAgent({ queues: ['qualquer-fila'] })))
    expect(res.status).toBe(201)
    expect(res.body.data.manager_id).toBe(u.tm.id)
  })
})

describe('GET /api/users/me/stats', () => {
  beforeAll(async () => {
    await prisma.auditLog.create({ data: { user_id: u.chefe.id, action: 'LOGIN', resource: 'AUTH' } })
  })

  it('cliente não recebe a lista da equipe', async () => {
    const res = await api(u.clienteX).get('/api/users/me/stats')
    expect(res.status).toBe(200)
    expect(res.body.data.onlineTeam).toEqual([])
  })

  it('equipe segue recebendo', async () => {
    const res = await api(u.a).get('/api/users/me/stats')
    expect(res.body.data.onlineTeam.map((m: any) => m.id)).toContain(u.chefe.id)
  })
})

describe('Senha redefinida pela ficha', () => {
  it('por outra pessoa derruba refresh, access e tokens MCP do alvo', async () => {
    const { accessToken, refreshToken } = await issueTokens(u.clienteX)
    const mcp = await McpTokens.createMcpToken(u.clienteX.id, { name: 'Cliente MCP' })
    const me = () => request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)
    expect((await me()).status).toBe(200)

    const res = await api(u.chefe).patch(`/api/users/${u.clienteX.id}`, { password: 'senha-nova-123' })
    expect(res.status).toBe(200)

    expect((await me()).status).toBe(401)
    expect(await prisma.refreshToken.count({ where: { user_id: u.clienteX.id } })).toBe(0)
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', `isa_rt=${refreshToken}`)
    expect(refresh.status).toBe(401)
    expect(await McpTokens.resolveUserIdFromToken(mcp.token)).toBeNull()
  })

  it('editar a ficha sem senha não derruba ninguém', async () => {
    const { accessToken } = await issueTokens(u.b)
    await api(u.chefe).patch(`/api/users/${u.b.id}`, { phone: '11988887777' })
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200)
    expect(await prisma.refreshToken.count({ where: { user_id: u.b.id } })).toBe(1)
  })

  it('o admin trocando a própria pela ficha mantém a sessão', async () => {
    const { accessToken } = await issueTokens(u.admin)
    const res = await request(app).patch(`/api/users/${u.admin.id}`)
      .set('Authorization', `Bearer ${accessToken}`).send({ password: 'senha-nova-123' })
    expect(res.status).toBe(200)
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200)
  })
})

describe('Avatar gravado pela ficha', () => {
  it('nome de blob fora de avatars/ não é gravado: a leitura assinaria arquivo alheio', async () => {
    const admin = await mkUser('admAvatar', { role: 'admin' })
    const alvo = await mkUser('alvoAvatar', { role: 'agent' })

    const r = await api(admin).patch(`/api/users/${alvo.id}`, { avatar: 'tickets/outro-chamado/segredo.png' })
    expect(r.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alvo.id } })).avatar).toBeNull()
  })

  it('avatar da própria pasta continua valendo', async () => {
    const admin = await mkUser('admAvatar2', { role: 'admin' })
    const alvo = await mkUser('alvoAvatar2', { role: 'agent' })

    const r = await api(admin).patch(`/api/users/${alvo.id}`, { avatar: 'avatars/foto.png' })
    expect(r.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alvo.id } })).avatar).toBe('avatars/foto.png')
  })
})
