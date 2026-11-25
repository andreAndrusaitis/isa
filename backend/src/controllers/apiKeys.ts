import { Request, Response, NextFunction } from 'express'
import { getAuditInfo } from '../utils/audit'
import * as ApiKeys from '../services/apiKeys'

export class ApiKeyController {
  static async listScopes(_req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: ApiKeys.listScopes() })
    } catch (error) {
      return next(error)
    }
  }

  static async list(_req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: await ApiKeys.listApiKeys() })
    } catch (error) {
      return next(error)
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const key = await ApiKeys.createApiKey(req.body, getAuditInfo(req))
      return res.status(201).json({ data: key })
    } catch (error) {
      return next(error)
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const key = await ApiKeys.updateApiKey(req.params.id as string, req.body, getAuditInfo(req))
      return res.json({ data: key })
    } catch (error) {
      return next(error)
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await ApiKeys.deleteApiKey(req.params.id as string, getAuditInfo(req))
      return res.status(204).send()
    } catch (error) {
      return next(error)
    }
  }

  static async regenerate(req: Request, res: Response, next: NextFunction) {
    try {
      const key = await ApiKeys.regenerateApiKey(req.params.id as string, getAuditInfo(req))
      return res.json({ data: key })
    } catch (error) {
      return next(error)
    }
  }

  static async listRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(1, Number(req.query.page) || 1)
      const result = await ApiKeys.listApiKeyRequests(req.params.id as string, page)
      return res.json(result)
    } catch (error) {
      return next(error)
    }
  }
}
