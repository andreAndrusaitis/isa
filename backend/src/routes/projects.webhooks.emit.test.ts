// Cada ação do módulo dispara o evento de webhook que o catálogo promete, com
// quem agiu (nome) e só para webhooks cujo dono ainda gere o projeto. A rede é
// simulada: nada sai para a internet. Prisma real.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import request from 'supertest'
import jwt from 'jsonwebtoken'

const posts = vi.hoisted(() => ({ calls: [] as Array<{ url: string; headers: Record<string, string>; body: string }>, status: 200 }))
vi.mock('../services/webhookDelivery', async (orig) => ({
  ...(await orig<typeof import('../services/webhookDelivery')>()),
  validateWebhookUrl: vi.fn(async () => undefined),
  postWithValidatedRedirects: vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    posts.calls.push({ url, headers: init.headers, body: init.body })
    return new Response('ok', { status: posts.status })
  }),
}))

import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { PROJECT_WEBHOOK_EVENTS } from '../services/projectWebhooks'

const S = `whe-${Date.now()}`
const ids: Record<string, string> = {}
const bearer = (sub: string, role = 'agent') => `Bearer ${jwt.sign({ sub, role, orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`
const api = () => request(app)
const P = () => `/api/projects/${ids.project}`

/** Espera a entrega (o disparo é assíncrono, fora da transação). */
async function deliveriesOf(event: string, webhookId = ids.webhook, min = 1) {
  for (let i = 0; i < 50; i++) {
    const rows = await prisma.projectWebhookDelivery.findMany({ where: { webhook_id: webhookId, event }, orderBy: { created_at: 'asc' } })
    if (rows.length >= min) return rows
    await new Promise((r) => setTimeout(r, 40))
  }
  return []
}
const payloadOf = async (event: string) => (await deliveriesOf(event)).at(-1)?.payload as any

beforeAll(async () => {
  const ana = await prisma.user.create({ data: { name: 'Ana Dona', email: `ana-${S}@t.local`, role: 'agent', module_projects: true, permissions: ['projects_integrations'] } })
  const bia = await prisma.user.create({ data: { name: 'Bia Membro', email: `bia-${S}@t.local`, role: 'agent', module_projects: true, permissions: ['projects_integrations'] } })
  ids.ana = ana.id; ids.bia = bia.id
  const created = await api().post('/api/projects').set('Authorization', bearer(ana.id)).send({ name: `Proj ${S}` })
  expect(created.status).toBe(201)
  ids.project = created.body.data.id
  const statuses = (await api().get(`${P()}/statuses`).set('Authorization', bearer(ana.id))).body.data as any[]
  ids.todo = statuses.find((s) => s.category !== 'done')!.id
  ids.done = statuses.find((s) => s.category === 'done')!.id
  ids.webhook = (await prisma.projectWebhook.create({
    data: { name: 'tudo', url: 'https://hooks.example.test/in', secret: 'segredo', events: [...PROJECT_WEBHOOK_EVENTS], created_by: ana.id, projects: { create: { project_id: ids.project } } },
  })).id
})

afterAll(async () => {
  await prisma.projectWebhook.deleteMany({ where: { created_by: { in: [ids.ana, ids.bia] } } })
  await prisma.project.deleteMany({ where: { id: ids.project } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.ana, ids.bia] } } })
})

beforeEach(() => { posts.calls.length = 0; posts.status = 200 })

describe('webhooks de projetos — emissão dos eventos', () => {
  it('task: criada, status com nomes, concluída, co-responsáveis e excluída', async () => {
    const auth = bearer(ids.ana)
    const task = (await api().post(`${P()}/tasks`).set('Authorization', auth).send({ title: 'Login', description: 'Fluxo de SSO', statusId: ids.todo, assigneeId: ids.ana })).body.data
    ids.task = task.id
    const createdPayload = await payloadOf('task.created')
    // Task completa no webhook: descrição, pessoas com e-mail, status com nome, link…
    expect(createdPayload.data.task).toMatchObject({
      id: task.id, title: 'Login', description: 'Fluxo de SSO', key: `#${task.seq}`, typeKey: task.key,
      assignee: { id: ids.ana, name: 'Ana Dona', email: `ana-${S}@t.local` },
      creator: { name: 'Ana Dona' },
      status: { id: ids.todo, name: expect.any(String) },
      commentsCount: 0,
    })
    expect(createdPayload.data.task.url).toContain(`/tasks?task=${task.id}`)
    expect(createdPayload.actor).toEqual({ id: ids.ana, name: 'Ana Dona' })
    expect(createdPayload.project).toMatchObject({ id: ids.project })

    await api().post(`${P()}/members`).set('Authorization', auth).send({ userId: ids.bia, role: 'member' })
    expect((await payloadOf('project.member_added')).data.member).toEqual({ userId: ids.bia, name: 'Bia Membro', role: 'member' })

    await api().put(`${P()}/tasks/${task.id}/assignees`).set('Authorization', auth).send({ userIds: [ids.ana] })
    await api().put(`${P()}/tasks/${task.id}/assignees`).set('Authorization', auth).send({ userIds: [ids.ana, ids.bia] })
    // A task já nasce com a Ana: só a entrada da Bia gera evento.
    const coAssignees = (await deliveriesOf('task.assignee_changed', ids.webhook, 1)).at(-1)!.payload as any
    expect(coAssignees.data.changes.assignees).toEqual({ from: [ids.ana], to: [ids.ana, ids.bia] })

    await api().patch(`${P()}/tasks/${task.id}`).set('Authorization', auth).send({ statusId: ids.done })
    const status = (await payloadOf('task.status_changed')).data.changes.status
    expect(status).toMatchObject({ from: ids.todo, to: ids.done, toCategory: 'done' })
    expect(status.toName).toBeTruthy()
    expect((await payloadOf('task.completed')).data.status.id).toBe(ids.done)

    expect((await api().delete(`${P()}/tasks/${task.id}`).set('Authorization', auth)).status).toBeLessThan(300)
    expect((await payloadOf('task.deleted')).data.task.id).toBe(task.id)
  }, 20_000) // muitos passos com espera do disparo assíncrono

  it('comentário: criado, editado (só o autor) e excluído', async () => {
    const auth = bearer(ids.ana)
    const task = (await api().post(`${P()}/tasks`).set('Authorization', auth).send({ title: 'Comentada', statusId: ids.todo })).body.data
    const c = (await api().post(`${P()}/tasks/${task.id}/comments`).set('Authorization', auth).send({ body: 'oi' })).body.data
    expect((await payloadOf('comment.created')).data.comment).toEqual({ id: c.id, body: 'oi', authorId: ids.ana })

    const alheio = await api().patch(`${P()}/tasks/${task.id}/comments/${c.id}`).set('Authorization', bearer(ids.bia)).send({ body: 'hack' })
    expect(alheio.status).toBe(403)
    // Membro comum também não exclui comentário de outra pessoa.
    expect((await api().delete(`${P()}/tasks/${task.id}/comments/${c.id}`).set('Authorization', bearer(ids.bia))).status).toBe(403)

    const edited = await api().patch(`${P()}/tasks/${task.id}/comments/${c.id}`).set('Authorization', auth).send({ body: 'olá' })
    expect(edited.status).toBe(200)
    expect(edited.body.data.editedAt).toBeTruthy()
    expect((await payloadOf('comment.updated')).data.comment.body).toBe('olá')

    expect((await api().delete(`${P()}/tasks/${task.id}/comments/${c.id}`).set('Authorization', auth)).status).toBe(204)
    expect((await payloadOf('comment.deleted')).data.comment.id).toBe(c.id)
    const list = (await api().get(`${P()}/tasks/${task.id}/comments`).set('Authorization', auth)).body.data
    expect(list.map((x: any) => x.id)).not.toContain(c.id)
  })

  it('projeto, documento e aprovação', async () => {
    const auth = bearer(ids.ana)
    await api().patch(P()).set('Authorization', auth).send({ description: 'nova' })
    expect((await payloadOf('project.updated')).data.changes).toEqual(['description'])

    const doc = (await api().post(`${P()}/docs`).set('Authorization', auth).send({ title: 'Spec' })).body.data
    expect((await payloadOf('document.created')).data.document).toEqual({ id: doc.id, title: 'Spec' })
    await api().patch(`${P()}/docs/${doc.id}`).set('Authorization', auth).send({ title: 'Spec v2' })
    expect((await payloadOf('document.updated')).data.document.title).toBe('Spec v2')

    const task = (await api().post(`${P()}/tasks`).set('Authorization', auth).send({ title: 'Aprovar', statusId: ids.todo })).body.data
    const ap = (await api().post(`${P()}/tasks/${task.id}/approvals`).set('Authorization', auth).send({ approverId: ids.bia })).body.data
    expect((await payloadOf('approval.requested')).data.approval).toMatchObject({ id: ap.id, approverId: ids.bia, status: 'pending' })
    await api().patch(`${P()}/tasks/${task.id}/approvals/${ap.id}`).set('Authorization', bearer(ids.bia)).send({ status: 'changes_requested', comment: 'falta teste' })
    expect((await payloadOf('approval.rejected')).actor.name).toBe('Bia Membro')

    await api().delete(`${P()}/members/${ids.bia}`).set('Authorization', auth)
    expect((await payloadOf('project.member_removed')).data.member).toEqual({ userId: ids.bia, name: 'Bia Membro' })
  })

  it('entrega assinada: X-Projects-Signature = HMAC(secret, timestamp.body)', async () => {
    await api().post(`${P()}/tasks`).set('Authorization', bearer(ids.ana)).send({ title: 'Assinada', statusId: ids.todo })
    for (let i = 0; i < 50 && !posts.calls.some((c) => c.headers['X-Projects-Event'] === 'task.created'); i++) await new Promise((r) => setTimeout(r, 40))
    const call = posts.calls.find((c) => c.headers['X-Projects-Event'] === 'task.created')!
    const expected = createHmac('sha256', 'segredo').update(`${call.headers['X-Projects-Timestamp']}.${call.body}`).digest('hex')
    expect(call.headers['X-Projects-Signature']).toBe(`sha256=${expected}`)
  })

  it('dono que deixou de gerir o projeto para de receber', async () => {
    const outsider = await prisma.projectWebhook.create({
      data: { name: 'da Bia', url: 'https://hooks.example.test/bia', secret: 's', events: ['task.created'], created_by: ids.bia, projects: { create: { project_id: ids.project } } },
    })
    await api().post(`${P()}/tasks`).set('Authorization', bearer(ids.ana)).send({ title: 'Sigilosa', statusId: ids.todo })
    await deliveriesOf('task.created', ids.webhook, 3) // a do webhook válido já saiu
    expect(await prisma.projectWebhookDelivery.count({ where: { webhook_id: outsider.id } })).toBe(0)
  })

  it('testar: vale com webhook pausado, uma tentativa só, fora da saúde do card', async () => {
    const wh = await prisma.projectWebhook.create({
      data: { name: 'pausado', url: 'https://hooks.example.test/p', secret: 's', events: ['task.created'], active: false, created_by: ids.ana, projects: { create: { project_id: ids.project } } },
    })
    posts.status = 500
    const res = await api().post(`/api/projects/webhooks/${wh.id}/test`).set('Authorization', bearer(ids.ana))
    expect(res.body.data).toMatchObject({ status: 'failed', responseStatus: 500 })
    const row = await prisma.projectWebhookDelivery.findFirstOrThrow({ where: { webhook_id: wh.id } })
    expect(row.next_retry_at).toBeNull()
    const list = (await api().get('/api/projects/webhooks').set('Authorization', bearer(ids.ana))).body.data
    expect(list.find((w: any) => w.id === wh.id).recentDeliveries.total).toBe(0)
  })

  it('reenviar: bloqueado enquanto a original está na fila', async () => {
    const d = await prisma.projectWebhookDelivery.create({ data: { webhook_id: ids.webhook, event_id: `evt_${S}`, event: 'task.created', payload: {}, status: 'pending', next_retry_at: new Date(Date.now() + 3600_000) } })
    const res = await api().post(`/api/projects/webhooks/${ids.webhook}/deliveries/${d.id}/resend`).set('Authorization', bearer(ids.ana))
    expect(res.status).toBe(409)
    await prisma.projectWebhookDelivery.update({ where: { id: d.id }, data: { status: 'failed' } })
    expect((await api().post(`/api/projects/webhooks/${ids.webhook}/deliveries/${d.id}/resend`).set('Authorization', bearer(ids.ana))).status).toBe(202)
  })

  it('exemplo de cada evento traz o formato próprio (não só a task)', async () => {
    const auth = bearer(ids.ana)
    const schema = (await api().get('/api/projects/webhook-events/task.created/schema').set('Authorization', auth)).body.data.payload
    const taskProps = schema.properties.data.properties.task.properties
    expect(taskProps.description.type).toContain('null') // task sem descrição não pode quebrar o Analisar JSON
    expect(taskProps.assignee.type).toContain('null')
    const doc = (await api().get('/api/projects/webhook-events/document.created/example').set('Authorization', auth)).body.data.payload
    expect(doc.data.document).toBeTruthy()
    const member = (await api().get('/api/projects/webhook-events/project.member_added/example').set('Authorization', auth)).body.data.payload
    expect(member.data.member).toBeTruthy()
  })
})
