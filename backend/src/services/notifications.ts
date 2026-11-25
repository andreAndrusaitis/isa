import prisma from '../config/prisma'
import { getIo } from '../config/socket'
import { getTicketAccess, socketsByTicketAccess, TICKET_ACCESS_SELECT } from './ticketAccess'
import { ticketRole } from '../access/can'

type NotifType = 'new_message' | 'new_attachment' | 'ticket_assigned' | 'ticket_queue_moved' | 'new_ticket' | 'ticket_redirected' | 'ticket_schedule_reopened' | 'routing_alert' | 'project_forecast'

interface CreateParams {
  userId: string
  ticketId: string
  type: NotifType
  title: string
  body: string
  senderName?: string
}

export class NotificationService {
  static async create(params: CreateParams): Promise<void> {
    try {
      // Destinatário escolhido por fila pode não enxergar o chamado (outra
      // carteira): não notifica — o título vazaria entre empresas.
      const [ticket, recipient] = await Promise.all([
        prisma.ticket.findUnique({ where: { id: params.ticketId }, select: TICKET_ACCESS_SELECT }),
        prisma.user.findUnique({ where: { id: params.userId }, select: { role: true } }),
      ])
      // Chamados desligado: o destinatário enxerga como solicitante (ticketRole).
      if (!ticket || !recipient || !(await getTicketAccess(ticket, { sub: params.userId, role: await ticketRole(params.userId, recipient.role) })).allowed) return

      const notif = await prisma.notification.create({
        data: {
          user_id: params.userId,
          ticket_id: params.ticketId,
          type: params.type,
          title: params.title,
          body: params.body,
          sender_name: params.senderName ?? null,
        },
      })

      const io = getIo()
      console.log(`[NotificationService] tipo=${params.type} userId=${params.userId} io=${!!io}`)
      if (io) {
        io.to(`user:${params.userId}`).emit('notification:new', {
          id: notif.id,
          ticketId: params.ticketId,
          ticketNumber: params.ticketId,
          type: params.type,
          title: params.title,
          body: params.body,
          senderName: params.senderName ?? null,
          createdAt: notif.created_at.toISOString(),
        })
      }

    } catch (err) {
      console.error('[NotificationService] Erro ao criar notificação:', err)
    }
  }

  static async getUnread(userId: string) {
    return prisma.notification.findMany({
      where: { user_id: userId, read_at: null, ticket: { deleted_at: null } },
      orderBy: { created_at: 'desc' },
      take: 100,
    })
  }

  static async markRead(notificationId: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id: notificationId, user_id: userId, read_at: null },
      data: { read_at: new Date() },
    })
  }

  static async markTicketRead(ticketId: string, userId: string) {
    return prisma.notification.updateMany({
      where: { ticket_id: ticketId, user_id: userId, read_at: null },
      data: { read_at: new Date() },
    })
  }

  // Sino da área de Projetos: notificações de tarefa (menção, atribuição, automação).
  static async getUnreadTasks(userId: string) {
    return prisma.notification.findMany({
      where: { user_id: userId, read_at: null, task: { archived_at: null } },
      include: { task: { select: { project_id: true, seq: true, key: true } } },
      orderBy: { created_at: 'desc' },
      take: 100,
    })
  }

  static async markAllTasksRead(userId: string) {
    return prisma.notification.updateMany({
      where: { user_id: userId, read_at: null, task_id: { not: null } },
      data: { read_at: new Date() },
    })
  }

  // Só chamados: o "marcar todas" do sino de chamados não limpa o sino de Projetos.
  static async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { user_id: userId, read_at: null, ticket_id: { not: null } },
      data: { read_at: new Date() },
    })
  }

  /**
   * Emite alerta em tempo real para todos os agentes conectados no room da fila.
   * Não persiste no banco — usado como broadcast imediato complementar às notificações por agente.
   */
  static async broadcastQueueAlert(params: {
    queueId: string
    ticketId: string
    title: string
    body: string
    type: 'new_ticket' | 'ticket_queue_moved'
    excludeUserId?: string
  }): Promise<void> {
    try {
      const io = getIo()
      if (!io) return
      const ticket = await prisma.ticket.findUnique({ where: { id: params.ticketId }, select: TICKET_ACCESS_SELECT })
      if (!ticket) return
      // A sala da fila junta analistas de várias empresas: só quem enxerga o chamado recebe.
      const { allowed } = await socketsByTicketAccess(io, [`queue:${params.queueId}`], ticket)
      for (const s of allowed) {
        if (s.data.userId === params.excludeUserId) continue
        s.emit('ticket:queue_alert', {
          ticketId: params.ticketId,
          ticketNumber: params.ticketId,
          type: params.type,
          title: params.title,
          body: params.body,
        })
      }
    } catch (err) {
      console.error('[NotificationService] Erro no alerta de fila:', err)
    }
  }
}
