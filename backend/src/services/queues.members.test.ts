import { afterAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { QueueService } from './queues'

// Integração real: rodar contra o banco descartável (DATABASE_URL/DIRECT_URL → 127.0.0.1:5434).
const tag = `qm-${Date.now()}`
const userIds: string[] = []
const queueIds: string[] = []

async function mkUser(role: 'agent' | 'supervisor', active = true) {
  const u = await prisma.user.create({ data: { name: `${tag} ${role}`, email: `${tag}-${userIds.length}@test.local`, role, active } })
  userIds.push(u.id)
  return u
}

async function queuesOf(id: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id }, select: { queues: true } })).queues
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.queue.deleteMany({ where: { id: { in: queueIds } } })
})

describe('QueueService — analistas da fila (User.queues)', () => {
  it('vincula, desvincula e limpa o ID ao excluir a fila', async () => {
    const queue = await QueueService.create({ name: tag })
    const other = await QueueService.create({ name: `${tag}-other` })
    queueIds.push(queue.id, other.id)
    const agent = await mkUser('agent')
    await prisma.user.update({ where: { id: agent.id }, data: { queues: [other.id] } })

    const listed = await QueueService.addAgents(queue.id, [agent.id, agent.id])
    expect(listed.map(a => a.id)).toEqual([agent.id])
    expect(await queuesOf(agent.id)).toEqual([other.id, queue.id])

    // idempotente: não duplica
    await QueueService.addAgents(queue.id, [agent.id])
    expect(await queuesOf(agent.id)).toEqual([other.id, queue.id])

    expect(await QueueService.removeAgent(queue.id, agent.id)).toEqual([])
    expect(await queuesOf(agent.id)).toEqual([other.id])

    await QueueService.addAgents(queue.id, [agent.id])
    await QueueService.delete(queue.id)
    expect(await queuesOf(agent.id)).toEqual([other.id])
  }, 30_000)

  it('recusa quem não é analista ativo', async () => {
    const queue = await QueueService.create({ name: `${tag}-rej` })
    queueIds.push(queue.id)
    const inactive = await mkUser('agent', false)
    const sup = await mkUser('supervisor')

    await expect(QueueService.addAgents(queue.id, [inactive.id])).rejects.toMatchObject({ statusCode: 400 })
    await expect(QueueService.addAgents(queue.id, [sup.id])).rejects.toMatchObject({ statusCode: 400 })
    await expect(QueueService.addAgents(queue.id, [])).rejects.toMatchObject({ statusCode: 400 })
    await expect(QueueService.listAgents('nao-existe')).rejects.toMatchObject({ statusCode: 404 })
    expect(await queuesOf(inactive.id)).toEqual([])
  }, 30_000)
})
