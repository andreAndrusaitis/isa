import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { QueueService } from '../services/queues'

// Banco real. TM1 chefia o analista "meu"; o analista "alheio" está sob outro gerente.
const S = `qacc-${Date.now()}`
const ids: Record<string, string> = {}
let queueId: string

const bearer = (sub: string, role: string) =>
  `Bearer ${jwt.sign({ sub, role, orgId: null, permissions: [], iat_ms: Date.now() }, env.JWT_SECRET)}`

async function mkUser(key: string, role: 'manager' | 'supervisor' | 'agent' | 'admin', manager_id?: string) {
  ids[key] = (await prisma.user.create({ data: { name: `${key} ${S}`, email: `${key}-${S}@t.local`, role, manager_id, queues: [] } })).id
}

const queuesOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { queues: true } })).queues
const add = (by: string, role: string, userIds: string[]) =>
  request(app).post(`/api/queues/${queueId}/agents`).set('Authorization', bearer(by, role)).send({ userIds })
const remove = (by: string, role: string, userId: string) =>
  request(app).delete(`/api/queues/${queueId}/agents/${userId}`).set('Authorization', bearer(by, role))

beforeAll(async () => {
  await mkUser('gerente', 'manager')
  await mkUser('tm1', 'supervisor', ids.gerente)
  await mkUser('meu', 'agent', ids.tm1)
  await mkUser('outroGerente', 'manager')
  await mkUser('alheio', 'agent', ids.outroGerente)
  await mkUser('admin', 'admin')
  queueId = (await QueueService.create({ name: S })).id
})

afterAll(async () => {
  const userIds = Object.values(ids)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { manager_id: null } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.queue.deleteMany({ where: { id: queueId } })
})

describe('membros da fila seguem o organograma', () => {
  it('TM vincula e desvincula quem está abaixo dele', async () => {
    expect((await add(ids.tm1, 'supervisor', [ids.meu])).status).toBe(200)
    expect(await queuesOf(ids.meu)).toContain(queueId)
    expect((await remove(ids.tm1, 'supervisor', ids.meu)).status).toBe(200)
    expect(await queuesOf(ids.meu)).not.toContain(queueId)
  })

  it('Gerente alcança o analista abaixo do TM dele', async () => {
    expect((await add(ids.gerente, 'manager', [ids.meu])).status).toBe(200)
    expect((await remove(ids.gerente, 'manager', ids.meu)).status).toBe(200)
  })

  it('TM não vincula analista de outra árvore', async () => {
    const res = await add(ids.tm1, 'supervisor', [ids.alheio])
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_IN_TEAM')
    expect(await queuesOf(ids.alheio)).not.toContain(queueId)
  })

  it('um alvo fora da árvore recusa o pedido inteiro', async () => {
    expect((await add(ids.tm1, 'supervisor', [ids.meu, ids.alheio])).status).toBe(403)
    expect(await queuesOf(ids.meu)).not.toContain(queueId)
  })

  it('TM não desvincula analista de outra árvore', async () => {
    await prisma.user.update({ where: { id: ids.alheio }, data: { queues: [queueId] } })
    const res = await remove(ids.tm1, 'supervisor', ids.alheio)
    expect(res.status).toBe(403)
    expect(await queuesOf(ids.alheio)).toContain(queueId)
    await prisma.user.update({ where: { id: ids.alheio }, data: { queues: [] } })
  })

  it('admin alcança todos', async () => {
    expect((await add(ids.admin, 'admin', [ids.alheio])).status).toBe(200)
    expect((await remove(ids.admin, 'admin', ids.alheio)).status).toBe(200)
  })

  it('id inexistente continua sendo recusado pelo serviço', async () => {
    const res = await add(ids.tm1, 'supervisor', ['00000000-0000-0000-0000-00000000dead'])
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_AGENTS')
  })
})
