import { Request, Response, NextFunction } from 'express'
import * as ExternalApi from '../services/externalApi'

export class ExternalApiController {
  static async createTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ExternalApi.createTicket(req.apiKey!, req.body, { ip: req.ip })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      return next(error)
    }
  }

  static async updateTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ExternalApi.updateTicket(req.apiKey!, req.params.id as string, req.body, { ip: req.ip })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      return next(error)
    }
  }

  static async addTicketAttachment(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ExternalApi.addTicketAttachment(req.apiKey!, req.params.id as string, req.body, { ip: req.ip })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      return next(error)
    }
  }

  static async closeTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ExternalApi.closeTicket(req.apiKey!, req.params.id as string, req.body, { ip: req.ip })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      return next(error)
    }
  }

  static async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ExternalApi.createExternalUser(req.apiKey!, req.body, { ip: req.ip })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      return next(error)
    }
  }

  static async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ExternalApi.updateExternalUser(req.apiKey!, req.params.idOrEmail as string, req.body, { ip: req.ip })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      return next(error)
    }
  }

  static async listTickets(req: Request, res: Response, next: NextFunction) {
    try {
      return res.json(await ExternalApi.listTickets(req.apiKey!, req.query))
    } catch (error) {
      return next(error)
    }
  }

  static async getTicket(req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: await ExternalApi.getTicket(req.apiKey!, req.params.id as string) })
    } catch (error) {
      return next(error)
    }
  }

  static async listTicketMessages(req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: await ExternalApi.listTicketMessages(req.apiKey!, req.params.id as string, req.query) })
    } catch (error) {
      return next(error)
    }
  }

  static async createTicketMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ExternalApi.createTicketMessage(req.apiKey!, req.params.id as string, req.body, { ip: req.ip })
      return res.status(result.statusCode).json(result.body)
    } catch (error) {
      return next(error)
    }
  }

  static async listCategories(req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: await ExternalApi.listCategories(req.apiKey!, req.query) })
    } catch (error) {
      return next(error)
    }
  }

  static async listSubcategories(req: Request, res: Response, next: NextFunction) {
    try {
      const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id : undefined
      return res.json({ data: await ExternalApi.listSubcategories(categoryId, req.apiKey!, req.query) })
    } catch (error) {
      return next(error)
    }
  }

  static async listQueues(_req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: await ExternalApi.listQueues() })
    } catch (error) {
      return next(error)
    }
  }

  static async listOrganizations(req: Request, res: Response, next: NextFunction) {
    try {
      return res.json({ data: await ExternalApi.listOrganizations(req.apiKey!) })
    } catch (error) {
      return next(error)
    }
  }
}
