import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../ai/agents/triage/agent', () => ({ triageTicket: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../ai/agents/intake/agent', () => ({ intakeTicket: vi.fn().mockResolvedValue(undefined) }))

import prisma from '../config/prisma'
import { env } from '../config/env'
import router from './tickets'
import { errorHandler } from '../middlewares/errorHandler'
import { TicketService } from '../services/tickets'

// Regras de acesso pelo caminho real (rota → controller → serviço → banco). Dois lados:
// empresa A na carteira da equipe; empresa B fora dela.
const SUFFIX = `acc${Date.now()}`
const app = express()
app.use(express.json())
app.use('/api/tickets', router)
app.use(errorHandler)

let orgA: string, orgB: string, queueA: string, queueDefault: string, slaId: string, templateId: string
const id: Record<string, string> = {}
const created: string[] = []

const as = (who: string, role: string) => `Bearer ${jwt.sign({ sub: id[who], role, orgId: null }, env.JWT_SECRET, { algorithm: 'HS256' })}`
const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: string, role: string) =>
  request(app)[method](`/api/tickets${path}`).set('Authorization', as(who, role))

async function ticket(userId: string, org: string, over: Record<string, unknown> = {}) {
  const t = await TicketService.createTicket({ title: `T ${SUFFIX}`, description: 'd', user_id: userId, org_id: org })
  created.push(t!.id)
  if (Object.keys(over).length) await prisma.ticket.update({ where: { id: t!.id }, data: over })
  return t!.id as string
}
const message = (ticketId: string, userId: string, type: 'user' | 'agent' | 'internal', text = 'texto original') =>
  prisma.ticketMessage.create({ data: { ticket_id: ticketId, user_id: userId, type, text } })

beforeAll(async () => {
  const q = await prisma.queue.create({ data: { name: `Fila ${SUFFIX}` } })
  const qd = await prisma.queue.create({ data: { name: `Padrão ${SUFFIX}` } })
  queueA = q.id
  queueDefault = qd.id
  const sla = await prisma.slaConfig.create({
    data: { tier: `tier-${SUFFIX}`, incident_first_response_hours: 4, incident_resolution_hours: 24, default_queue: queueDefault },
  })
  slaId = sla.id
  orgA = (await prisma.organization.create({ data: { name: `A ${SUFFIX}`, tier: sla.tier } })).id
  orgB = (await prisma.organization.create({ data: { name: `B ${SUFFIX}` } })).id

  const carteira = { org_scopes: { create: { org_id: orgA } } }
  const mk = async (key: string, data: Record<string, unknown>) => {
    id[key] = (await prisma.user.create({ data: { name: key, email: `${key}-${SUFFIX}@t.com`, password: 'x', ...data } as any })).id
  }
  await mk('cliB', { role: 'user', org_id: orgB })
  await mk('cliB2', { role: 'user', org_id: orgB })
  await mk('cliA', { role: 'user', org_id: orgA })
  await mk('admin', { role: 'admin' })
  await mk('an', { role: 'agent', queues: [queueA, queueDefault], ...carteira })
  await mk('tm', { role: 'supervisor', ...carteira })
  await mk('outraFila', { role: 'agent', queues: [queueDefault], ...carteira })
  await mk('holder', { role: 'agent', queues: [queueA, queueDefault], permissions: ['delete_tickets', 'trash'], ...carteira })
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: created } } })
  await prisma.surveyTemplate.deleteMany({ where: { id: templateId } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: Object.values(id) } } })
  await prisma.user.deleteMany({ where: { id: { in: Object.values(id) } } })
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  await prisma.slaConfig.deleteMany({ where: { id: slaId } })
  await prisma.queue.deleteMany({ where: { id: { in: [queueA, queueDefault] } } })
  await prisma.$disconnect()
})

describe('editar e apagar mensagem exige alcançar o chamado', () => {
  it('moderador fora da carteira não mexe em mensagem de outra empresa', async () => {
    const t = await ticket(id.cliB, orgB)
    const m = await message(t, id.cliB, 'user')

    const edit = await api('patch', `/${t}/messages/${m.id}`, 'tm', 'supervisor').send({ text: 'reescrita' })
    expect(edit.status).toBe(403)
    expect(edit.body.code).toBe('ORG_OUT_OF_SCOPE')
    expect((await api('delete', `/${t}/messages/${m.id}`, 'tm', 'supervisor')).status).toBe(403)
    expect((await prisma.ticketMessage.findUnique({ where: { id: m.id } }))?.text).toBe('texto original')
  })

  it('moderador da carteira continua moderando', async () => {
    const t = await ticket(id.cliA, orgA)
    const m = await message(t, id.cliA, 'user')
    expect((await api('patch', `/${t}/messages/${m.id}`, 'tm', 'supervisor').send({ text: 'corrigida' })).status).toBe(200)
  })

  it('analista da carteira fora da fila: a opção de moderar decide, não a fila', async () => {
    const t = await ticket(id.cliA, orgA, { queue: queueA })
    const m = await message(t, id.cliA, 'user')

    const semOpcao = await api('patch', `/${t}/messages/${m.id}`, 'outraFila', 'agent').send({ text: 'x' })
    expect(semOpcao.status).toBe(403)
    expect(semOpcao.body.code).toBe('MESSAGE_NOT_OWNER')

    await prisma.user.update({ where: { id: id.outraFila }, data: { permissions: ['orgs', 'edit_messages'] } })
    expect((await api('patch', `/${t}/messages/${m.id}`, 'outraFila', 'agent').send({ text: 'moderada' })).status).toBe(200)
  })

  it('autor que perdeu o acesso não edita nem apaga a própria mensagem', async () => {
    const t = await ticket(id.cliB, orgB)
    const m = await message(t, id.cliB, 'user')
    await prisma.ticket.update({ where: { id: t }, data: { user_id: id.cliB2 } })

    const edit = await api('patch', `/${t}/messages/${m.id}`, 'cliB', 'user').send({ text: 'x' })
    expect(edit.status).toBe(403)
    expect(edit.body.code).toBe('NOT_OWN_TICKET')
    expect((await api('delete', `/${t}/messages/${m.id}`, 'cliB', 'user')).status).toBe(403)
  })

  it('chamado fechado: solicitante não reescreve nem apaga o que disse', async () => {
    const t = await ticket(id.cliB, orgB, { status: 'closed' })
    const m = await message(t, id.cliB, 'user')

    const edit = await api('patch', `/${t}/messages/${m.id}`, 'cliB', 'user').send({ text: 'x' })
    expect(edit.status).toBe(400)
    expect(edit.body.code).toBe('TICKET_CLOSED')
    expect((await api('delete', `/${t}/messages/${m.id}`, 'cliB', 'user')).status).toBe(400)
  })

  it('chamado fechado: nota interna segue editável, como segue recebendo notas', async () => {
    const t = await ticket(id.cliA, orgA, { status: 'closed' })
    const m = await message(t, id.an, 'internal')
    expect((await api('patch', `/${t}/messages/${m.id}`, 'an', 'agent').send({ text: 'nota corrigida' })).status).toBe(200)
  })

  it('edição e exclusão ficam na auditoria com o texto anterior', async () => {
    const t = await ticket(id.cliA, orgA)
    const m = await message(t, id.an, 'internal', 'antes da edição')
    await api('patch', `/${t}/messages/${m.id}`, 'an', 'agent').send({ text: 'depois da edição' })
    await api('delete', `/${t}/messages/${m.id}`, 'an', 'agent')

    const logs = await prisma.auditLog.findMany({ where: { user_id: id.an, action: { in: ['UPDATE_MESSAGE', 'DELETE_MESSAGE'] } } })
    const of = (a: string) => logs.find(l => l.action === a && (l.details as any).messageId === m.id)?.details as any
    expect(of('UPDATE_MESSAGE').before).toBe('antes da edição')
    expect(of('DELETE_MESSAGE').before).toBe('depois da edição')
  })
})

describe('excluir e Lixeira seguem a carteira de quem recebeu a permissão', () => {
  it('permissão de excluir não alcança chamado de outra empresa', async () => {
    const t = await ticket(id.cliB, orgB)
    const r = await api('delete', `/${t}`, 'holder', 'agent')
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('ORG_OUT_OF_SCOPE')
    expect((await prisma.ticket.findUnique({ where: { id: t } }))?.deleted_at).toBeNull()
  })

  it('exclui, lista, restaura e expurga dentro da carteira', async () => {
    const t = await ticket(id.cliA, orgA)
    expect((await api('delete', `/${t}`, 'holder', 'agent')).status).toBe(204)
    expect(JSON.stringify((await api('get', '/trash', 'holder', 'agent')).body)).toContain(t)
    expect((await api('post', `/${t}/restore`, 'holder', 'agent')).status).toBe(204)
    expect((await api('delete', `/${t}`, 'holder', 'agent')).status).toBe(204)
    expect((await api('delete', `/${t}/permanent`, 'holder', 'agent')).status).toBe(204)
    expect(await prisma.ticket.findUnique({ where: { id: t } })).toBeNull()
  })

  it('Lixeira de outra empresa não aparece nem responde a restaurar e expurgar', async () => {
    const t = await ticket(id.cliB, orgB, { deleted_at: new Date() })

    const list = await api('get', `/trash?orgId=${orgB}`, 'holder', 'agent')
    expect(list.status).toBe(200)
    expect(list.body.total).toBe(0)
    expect((await api('post', `/${t}/restore`, 'holder', 'agent')).status).toBe(403)
    expect((await api('delete', `/${t}/permanent`, 'holder', 'agent')).status).toBe(403)
    expect((await prisma.ticket.findUnique({ where: { id: t } }))?.deleted_at).toBeTruthy()
  })

  it('admin segue vendo e agindo em todas as empresas', async () => {
    const t = await ticket(id.cliB, orgB, { deleted_at: new Date() })
    expect(JSON.stringify((await api('get', `/trash?orgId=${orgB}`, 'admin', 'admin')).body)).toContain(t)
    expect((await api('post', `/${t}/restore`, 'admin', 'admin')).status).toBe(204)
    expect((await api('delete', `/${t}`, 'admin', 'admin')).status).toBe(204)
  })
})

describe('fila na abertura é decisão do atendimento', () => {
  const open = (who: string, role: string, body: Record<string, unknown>) =>
    api('post', '', who, role).send({ title: 'Sem acesso', description: 'Desde cedo', ...body })

  it('cliente que manda fila cai na fila padrão da empresa', async () => {
    const r = await open('cliA', 'user', { queue: queueA })
    expect(r.status).toBe(201)
    created.push(r.body.data.id)
    expect(r.body.data.queue).toBe(queueDefault)
  })

  it('abertura normal do portal (sem fila) continua igual', async () => {
    const r = await open('cliA', 'user', {})
    expect(r.status).toBe(201)
    created.push(r.body.data.id)
    expect(r.body.data.queue).toBe(queueDefault)
  })

  it('equipe escolhe uma fila real', async () => {
    const r = await open('an', 'agent', { queue: queueA, onBehalfOfUserId: id.cliA })
    expect(r.status).toBe(201)
    created.push(r.body.data.id)
    expect(r.body.data.queue).toBe(queueA)
  })

  it('fila que não existe não vira fila fantasma', async () => {
    const r = await open('an', 'agent', { queue: 'nao-existe', onBehalfOfUserId: id.cliA })
    expect(r.status).toBe(201)
    created.push(r.body.data.id)
    expect(r.body.data.queue).toBe(queueDefault)
  })
})

describe('equipe que só alcança o chamado por tê-lo aberto é tratada como cliente', () => {
  let t: string

  beforeAll(async () => {
    t = await ticket(id.an, orgB)
    await message(t, id.tm, 'internal', 'NOTA-INTERNA')
    await prisma.ticketEvent.create({ data: { ticket_id: t, user_id: id.tm, to_status: 'open', note: 'EVENTO-INTERNO' } })
  })

  it('não recebe nota interna nem histórico', async () => {
    const detail = await api('get', `/${t}`, 'an', 'agent')
    expect(detail.status).toBe(200)
    expect(JSON.stringify(detail.body)).not.toContain('NOTA-INTERNA')
    expect(JSON.stringify(detail.body)).not.toContain('EVENTO-INTERNO')
    const messages = await api('get', `/${t}/messages`, 'an', 'agent')
    expect(messages.status).toBe(200)
    expect(JSON.stringify(messages.body)).not.toContain('NOTA-INTERNA')
  })

  it('responde como solicitante, mas não atende', async () => {
    expect((await api('post', `/${t}/messages`, 'an', 'agent').send({ text: 'alguma novidade?', type: 'user' })).status).toBe(201)
    const note = await api('post', `/${t}/messages`, 'an', 'agent').send({ text: 'nota', type: 'internal' })
    expect(note.status).toBe(403)
    expect(note.body.code).toBe('MESSAGE_TYPE_NOT_ALLOWED')
    const work = await api('patch', `/${t}`, 'an', 'agent').send({ assigned_to_id: id.an })
    expect(work.status).toBe(403)
    expect(work.body.code).toBe('REQUESTER_ONLY')
  })

  it('com a empresa na carteira, o próprio chamado é visto como equipe', async () => {
    const own = await ticket(id.an, orgA)
    await message(own, id.tm, 'internal', 'NOTA-DA-CARTEIRA')
    expect(JSON.stringify((await api('get', `/${own}/messages`, 'an', 'agent')).body)).toContain('NOTA-DA-CARTEIRA')
    expect((await api('patch', `/${own}`, 'an', 'agent').send({ assigned_to_id: id.an })).status).toBe(200)
  })
})

describe('token da pesquisa só vai para o solicitante', () => {
  let t: string
  const TOKEN = `token-${SUFFIX}`

  beforeAll(async () => {
    t = await ticket(id.cliA, orgA, { assigned_to_id: id.an })
    const template = await prisma.surveyTemplate.create({
      data: { nome: `Modelo ${SUFFIX}`, assunto_email: 'a', corpo_convite_auto: 'b', corpo_convite_macro: 'c', ativo: false },
    })
    templateId = template.id
    await prisma.surveyInstance.create({ data: { ticket_id: t, template_id: template.id, link_token: TOKEN } })
  })

  it('equipe vê a situação da pesquisa, sem o token', async () => {
    const r = await api('get', `/${t}`, 'an', 'agent')
    expect(r.status).toBe(200)
    expect(r.body.data.surveyInstance.status).toBe('enviada')
    expect(JSON.stringify(r.body)).not.toContain(TOKEN)
  })

  it('resposta do PATCH também sai sem o token', async () => {
    const r = await api('patch', `/${t}`, 'an', 'agent').send({ priority: 'high' })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toContain(TOKEN)
  })

  it('o solicitante recebe o token para abrir a pesquisa', async () => {
    const r = await api('get', `/${t}`, 'cliA', 'user')
    expect(r.body.data.surveyInstance.linkToken).toBe(TOKEN)
  })
})
