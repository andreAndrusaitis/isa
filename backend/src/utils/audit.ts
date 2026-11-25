import { Request } from 'express'

export interface AuditInfo {
  actorId?: string
  ip?: string
  userAgent?: string
}

export function getAuditInfo(req: Request): AuditInfo {
  return {
    actorId: (req as any).user?.sub || (req as any).user?.id,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  }
}
