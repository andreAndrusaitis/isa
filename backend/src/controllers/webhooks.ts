import { Request, Response, NextFunction } from 'express'
import { getAuditInfo } from '../utils/audit'
import * as WebhookAdmin from '../services/webhookAdmin'

export class WebhookController {
  // ── Eventos disponíveis (para a UI montar a seleção) ──────────────────────
  static async listEvents(_req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: WebhookAdmin.listWebhookEvents() })
    } catch (error) {
      return next(error)
    }
  }

  static async getEventExample(req: Request, res: Response, next: NextFunction) {
    try {
      const example = WebhookAdmin.getEventExample(req.params.event as string)
      return res.json({ data: example })
    } catch (error) {
      return next(error)
    }
  }

  static async getEventSchema(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = WebhookAdmin.getEventJsonSchema(req.params.event as string)
      return res.json({ data: schema })
    } catch (error) {
      return next(error)
    }
  }

  // ── Outbound: endpoints ───────────────────────────────────────────────────
  static async listEndpoints(_req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: await WebhookAdmin.listEndpoints() })
    } catch (error) {
      return next(error)
    }
  }

  static async createEndpoint(req: Request, res: Response, next: NextFunction) {
    try {
      const endpoint = await WebhookAdmin.createEndpoint(req.body, getAuditInfo(req))
      return res.status(201).json({ data: endpoint })
    } catch (error) {
      return next(error)
    }
  }

  static async updateEndpoint(req: Request, res: Response, next: NextFunction) {
    try {
      const endpoint = await WebhookAdmin.updateEndpoint(req.params.id as string, req.body, getAuditInfo(req))
      return res.json({ data: endpoint })
    } catch (error) {
      return next(error)
    }
  }

  static async deleteEndpoint(req: Request, res: Response, next: NextFunction) {
    try {
      await WebhookAdmin.deleteEndpoint(req.params.id as string, getAuditInfo(req))
      return res.status(204).send()
    } catch (error) {
      return next(error)
    }
  }

  static async regenerateSecret(req: Request, res: Response, next: NextFunction) {
    try {
      const endpoint = await WebhookAdmin.regenerateEndpointSecret(req.params.id as string, getAuditInfo(req))
      return res.json({ data: endpoint })
    } catch (error) {
      return next(error)
    }
  }

  static async testEndpoint(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await WebhookAdmin.testEndpoint(req.params.id as string)
      return res.json({ data: result })
    } catch (error) {
      return next(error)
    }
  }

  static async listDeliveries(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(1, Number(req.query.page) || 1)
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const result = await WebhookAdmin.listDeliveries(req.params.id as string, page, status)
      return res.json(result)
    } catch (error) {
      return next(error)
    }
  }

  static async retryDelivery(req: Request, res: Response, next: NextFunction) {
    try {
      const delivery = await WebhookAdmin.retryDelivery(req.params.id as string)
      return res.json({ data: delivery })
    } catch (error) {
      return next(error)
    }
  }
}
