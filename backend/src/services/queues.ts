import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { getIo, syncUserQueueRooms } from '../config/socket'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from './audit'
import { AuditInfo } from '../utils/audit'

const AGENT_SELECT = { id: true, name: true, email: true, avatar: true, active: true } as const

/** Mesmo campo que o cadastro do usuário edita (User.queues): avisa as telas e ajusta as salas do socket. */
function broadcastQueues(userId: string, before: string[], after: string[]) {
  syncUserQueueRooms(userId, before, after)
  getIo()?.to('users:staff').emit('user:updated', { user: { id: userId, queues: after } })
}

/** Tira a fila de User.queues (de um usuário ou de todos) num único UPDATE atômico. */
async function pullQueue(queueId: string, userId?: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string; queues: string[] }[]>`
    UPDATE users SET queues = array_remove(queues, ${queueId})
    WHERE ${queueId} = ANY(queues) ${userId ? Prisma.sql`AND id = ${userId}` : Prisma.empty}
    RETURNING id, queues`
  rows.forEach(r => broadcastQueues(r.id, [...r.queues, queueId], r.queues))
  return rows.map(r => r.id)
}

export class QueueService {
  static async list(includeInactive = false) {
    return prisma.queue.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { name: 'asc' }
    })
  }

  static async getById(id: string) {
    return prisma.queue.findUnique({
      where: { id }
    })
  }

  static async getOrThrow(id: string) {
    const queue = await prisma.queue.findUnique({ where: { id } })
    if (!queue) throw new AppError(404, 'Fila não encontrada', 'QUEUE_NOT_FOUND')
    return queue
  }

  static async listAgents(id: string) {
    await QueueService.getOrThrow(id)
    return prisma.user.findMany({
      where: { role: 'agent', deleted_at: null, queues: { has: id } },
      select: AGENT_SELECT,
      orderBy: { name: 'asc' },
    })
  }

  static async addAgents(id: string, userIds: unknown, audit?: AuditInfo) {
    const queue = await QueueService.getOrThrow(id)
    const ids = Array.isArray(userIds) ? [...new Set(userIds.filter((u): u is string => typeof u === 'string' && !!u))] : []
    if (!ids.length) throw new AppError(400, 'Informe ao menos um analista.', 'AGENTS_REQUIRED')

    const users = await prisma.user.findMany({
      where: { id: { in: ids }, role: 'agent', active: true, deleted_at: null },
      select: { id: true, queues: true },
    })
    if (users.length !== ids.length) {
      throw new AppError(400, 'Só é possível vincular usuários com papel Analista, ativos e não excluídos.', 'INVALID_AGENTS')
    }

    const toAdd = users.filter(u => !u.queues.includes(id))
    if (toAdd.length) {
      await prisma.user.updateMany({
        where: { id: { in: toAdd.map(u => u.id) }, NOT: { queues: { has: id } } },
        data: { queues: { push: id } },
      })
      toAdd.forEach(u => broadcastQueues(u.id, u.queues, [...u.queues, id]))
      QueueService.auditMembers(queue, toAdd.map(u => u.id), [], audit)
    }
    return QueueService.listAgents(id)
  }

  static async removeAgent(id: string, userId: string, audit?: AuditInfo) {
    const queue = await QueueService.getOrThrow(id)
    const removed = await pullQueue(id, userId)
    if (removed.length) QueueService.auditMembers(queue, [], removed, audit)
    return QueueService.listAgents(id)
  }

  private static auditMembers(queue: { id: string; name: string }, added: string[], removed: string[], audit?: AuditInfo) {
    if (!audit?.actorId) return
    createAuditLog({
      userId: audit.actorId,
      action: 'UPDATE_QUEUE_MEMBERS',
      resource: 'QUEUE',
      details: { queueId: queue.id, name: queue.name, added, removed },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }

  static async create(data: any, audit?: AuditInfo) {
    const { name, description, color, active } = data
    if (!String(name ?? '').trim()) throw new AppError(400, 'Informe o nome da fila', 'QUEUE_NAME_REQUIRED')
    const queue = await prisma.queue.create({ data: {
      name: String(name ?? '').trim(),
      description: String(description ?? '').trim(),
      color: String(color ?? '#0f73ac').trim(),
      active: active !== false,
    } })

    if (audit?.actorId) {
      createAuditLog({
        userId: audit.actorId,
        action: 'CREATE_QUEUE',
        resource: 'QUEUE',
        details: { queueId: queue.id, name: queue.name },
        ip: audit.ip,
        userAgent: audit.userAgent
      })
    }

    return queue
  }

  static async update(id: string, data: any, audit?: AuditInfo) {
    const { name, description, color, active } = data
    // PATCH parcial: só grava o que veio (antes, { active } sozinho apagava nome e descrição).
    if (name !== undefined && !String(name).trim()) throw new AppError(400, 'Informe o nome da fila', 'QUEUE_NAME_REQUIRED')
    const queue = await prisma.queue.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(description !== undefined && { description: String(description ?? '').trim() }),
        ...(color !== undefined && { color: String(color).trim() }),
        ...(active !== undefined && { active: active !== false }),
      }
    })

    if (audit?.actorId) {
      createAuditLog({
        userId: audit.actorId,
        action: 'UPDATE_QUEUE',
        resource: 'QUEUE',
        details: { queueId: id, name: queue.name, changes: data },
        ip: audit.ip,
        userAgent: audit.userAgent
      })
    }

    return queue
  }

  static async delete(id: string, audit?: AuditInfo) {
    const queue = await prisma.queue.delete({
      where: { id }
    })
    // Sem FK em User.queues: limpa o ID para não deixar fila órfã no cadastro.
    await pullQueue(id)

    if (audit?.actorId) {
      createAuditLog({
        userId: audit.actorId,
        action: 'DELETE_QUEUE',
        resource: 'QUEUE',
        details: { queueId: id, name: queue.name },
        ip: audit.ip,
        userAgent: audit.userAgent
      })
    }

    return queue
  }
}
