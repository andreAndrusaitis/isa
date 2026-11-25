// API pública de Projetos (/api/integrations/v1/projects): chave isaproj_ gerada
// no painel, alcance por projeto, escopos, idempotência, contrato snake_case e
// ações assinadas pelo usuário de serviço da chave. Prisma real.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { PROJECT_API_SCOPES } from '../services/projectApiKeys'

const S = `papi-${Date.now()}`
const ids: Record<string, string> = {}
const keys: Record<string, string> = {}
const keyIds: string[] = []
const bearer = (sub: string, role = 'agent') => `Bearer ${jwt.sign({ sub, role, orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`
const V1 = '/api/integrations/v1/projects'
const as = (key: string) => ({ Authorization: `Bearer ${key}` })

async function makeKey(userId: string, role: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/projects/api-keys').set('Authorization', bearer(userId, role)).send(body)
  if (res.status === 201) keyIds.push(res.body.data.id)
  return res
}

/** Nenhuma chave com letra maiúscula em todo o corpo (exceto dados opacos). */
function camelKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => camelKeys(v, `${path}[${i}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
    ...(/[A-Z]/.test(k) ? [`${path}.${k}`] : []),
    ...(['content', 'value', 'recurrence', 'payload'].includes(k) ? [] : camelKeys(v, `${path}.${k}`)),
  ])
}

beforeAll(async () => {
  const adm = await prisma.user.create({ data: { name: 'Adm', email: `adm-${S}@t.local`, role: 'admin' } })
  const ana = await prisma.user.create({ data: { name: 'Ana', email: `ana-${S}@t.local`, role: 'agent', module_projects: true, permissions: ['projects_integrations'] } })
  const bia = await prisma.user.create({ data: { name: 'Bia', email: `bia-${S}@t.local`, role: 'agent', module_projects: true, permissions: ['projects_integrations'] } })
  Object.assign(ids, { adm: adm.id, ana: ana.id, bia: bia.id })
  // Ana é dona do pA; pB é da Bia (Ana nem participa).
  ids.pA = (await request(app).post('/api/projects').set('Authorization', bearer(ana.id)).send({ name: `A ${S}` })).body.data.id
  ids.pB = (await request(app).post('/api/projects').set('Authorization', bearer(bia.id)).send({ name: `B ${S}` })).body.data.id

  keys.global = (await makeKey(adm.id, 'admin', { name: `Global ${S}`, scopes: [...PROJECT_API_SCOPES] })).body.data.key
  keys.ana = (await makeKey(ana.id, 'agent', { name: `Ana ${S}`, scopes: [...PROJECT_API_SCOPES], projectIds: [ids.pA] })).body.data.key
  keys.readOnly = (await makeKey(ana.id, 'agent', { name: `Leitura ${S}`, scopes: ['read_projects', 'read_tasks'], projectIds: [ids.pA] })).body.data.key
})

afterAll(async () => {
  const serviceUsers = (await prisma.projectApiKey.findMany({ where: { id: { in: keyIds } }, select: { service_user_id: true } })).map((k) => k.service_user_id)
  const projectIds = [ids.pA, ids.pB, ids.pNew].filter(Boolean)
  await prisma.projectApiKey.deleteMany({ where: { id: { in: keyIds } } })
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.adm, ids.ana, ids.bia, ...serviceUsers] } } })
})

describe('painel de chaves', () => {
  it('chave nasce isaproj_, aparece uma vez só e tem usuário de serviço próprio', async () => {
    expect(keys.ana).toMatch(/^isaproj_[0-9a-f]{64}$/)
    const list = await request(app).get('/api/projects/api-keys').set('Authorization', bearer(ids.ana))
    const mine = list.body.data.find((k: any) => k.name === `Ana ${S}`)
    expect(mine.key).toBeUndefined()
    expect(mine.projectIds).toEqual([ids.pA])
    const service = await prisma.user.findUniqueOrThrow({ where: { id: mine.serviceUserId } })
    expect(service).toMatchObject({ name: `API · Ana ${S}`, is_service_account: true, password: null })
  })

  it('analista não cria chave global nem para projeto que não gere', async () => {
    expect((await makeKey(ids.ana, 'agent', { name: 'x', scopes: ['read_tasks'] })).status).toBe(403)
    expect((await makeKey(ids.ana, 'agent', { name: 'x', scopes: ['read_tasks'], projectIds: [ids.pB] })).status).toBe(403)
  })

  it('usuário de serviço não faz login nem aparece na gestão de usuários', async () => {
    const key = await prisma.projectApiKey.findFirstOrThrow({ where: { id: { in: keyIds } }, include: { service_user: true } })
    const login = await request(app).post('/api/auth/login').send({ email: key.service_user.email, password: 'qualquer' })
    expect(login.status).toBe(401)
    const users = await request(app).get('/api/users').set('Authorization', bearer(ids.adm, 'admin'))
    expect(JSON.stringify(users.body)).not.toContain(key.service_user.email)
  })
})

describe('autenticação, escopo e alcance', () => {
  it('sem chave, chave inválida ou chave da API de chamados: 401', async () => {
    expect((await request(app).get(V1)).status).toBe(401)
    expect((await request(app).get(V1).set(as('isaproj_errada'))).status).toBe(401)
    expect((await request(app).get(V1).set(as(`isakey_${'0'.repeat(64)}`))).status).toBe(401)
  })

  it('chave restrita só enxerga os próprios projetos; o resto é 404', async () => {
    const list = await request(app).get(V1).set(as(keys.ana))
    expect(list.status).toBe(200)
    expect(list.body.data.map((p: any) => p.id)).toEqual([ids.pA])
    expect(list.body.pagination).toMatchObject({ page: 1, total: 1 })
    expect((await request(app).get(`${V1}/${ids.pB}`).set(as(keys.ana))).status).toBe(404)
    expect((await request(app).get(`${V1}/${ids.pB}/tasks`).set(as(keys.ana))).status).toBe(404)
  })

  it('escopo ausente: 403', async () => {
    const res = await request(app).post(`${V1}/${ids.pA}/tasks`).set(as(keys.readOnly)).send({ title: 'x' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('API_KEY_SCOPE_DENIED')
  })

  it('chave restrita não cria projeto', async () => {
    expect((await request(app).post(V1).set(as(keys.ana)).send({ name: 'Novo', owner_email: `ana-${S}@t.local` })).status).toBe(403)
  })

  it('rota desconhecida responde 404 da própria API', async () => {
    const res = await request(app).get(`${V1}/${ids.pA}/nada`).set(as(keys.ana))
    expect(res.status).toBe(404)
  })
})

describe('fluxo completo pela API', () => {
  it('cria projeto (chave global), task sem status, lê pela chave do tipo, edita, comenta e conclui', async () => {
    const g = as(keys.global)
    const proj = await request(app).post(V1).set(g).send({ name: `Novo ${S}`, owner_email: `ana-${S}@t.local`, target_date: '2026-12-31T00:00:00.000Z' })
    expect(proj.status).toBe(201)
    expect(proj.body).toMatchObject({ duplicate: false, resource_type: 'project' })
    ids.pNew = proj.body.resource_id
    expect(await prisma.projectMember.findFirst({ where: { project_id: ids.pNew, user_id: ids.ana, role: 'owner' } })).not.toBeNull()

    const created = await request(app).post(`${V1}/${ids.pNew}/tasks`).set(g).send({ title: 'Integrar ERP', priority: 'high', external_request_id: `t1-${S}` })
    expect(created.status).toBe(201)
    const task = created.body.data
    expect(task.status_id).toBeTruthy()
    expect(task.creator_id).not.toBe(ids.adm)

    // Mesma requisição de novo: não duplica.
    const again = await request(app).post(`${V1}/${ids.pNew}/tasks`).set(g).send({ title: 'Integrar ERP', priority: 'high', external_request_id: `t1-${S}` })
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ duplicate: true, resource_id: task.id })
    expect(await prisma.task.count({ where: { project_id: ids.pNew } })).toBe(1)

    const byKey = await request(app).get(`${V1}/${ids.pNew}/tasks/${task.key}`).set(g)
    expect(byKey.status).toBe(200)
    expect(byKey.body.data.id).toBe(task.id)
    expect((await request(app).get(`${V1}/${ids.pNew}/tasks/${task.seq}`).set(g)).body.data.id).toBe(task.id)
    expect(camelKeys(byKey.body)).toEqual([])

    const statuses = (await request(app).get(`${V1}/${ids.pNew}/statuses`).set(g)).body.data
    const doing = statuses.find((s: any) => s.category === 'in_progress') ?? statuses[1]
    const patched = await request(app).patch(`${V1}/${ids.pNew}/tasks/${task.id}`).set(g).send({ status_id: doing.id, due_date: '2026-11-30T00:00:00.000Z' })
    expect(patched.status).toBe(200)
    expect(patched.body.data.status_id).toBe(doing.id)

    // O histórico mostra a chave, não uma pessoa.
    const activity = await prisma.taskActivity.findFirstOrThrow({ where: { task_id: task.id, type: 'status_changed' }, include: { actor: true } })
    expect(activity.actor.name).toBe(`API · Global ${S}`)

    const comment = await request(app).post(`${V1}/${ids.pNew}/tasks/${task.id}/comments`).set(g).send({ body: 'Sincronizado com o ERP' })
    expect(comment.status).toBe(201)
    const edited = await request(app).patch(`${V1}/${ids.pNew}/tasks/${task.id}/comments/${comment.body.resource_id}`).set(g).send({ body: 'Sincronizado (v2)' })
    expect(edited.body.data.body).toBe('Sincronizado (v2)')

    const checklist = await request(app).post(`${V1}/${ids.pNew}/tasks/${task.id}/checklist`).set(g).send({ text: 'Mapear campos' })
    expect(checklist.status).toBe(201)
    expect((await request(app).get(`${V1}/${ids.pNew}/tasks/${task.id}/checklist`).set(g)).body.data).toHaveLength(1)
    // Checklist pendente barra a conclusão, como na tela.
    expect((await request(app).post(`${V1}/${ids.pNew}/tasks/${task.id}/complete`).set(g).send({})).body.code).toBe('TASK_COMPLETION_BLOCKED')
    await request(app).patch(`${V1}/${ids.pNew}/tasks/${task.id}/checklist/${checklist.body.resource_id}`).set(g).send({ done: true })

    const done = await request(app).post(`${V1}/${ids.pNew}/tasks/${task.id}/complete`).set(g).send({})
    expect(done.status).toBe(200)
    expect(done.body.data.outcome).toBe('completed')

    const listed = await request(app).get(`${V1}/${ids.pNew}/tasks?per_page=1`).set(g)
    expect(listed.body.pagination).toMatchObject({ per_page: 1, total: 1 })
    expect(listed.body.data[0].status.category).toBe('done')

    const log = await request(app).get(`/api/projects/api-keys/${keyIds[0]}/requests`).set('Authorization', bearer(ids.adm, 'admin'))
    expect(log.body.data.length).toBeGreaterThan(3)
    expect(log.body.data.every((r: any) => r.projectApiKeyId === keyIds[0])).toBe(true)
  }, 15_000) // fluxo longo (~10 chamadas HTTP com banco real): 5 s padrão estoura em máquina carregada

  it('membros: adiciona por e-mail e troca papel, mas não mexe em dono', async () => {
    const k = as(keys.ana)
    const add = await request(app).post(`${V1}/${ids.pA}/members`).set(k).send({ email: `bia-${S}@t.local`, role: 'viewer' })
    expect(add.status).toBe(201)
    expect((await request(app).patch(`${V1}/${ids.pA}/members/${ids.bia}`).set(k).send({ role: 'member' })).status).toBe(200)
    expect((await request(app).post(`${V1}/${ids.pA}/members`).set(k).send({ user_id: ids.adm, role: 'owner' })).status).toBe(400)
    expect((await request(app).patch(`${V1}/${ids.pA}/members/${ids.ana}`).set(k).send({ role: 'viewer' })).status).toBe(403)
    expect((await request(app).delete(`${V1}/${ids.pA}/members/${ids.ana}`).set(k)).status).toBe(403)
    expect((await request(app).delete(`${V1}/${ids.pA}/members/${ids.bia}`).set(k)).status).toBe(200)
  })

  it('não referencia recurso de outro projeto (status, dependência, anexo)', async () => {
    const g = as(keys.global)
    const statusB = (await request(app).get(`${V1}/${ids.pB}/statuses`).set(g)).body.data[0].id
    expect((await request(app).post(`${V1}/${ids.pA}/tasks`).set(g).send({ title: 'x', status_id: statusB })).status).toBe(400)
    const tA = (await request(app).post(`${V1}/${ids.pA}/tasks`).set(g).send({ title: 'em A' })).body.data
    const tB = (await request(app).post(`${V1}/${ids.pB}/tasks`).set(g).send({ title: 'em B' })).body.data
    expect((await request(app).post(`${V1}/${ids.pA}/tasks/${tA.id}/dependencies`).set(g).send({ depends_on_id: tB.id })).status).toBe(400)
    expect((await request(app).get(`${V1}/${ids.pA}/tasks/${tB.id}`).set(g)).status).toBe(404)
    const attach = await request(app).post(`${V1}/${ids.pA}/attachments`).set(g).send({ entity_type: 'task', entity_id: tB.id, file_name: 'a.txt', data_uri: 'data:text/plain;base64,b2k=' })
    expect(attach.status).toBe(400)
  })

  it('dono da chave que vira leitor do projeto: a chave perde o acesso', async () => {
    const key = await makeKey(ids.bia, 'agent', { name: `Bia ${S}`, scopes: ['read_projects'], projectIds: [ids.pB] })
    expect((await request(app).get(`${V1}/${ids.pB}`).set(as(key.body.data.key))).status).toBe(200)
    await prisma.projectMember.updateMany({ where: { project_id: ids.pB, user_id: ids.bia }, data: { role: 'viewer' } })
    expect((await request(app).get(`${V1}/${ids.pB}`).set(as(key.body.data.key))).status).toBe(404)
    await prisma.projectMember.updateMany({ where: { project_id: ids.pB, user_id: ids.bia }, data: { role: 'owner' } })
  })

  it('excluir a chave invalida o token e desativa o usuário de serviço', async () => {
    const created = (await makeKey(ids.ana, 'agent', { name: `Temp ${S}`, scopes: ['read_projects'], projectIds: [ids.pA] })).body.data
    expect((await request(app).delete(`/api/projects/api-keys/${created.id}`).set('Authorization', bearer(ids.ana))).status).toBe(204)
    expect((await request(app).get(V1).set(as(created.key))).status).toBe(401)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.serviceUserId } })).active).toBe(false)
    await prisma.user.delete({ where: { id: created.serviceUserId } })
  })
})

describe('task completa e chave criada por membro', () => {
  it('GET da task e da lista trazem tudo: descrição, pessoas com e-mail, status, campos, comentários e link', async () => {
    const g = as(keys.global)
    await prisma.projectMember.upsert({
      where: { project_id_user_id: { project_id: ids.pA, user_id: ids.bia } },
      create: { project_id: ids.pA, user_id: ids.bia, role: 'member' }, update: { role: 'member' },
    })
    const field = (await request(app).post(`${V1}/${ids.pA}/custom-fields`).set(g).send({ name: 'Cliente', type: 'text' })).body.data
    const task = (await request(app).post(`${V1}/${ids.pA}/tasks`).set(g).send({
      title: 'Completa', description: 'Descrição longa\ncom duas linhas', priority: 'high', assignee_id: ids.ana,
    })).body.data
    expect(task.description).toBe('Descrição longa\ncom duas linhas')
    await request(app).put(`${V1}/${ids.pA}/tasks/${task.id}/assignees`).set(g).send({ user_ids: [ids.ana, ids.bia] })
    await request(app).put(`${V1}/${ids.pA}/tasks/${task.id}/custom-fields/${field.id}`).set(g).send({ value: 'ACME' })
    await request(app).post(`${V1}/${ids.pA}/tasks/${task.id}/comments`).set(g).send({ body: 'olá' })

    const full = (await request(app).get(`${V1}/${ids.pA}/tasks/${task.key}`).set(g)).body.data
    expect(full).toMatchObject({
      description: 'Descrição longa\ncom duas linhas',
      priority: 'high',
      number: `#${task.seq}`,
      status: { name: expect.any(String), category: expect.any(String) },
      task_type: { name: expect.any(String), prefix: expect.any(String) },
      assignee: { id: ids.ana, name: 'Ana', email: `ana-${S}@t.local` },
      creator: { name: `API · Global ${S}` },
      custom_fields: [{ id: field.id, name: 'Cliente', type: 'text', value: 'ACME' }],
      comments_count: 1,
      project: { id: ids.pA },
    })
    expect(full.assignees.map((a: any) => a.id)).toEqual([ids.ana, ids.bia])
    expect(full.comments[0]).toMatchObject({ body: 'olá', author: { name: `API · Global ${S}` } })
    expect(full.url).toContain(`/projetos/${ids.pA}/tasks?task=${task.id}`)
    expect(camelKeys(full)).toEqual([])

    const listed = (await request(app).get(`${V1}/${ids.pA}/tasks?per_page=100`).set(g)).body.data
    expect(listed.find((t: any) => t.id === task.id)).toMatchObject({ description: 'Descrição longa\ncom duas linhas', assignee: { email: `ana-${S}@t.local` }, comments_count: 1 })
  })

  it('membro cria chave do projeto; ela faz o que um membro faz e nada de dono/gerente', async () => {
    const created = await makeKey(ids.bia, 'agent', { name: `Membro ${S}`, scopes: [...PROJECT_API_SCOPES], projectIds: [ids.pA] })
    expect(created.status).toBe(201)
    const k = as(created.body.data.key)
    const task = await request(app).post(`${V1}/${ids.pA}/tasks`).set(k).send({ title: 'Feita por membro' })
    expect(task.status).toBe(201)
    expect((await request(app).post(`${V1}/${ids.pA}/tasks/${task.body.data.id}/comments`).set(k).send({ body: 'ok' })).status).toBe(201)
    for (const [method, url, body] of [
      ['post', `${V1}/${ids.pA}/statuses`, { name: 'X', color: '#000000', category: 'open' }],
      ['post', `${V1}/${ids.pA}/members`, { user_id: ids.adm }],
      ['delete', `${V1}/${ids.pA}/tasks/${task.body.data.id}`, undefined],
      ['patch', `${V1}/${ids.pA}`, { description: 'x' }],
    ] as const) {
      const res = await (request(app) as any)[method](url).set(k).send(body)
      expect(res.status, `${method} ${url}`).toBe(403)
      expect(res.body.code).toBe('API_KEY_ROLE_DENIED')
    }
  })

  it('leitor do projeto não cria chave para ele', async () => {
    await prisma.projectMember.create({ data: { project_id: ids.pB, user_id: ids.ana, role: 'viewer' } })
    expect((await makeKey(ids.ana, 'agent', { name: 'x', scopes: ['read_tasks'], projectIds: [ids.pB] })).status).toBe(403)
  })
})
