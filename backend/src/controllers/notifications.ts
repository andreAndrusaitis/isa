import { Request, Response, NextFunction } from 'express'
import { NotificationService } from '../services/notifications'

export async function getUnread(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub
    const items = await NotificationService.getUnread(userId)
    res.json({ data: items })
  } catch (err) {
    next(err)
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub
    const id = req.params.id as string
    await NotificationService.markRead(id, userId)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function markTicketRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub
    const ticketId = req.params.ticketId as string
    await NotificationService.markTicketRead(ticketId, userId)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub
    await NotificationService.markAllRead(userId)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function getUnreadTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await NotificationService.getUnreadTasks(req.user!.sub)
    res.json({ data: items })
  } catch (err) {
    next(err)
  }
}

export async function markAllTasksRead(req: Request, res: Response, next: NextFunction) {
  try {
    await NotificationService.markAllTasksRead(req.user!.sub)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}
