// Cinco brechas de escalada de acesso (B1–B5), contra o sistema rodando.
// Organograma do seed: gerente → tm → an1, an2 | gerente → tm2 → an3.
// O teste cria um segundo gerente (g2) com um analista (x2) — "outro time" — e só remove esses dois.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PASS, U, PROVISORIA, as, http, trocarProvisoria, login, uid } from './helpers'

const id: Record<string, string> = {}
const created: string[] = []
let an1Perms: string[] = []

const patch = async (who: keyof typeof U, userId: string, body: Record<string, unknown>) =>
  http('PATCH', `/api/users/${userId}`, { token: await as(who), body })
const getUser = async (userId: string) =>
  (await http('GET', `/api/users/${userId}`, { token: await as('admin') })).body.data

beforeAll(async () => {
  for (const k of ['gerente', 'tm', 'tm2', 'an1', 'an3'] as const) id[k] = (await login(U[k])).user.id
  an1Perms = (await getUser(id.an1)).permissions ?? []

  const admin = await as('admin')
  const tag = uid()
  const org_id = (await getUser(id.gerente)).org_id // empresa interna (ISA Interna)
  const g2 = await http('POST', '/api/users', { token: admin, body: { name: `Gerente Dois ${tag}`, email: `g2.${tag}@isa.local`, password: PROVISORIA, role: 'manager', org_id } })
  expect(g2.status, JSON.stringify(g2.body)).toBe(201)
  id.g2 = g2.body.data.id
  created.push(id.g2)
  const x2 = await http('POST', '/api/users', { token: admin, body: { name: `Analista Outro Time ${tag}`, email: `x2.${tag}@isa.local`, password: PROVISORIA, role: 'agent', manager_id: id.g2, org_id } })
  expect(x2.status, JSON.stringify(x2.body)).toBe(201)
  id.x2 = x2.body.data.id
  for (const email of [`g2.${tag}@isa.local`, `x2.${tag}@isa.local`]) await trocarProvisoria(email)
  created.push(id.x2)
})

afterAll(async () => {
  const admin = await as('admin')
  await http('PATCH', `/api/users/${id.an1}`, { token: admin, body: { permissions: an1Perms } })
  await http('PATCH', `/api/manager-links/analysts/${id.gerente}/global`, { token: admin, body: { managerGlobal: false } })
  for (const u of created.reverse()) await http('DELETE', `/api/users/${u}`, { token: admin })
})

describe('B1 — "todas as empresas" só pelo admin', () => {
  it('gerente não liga em si mesmo', async () => {
    const r = await http('PATCH', `/api/manager-links/analysts/${id.gerente}/global`, { token: await as('gerente'), body: { managerGlobal: true } })
    expect(r.status).toBe(403)
    expect((await getUser(id.gerente)).manager_global).toBe(false)
  })

  it('admin liga e desliga', async () => {
    const admin = await as('admin')
    const on = await http('PATCH', `/api/manager-links/analysts/${id.gerente}/global`, { token: admin, body: { managerGlobal: true } })
    expect(on.status).toBe(200)
    const off = await http('PATCH', `/api/manager-links/analysts/${id.gerente}/global`, { token: admin, body: { managerGlobal: false } })
    expect(off.body.data.manager_global).toBe(false)
  })
})

describe('B2 — permissões', () => {
  it('gerente não muda as próprias permissões', async () => {
    const before = (await getUser(id.gerente)).permissions
    const r = await patch('gerente', id.gerente, { permissions: ['webhooks', 'trash'] })
    expect(r.status).toBe(200)
    expect((await getUser(id.gerente)).permissions).toEqual(before)
  })

  it('gerente não concede área que não tem', async () => {
    const r = await patch('gerente', id.an1, { permissions: ['orgs', 'webhooks'] })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('PERMISSION_NOT_OWNED')
  })

  it('nome de permissão desconhecido é recusado', async () => {
    const r = await patch('gerente', id.an1, { permissions: ['orgs', 'superpoder'] })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('UNKNOWN_PERMISSION')
  })

  it('gerente concede ao time uma área que tem', async () => {
    const r = await patch('gerente', id.an1, { permissions: ['orgs', 'users', 'macros'] })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect((await getUser(id.an1)).permissions.sort()).toEqual(['macros', 'orgs', 'users'])
  })
})

describe('B3 — "Usuários" não fura o cargo', () => {
  it('analista com "Usuários" não edita nem remove o gerente', async () => {
    await http('PATCH', `/api/users/${id.an1}`, { token: await as('admin'), body: { permissions: ['orgs', 'users'] } })
    const e = await patch('an1', id.gerente, { name: 'Renomeado pelo analista' })
    expect(e.status).toBe(403)
    const d = await http('DELETE', `/api/users/${id.gerente}`, { token: await as('an1') })
    expect(d.status).toBe(403)
    expect((await getUser(id.gerente)).name).not.toBe('Renomeado pelo analista')
  })

  it('analista com "Usuários" não cria Ticket Manager', async () => {
    const r = await http('POST', '/api/users', { token: await as('an1'), body: { name: 'TM falso', email: `tmf.${uid()}@isa.local`, password: PASS, role: 'supervisor' } })
    expect(r.status).toBe(403)
    if (r.status === 201) created.push(r.body.data.id)
  })
})

describe('B4 — Gerente e TM só no próprio time', () => {
  it('TM não troca a senha de analista de outro time', async () => {
    const r = await patch('tm', id.x2, { password: 'Invasao@123' })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('NOT_IN_TEAM')
  })

  it('gerente não edita analista de outro gerente', async () => {
    const r = await patch('gerente', id.x2, { name: 'Mexido' })
    expect(r.status).toBe(403)
  })

  it('TM2 não edita analista do TM', async () => {
    const r = await patch('tm2', id.an1, { active: false })
    expect(r.status).toBe(403)
    expect((await getUser(id.an1)).active).toBe(true)
  })

  it('gerente edita analista dois níveis abaixo', async () => {
    const r = await patch('gerente', id.an3, { position: `Analista ${uid()}` })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
  })

  it('gerente não move analista do time para outro gerente', async () => {
    const r = await patch('gerente', id.an1, { manager_id: id.g2 })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CHIEF_OUT_OF_TEAM')
    expect((await getUser(id.an1)).manager_id).toBe(id.tm)
  })

  it('TM não puxa analista de outro time para si', async () => {
    const r = await patch('tm', id.x2, { manager_id: id.tm })
    expect(r.status).toBe(403)
    expect((await getUser(id.x2)).manager_id).toBe(id.g2)
  })
})

describe('B5 — autoedição pela ficha', () => {
  it('analista não troca a própria senha nem as filas pela ficha', async () => {
    const queues = (await getUser(id.an1)).queues
    const r = await patch('an1', id.an1, { password: 'Trocada@123', queues: ['geral', 'vip', 'sistemas', 'especializada'], phone: '(11) 90000-0000' })
    expect(r.status).toBe(200)
    const after = await getUser(id.an1)
    expect(after.queues).toEqual(queues)
    expect(after.phone).toBe('(11) 90000-0000')
    expect((await login(U.an1)).token).toBeTruthy() // senha antiga continua valendo
  })

  it('ninguém remove o próprio usuário', async () => {
    const r = await http('DELETE', `/api/users/${id.tm}`, { token: await as('tm') })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('SELF_DELETE')
  })
})

describe('caminhos alternativos (revisão de segurança)', () => {
  it('A2: carteira do gerente pela tela da empresa só com o admin', async () => {
    const acme = (await http('GET', '/api/organizations', { token: await as('admin') })).body.data.find((o: any) => /acme/i.test(o.name))
    const r = await http('POST', `/api/organizations/${acme.id}/served-by`, { token: await as('gerente'), body: { userId: id.g2 } })
    expect(r.status).toBe(403)
  })

  it('A4: analista não cria cliente de empresa fora da carteira', async () => {
    const initech = (await http('GET', '/api/organizations', { token: await as('admin') })).body.data.find((o: any) => /initech/i.test(o.name))
    const r = await http('POST', '/api/users', { token: await as('an1'), body: { name: 'Laranja', email: `lar.${uid()}@isa.local`, password: PASS, role: 'user', orgId: initech.id } })
    expect(r.status).toBe(403)
    if (r.status === 201) created.push(r.body.data.id)
  })

  it('A3: analista não rebaixa colega a cliente', async () => {
    const an2 = (await login(U.an2)).user.id
    const r = await patch('an1', an2, { role: 'user' })
    expect(r.status).toBe(403)
    expect((await getUser(an2)).role).toBe('agent')
  })

  it('analista com "Filas" não se coloca em outras filas', async () => {
    await http('PATCH', `/api/users/${id.an1}`, { token: await as('admin'), body: { permissions: ['orgs', 'users', 'queues'] } })
    const r = await http('POST', '/api/queues/especializada/agents', { token: await as('an1'), body: { userIds: [id.an1] } })
    expect(r.status).toBe(403)
    expect((await getUser(id.an1)).queues).not.toContain('especializada')
  })
})
