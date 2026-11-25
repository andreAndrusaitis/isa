// Webhooks de Projetos têm dono: global só admin; os demais só para projetos
// onde o usuário é owner/manager; cada um vê e mexe só nos seus. Prisma real.
// Abrir a tela exige a liberação "Integrações de Projetos" (Gerente tem pelo cargo):
// Ana e Bia são Analistas com a liberação concedida na ficha.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'

const S = `wh-${Date.now()}`
const ids: Record<string, string> = {}
const bearer = (sub: string, role: string) => `Bearer ${jwt.sign({ sub, role, orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`
const body = (projectIds: string[]) => ({ name: 'W', url: 'https://93.184.216.34/hook', events: ['task.created'], projectIds })

beforeAll(async () => {
  const a = await prisma.user.create({ data: { name: 'Ana', email: `ana-${S}@t.local`, role: 'agent', module_projects: true, permissions: ['projects_integrations'] } })
  const b = await prisma.user.create({ data: { name: 'Bia', email: `bia-${S}@t.local`, role: 'agent', module_projects: true, permissions: ['projects_integrations'] } })
  const adm = await prisma.user.create({ data: { name: 'Adm', email: `adm-${S}@t.local`, role: 'admin' } })
  const cris = await prisma.user.create({ data: { name: 'Cris', email: `cris-${S}@t.local`, role: 'agent', module_projects: true } })
  const tm = await prisma.user.create({ data: { name: 'Teo', email: `teo-${S}@t.local`, role: 'supervisor', module_projects: true } })
  const ger = await prisma.user.create({ data: { name: 'Gil', email: `gil-${S}@t.local`, role: 'manager', module_projects: true } })
  ids.ana = a.id; ids.bia = b.id; ids.adm = adm.id; ids.cris = cris.id; ids.tm = tm.id; ids.ger = ger.id
  ids.pOwn = (await prisma.project.create({ data: { name: `Own ${S}`, owner_id: a.id, members: { create: { user_id: a.id, role: 'owner' } } } })).id
  ids.pMember = (await prisma.project.create({ data: { name: `Mem ${S}`, owner_id: b.id, members: { create: [{ user_id: b.id, role: 'owner' }, { user_id: a.id, role: 'member' }] } } })).id
  ids.pViewer = (await prisma.project.create({ data: { name: `Vie ${S}`, owner_id: b.id, members: { create: [{ user_id: b.id, role: 'owner' }, { user_id: a.id, role: 'viewer' }] } } })).id
  ids.pOther = (await prisma.project.create({ data: { name: `Oth ${S}`, owner_id: b.id, members: { create: { user_id: b.id, role: 'owner' } } } })).id
  ids.whBia = (await prisma.projectWebhook.create({ data: { name: 'da Bia', url: 'https://93.184.216.34/b', secret: 's', events: ['task.created'], created_by: b.id, projects: { create: { project_id: ids.pOther } } } })).id
})

afterAll(async () => {
  await prisma.projectWebhook.deleteMany({ where: { created_by: { in: [ids.ana, ids.bia, ids.adm] } } })
  await prisma.project.deleteMany({ where: { id: { in: [ids.pOwn, ids.pMember, ids.pViewer, ids.pOther] } } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.ana, ids.bia, ids.adm, ids.cris, ids.tm, ids.ger] } } })
})

describe('liberação "Integrações de Projetos"', () => {
  it('Analista e TM sem a liberação recebem 403 em webhooks, eventos e chaves de API', async () => {
    for (const [id, role] of [[ids.cris, 'agent'], [ids.tm, 'supervisor']]) {
      for (const url of ['/api/projects/webhooks', '/api/projects/webhook-events', '/api/projects/api-keys', '/api/projects/api-scopes']) {
        const res = await request(app).get(url).set('Authorization', bearer(id, role))
        expect(res.status, `${role} ${url}`).toBe(403)
      }
      expect((await request(app).post('/api/projects/webhooks').set('Authorization', bearer(id, role)).send(body([ids.pOwn]))).status).toBe(403)
    }
  })

  it('Gerente pelo cargo e Analista com a liberação concedida abrem webhooks e chaves', async () => {
    for (const [id, role] of [[ids.ger, 'manager'], [ids.ana, 'agent']]) {
      expect((await request(app).get('/api/projects/webhooks').set('Authorization', bearer(id, role))).status).toBe(200)
      expect((await request(app).get('/api/projects/api-keys').set('Authorization', bearer(id, role))).status).toBe(200)
    }
  })
})

describe('webhooks de projetos — dono e alcance', () => {
  it('analista não cria webhook global (todos os projetos)', async () => {
    const res = await request(app).post('/api/projects/webhooks').set('Authorization', bearer(ids.ana, 'agent')).send(body([]))
    expect(res.status).toBe(403)
  })

  it('analista aponta para projeto em que é dono, gerente ou membro — nunca leitor ou fora dele', async () => {
    const member = await request(app).post('/api/projects/webhooks').set('Authorization', bearer(ids.ana, 'agent')).send(body([ids.pMember]))
    expect(member.status).toBe(201)
    for (const p of [ids.pViewer, ids.pOther]) {
      const res = await request(app).post('/api/projects/webhooks').set('Authorization', bearer(ids.ana, 'agent')).send(body([p]))
      expect(res.status, p).toBe(403)
    }
    const ok = await request(app).post('/api/projects/webhooks').set('Authorization', bearer(ids.ana, 'agent')).send(body([ids.pOwn]))
    expect(ok.status).toBe(201)
  })

  it('não vê nem mexe no webhook de outra pessoa', async () => {
    const list = await request(app).get('/api/projects/webhooks').set('Authorization', bearer(ids.ana, 'agent'))
    expect(list.body.data.map((w: any) => w.id)).not.toContain(ids.whBia)
    const auth = bearer(ids.ana, 'agent')
    expect((await request(app).patch(`/api/projects/webhooks/${ids.whBia}`).set('Authorization', auth).send({ url: 'https://93.184.216.34/roubo' })).status).toBe(404)
    expect((await request(app).get(`/api/projects/webhooks/${ids.whBia}/deliveries`).set('Authorization', auth)).status).toBe(404)
    expect((await request(app).post(`/api/projects/webhooks/${ids.whBia}/test`).set('Authorization', auth)).status).toBe(404)
    expect((await request(app).delete(`/api/projects/webhooks/${ids.whBia}`).set('Authorization', auth)).status).toBe(404)
    expect(await prisma.projectWebhook.findUnique({ where: { id: ids.whBia } })).not.toBeNull()
  })

  it('regenerar secret: só o dono; o novo volta uma vez e passa a valer', async () => {
    expect((await request(app).post(`/api/projects/webhooks/${ids.whBia}/regenerate-secret`).set('Authorization', bearer(ids.ana, 'agent'))).status).toBe(404)
    const res = await request(app).post(`/api/projects/webhooks/${ids.whBia}/regenerate-secret`).set('Authorization', bearer(ids.bia, 'agent'))
    expect(res.status).toBe(200)
    expect(res.body.data.secret).toMatch(/^[0-9a-f]{64}$/)
    expect((await prisma.projectWebhook.findUnique({ where: { id: ids.whBia } }))!.secret).toBe(res.body.data.secret)
  })

  it('listagem traz o resumo das últimas entregas', async () => {
    await prisma.projectWebhookDelivery.createMany({ data: [
      { webhook_id: ids.whBia, event_id: `evt_a_${S}`, event: 'task.created', payload: {}, status: 'success' },
      { webhook_id: ids.whBia, event_id: `evt_b_${S}`, event: 'task.created', payload: {}, status: 'failed' },
    ] })
    const list = await request(app).get('/api/projects/webhooks').set('Authorization', bearer(ids.bia, 'agent'))
    const wh = list.body.data.find((w: any) => w.id === ids.whBia)
    expect(wh.recentDeliveries).toEqual({ total: 2, success: 1, failed: 1, pending: 0 })
    expect(wh.secret).toBeUndefined()
  })

  it('exemplo e esquema do evento saem com as chaves como o destino recebe', async () => {
    const auth = bearer(ids.ana, 'agent')
    const ex = await request(app).get('/api/projects/webhook-events/task.updated/example').set('Authorization', auth)
    expect(ex.status).toBe(200)
    expect(ex.body.data.payload.event).toBe('task.updated')
    expect(Object.keys(ex.body.data.payload.data.changes)).toContain('status_changed')
    const sc = await request(app).get('/api/projects/webhook-events/task.updated/schema').set('Authorization', auth)
    expect(sc.body.data.payload.$schema).toContain('draft-07')
    expect(Object.keys(sc.body.data.payload.properties.data.properties.changes.properties)).toContain('status_changed')
    expect((await request(app).get('/api/projects/webhook-events/nao.existe/example').set('Authorization', auth)).status).toBe(404)
  })

  it('admin cria global e vê todos', async () => {
    const res = await request(app).post('/api/projects/webhooks').set('Authorization', bearer(ids.adm, 'admin')).send(body([]))
    expect(res.status).toBe(201)
    const list = await request(app).get('/api/projects/webhooks').set('Authorization', bearer(ids.adm, 'admin'))
    expect(list.body.data.map((w: any) => w.id)).toContain(ids.whBia)
  })
})
