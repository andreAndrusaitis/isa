import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from './audit'
import { deleteAttachments } from './uploads'
import { TicketService } from './tickets'
import { logger } from '../utils/logger'
import type { AuditInfo } from '../utils/audit'

const DAY_MS = 24 * 3600 * 1000

export async function getTrashConfig() {
  return (await prisma.trashConfig.findFirst()) ?? prisma.trashConfig.create({ data: {} })
}

export async function updateTrashConfig(data: { enabled?: boolean; retention_days?: number }, audit: AuditInfo) {
  const current = await getTrashConfig()
  const updated = await prisma.trashConfig.update({ where: { id: current.id }, data })
  await createAuditLog({
    userId: audit.actorId,
    action: 'UPDATE_TRASH_CONFIG',
    resource: 'TRASH',
    details: { before: { enabled: current.enabled, retention_days: current.retention_days }, after: data },
    ip: audit.ip,
    userAgent: audit.userAgent,
  })
  return updated
}

// visibility: mesma regra da lista de chamados. A área 'trash' libera o recurso; a
// carteira de quem a recebeu diz de quais empresas (admin não tem filtro).
export async function listTrash(params: { page: number; pageSize: number; search?: string; orgId?: string; visibility?: any }) {
  const { page, pageSize, search, orgId, visibility } = params
  const where: any = { deleted_at: { not: null } }
  if (visibility) where.AND = [visibility]
  if (orgId && orgId !== 'all') {
    const ids = orgId.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 1) {
      where.org_id = ids[0]
    } else if (ids.length > 1) {
      where.org_id = { in: ids }
    }
  }
  if (search) {
    where.OR = [
      { display_number: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
    ]
  }
  const [total, rows, config] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      orderBy: { deleted_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, display_number: true, title: true, deleted_at: true,
        org: { select: { id: true, name: true } },
        deleted_by: { select: { id: true, name: true } },
      },
    }),
    getTrashConfig(),
  ])
  const data = rows.map(t => ({
    id: t.id,
    displayNumber: t.display_number,
    title: t.title,
    org: t.org,
    deletedBy: t.deleted_by,
    deletedAt: t.deleted_at,
    purgeAt: config.enabled ? new Date(t.deleted_at!.getTime() + config.retention_days * DAY_MS) : null,
  }))
  return { data, total, page, pageSize }
}

async function findTrashed(id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } })
  if (!ticket || !ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado na Lixeira', 'NOT_FOUND')
  return ticket
}

export async function restoreTicket(id: string, audit: AuditInfo) {
  const ticket = await findTrashed(id)
  await prisma.ticket.update({ where: { id }, data: { deleted_at: null, deleted_by_id: null } })
  await createAuditLog({
    userId: audit.actorId,
    action: 'RESTORE_TICKET',
    resource: 'TICKET',
    details: { ticketId: id, displayNumber: ticket.display_number, title: ticket.title, deletedAt: ticket.deleted_at },
    ip: audit.ip,
    userAgent: audit.userAgent,
  })
  // Reaparece nas listas abertas sem recarregar.
  TicketService.broadcastTicketUpdate(id, 'ticket:created')
}

/**
 * Exclusão definitiva: mensagens, eventos, participantes, notificações e pesquisa
 * caem por cascade no banco.
 * Os blobs dos anexos são removidos depois do DELETE — falha no storage só deixa
 * órfão (logado), nunca impede a exclusão.
 */
export async function purgeTicket(id: string, audit: AuditInfo, automatic = false) {
  const ticket = await findTrashed(id)
  const [messages, events, attachments] = await Promise.all([
    prisma.ticketMessage.findMany({ where: { ticket_id: id, attachment_url: { not: null } }, select: { attachment_url: true } }),
    prisma.ticketEvent.findMany({ where: { ticket_id: id, attachment_url: { not: null } }, select: { attachment_url: true } }),
    prisma.ticketAttachment.findMany({ where: { ticket_id: id }, select: { url: true } }),
  ])

  await prisma.ticket.delete({ where: { id } })

  const failed = await deleteAttachments([
    ticket.attachment_url,
    ...messages.map(m => m.attachment_url),
    ...events.map(e => e.attachment_url),
    ...attachments.map(a => a.url),
  ])
  if (failed.length) logger.error('[Trash] Falha ao remover blobs de chamado excluído', { ticketId: id, failed })

  await createAuditLog({
    userId: audit.actorId,
    action: 'PURGE_TICKET',
    resource: 'TICKET',
    details: { ticketId: id, displayNumber: ticket.display_number, title: ticket.title, deletedAt: ticket.deleted_at, automatic },
    ip: audit.ip,
    userAgent: audit.userAgent,
  })
}

/** Job diário: apaga de vez o que está na Lixeira há mais que a retenção configurada. */
export async function purgeExpiredTickets() {
  const config = await getTrashConfig()
  if (!config.enabled) return 0
  const cutoff = new Date(Date.now() - config.retention_days * DAY_MS)
  const expired = await prisma.ticket.findMany({ where: { deleted_at: { lt: cutoff } }, select: { id: true } })
  let purged = 0
  for (const { id } of expired) {
    try {
      await purgeTicket(id, {}, true)
      purged++
    } catch (err) {
      logger.error('[Trash] Erro ao excluir definitivamente chamado', { ticketId: id, err })
    }
  }
  if (purged) logger.info(`[Trash] ${purged} chamado(s) excluído(s) definitivamente da Lixeira`)
  return purged
}
