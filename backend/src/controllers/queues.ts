import { Request, Response, NextFunction } from 'express'
import { QueueService } from '../services/queues'
import { getAuditInfo } from '../utils/audit'
import { forbidden } from '../utils/denials'
import { assertCanManage } from '../access/grants'
import prisma from '../config/prisma'

// Filas definem o que o analista vê: ninguém (fora o admin) mexe nas próprias.
function assertNotSelf(req: Request, userIds: unknown) {
  if (req.user?.role === 'admin') return
  const ids = Array.isArray(userIds) ? userIds : [userIds]
  if (ids.includes(req.user?.sub)) throw forbidden('SELF_QUEUES', 'Você não pode alterar as próprias filas. Peça a quem está acima de você.')
}

// Mesmo alcance do PATCH /users/:id, que edita o mesmo campo. Id inexistente o serviço recusa.
async function assertCanManageAgents(req: Request, userIds: unknown) {
  if (req.user?.role === 'admin') return
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter((u): u is string => typeof u === 'string')
  const targets = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, role: true, org_id: true, manager_id: true },
  })
  for (const target of targets) await assertCanManage(req.user!, target)
}

export class QueueController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const includeInactive = req.query.include_inactive === 'true'
      const queues = await QueueService.list(includeInactive)
      return res.json({ data: queues })
    } catch (error) {
      return next(error)
    }
  }

  static async listAgents(req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: await QueueService.listAgents(req.params.id as string) })
    } catch (error) {
      return next(error)
    }
  }

  static async addAgents(req: Request, res: Response, next: NextFunction) {
    try {
      assertNotSelf(req, req.body?.userIds)
      await assertCanManageAgents(req, req.body?.userIds)
      const agents = await QueueService.addAgents(req.params.id as string, req.body?.userIds, getAuditInfo(req))
      return res.json({ data: agents })
    } catch (error) {
      return next(error)
    }
  }

  static async removeAgent(req: Request, res: Response, next: NextFunction) {
    try {
      assertNotSelf(req, req.params.userId)
      await assertCanManageAgents(req, req.params.userId)
      const agents = await QueueService.removeAgent(req.params.id as string, req.params.userId as string, getAuditInfo(req))
      return res.json({ data: agents })
    } catch (error) {
      return next(error)
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const audit = getAuditInfo(req)
      const queue = await QueueService.create(req.body, audit)
      return res.status(201).json({ data: queue })
    } catch (error) {
      return next(error)
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const audit = getAuditInfo(req)
      const queue = await QueueService.update(id, req.body, audit)
      return res.json({ data: queue })
    } catch (error) {
      return next(error)
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const audit = getAuditInfo(req)
      await QueueService.delete(id, audit)
      return res.status(204).send()
    } catch (error) {
      return next(error)
    }
  }
}
