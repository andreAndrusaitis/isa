import { Request, Response } from 'express'
import { getAuditLogs } from '../services/audit'

export async function listAuditLogs(req: Request, res: Response) {
  const { page, limit, userId, action, resource, startDate, endDate, search } = req.query

  const result = await getAuditLogs({
    page: Math.max(parseInt(page as string) || 0, 0) || undefined,
    limit: Math.min(Math.max(parseInt(limit as string) || 0, 0), 200) || undefined,
    userId: userId as string,
    action: action as string,
    resource: resource as string,
    startDate: startDate as string,
    endDate: endDate as string,
    search: search as string,
  }, req.user)

  res.json(result)
}
