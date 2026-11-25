import prisma from '../config/prisma'
import { NotificationService } from './notifications'

/**
 * Chamado pai/filho do escalonamento (ticket_links kind 'child': ticket_id = filho,
 * related_id = pai). Quem vê um chamado vê o número, o título e o status do pai e dos
 * filhos — mesma regra da prévia de links; abrir o outro chamado segue o acesso dele.
 */
const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto', in_progress: 'Em atendimento', pending: 'Pendente', resolved: 'Resolvido', closed: 'Fechado',
}

const SUMMARY = {
  id: true, display_number: true, title: true, status: true, queue: true, deleted_at: true,
  assigned_to: { select: { id: true, name: true } },
} as const

function summary(t: any) {
  return {
    id: t.id,
    displayNumber: t.display_number,
    title: t.title,
    status: t.status,
    queue: t.queue,
    assignedTo: t.assigned_to ? { id: t.assigned_to.id, name: t.assigned_to.name } : null,
  }
}

export async function getTicketFamily(ticketId: string) {
  const [asChild, asParent] = await Promise.all([
    prisma.ticketLink.findFirst({ where: { ticket_id: ticketId, kind: 'child' }, include: { related: { select: SUMMARY } } }),
    prisma.ticketLink.findMany({ where: { related_id: ticketId, kind: 'child' }, include: { ticket: { select: SUMMARY } }, orderBy: { created_at: 'asc' } }),
  ])
  return {
    parent: asChild?.related && !asChild.related.deleted_at ? summary(asChild.related) : null,
    children: asParent.map(l => l.ticket).filter(t => t && !t.deleted_at).map(summary),
  }
}

/** O filho foi resolvido/fechado: registra no pai e avisa o responsável do pai. Nunca lança. */
export async function notifyParentOfChildStatus(childId: string, toStatus: string, actorId: string) {
  try {
    if (!['resolved', 'closed'].includes(toStatus)) return
    const link = await prisma.ticketLink.findFirst({
      where: { ticket_id: childId, kind: 'child' },
      include: { related: { select: { id: true, title: true, status: true, assigned_to_id: true, deleted_at: true } } },
    })
    const parent = link?.related
    if (!parent || parent.deleted_at) return
    const [open, total] = await Promise.all([
      prisma.ticketLink.count({ where: { related_id: parent.id, kind: 'child', ticket: { status: { notIn: ['resolved', 'closed'] }, deleted_at: null } } }),
      prisma.ticketLink.count({ where: { related_id: parent.id, kind: 'child', ticket: { deleted_at: null } } }),
    ])
    const tail = open === 0 ? ' Todos os chamados filhos foram concluídos.' : ` Filhos em aberto: ${open} de ${total}.`
    await prisma.ticketMessage.create({
      data: {
        ticket_id: parent.id,
        user_id: actorId,
        type: 'internal',
        text: `**[CHAMADO FILHO]** ${childId} foi ${STATUS_LABEL[toStatus]?.toLowerCase() ?? toStatus}.${tail}`,
      },
    })
    if (parent.assigned_to_id && parent.assigned_to_id !== actorId) {
      NotificationService.create({
        userId: parent.assigned_to_id,
        ticketId: parent.id,
        type: 'new_message',
        title: parent.title,
        body: `Chamado filho ${childId} ${STATUS_LABEL[toStatus]?.toLowerCase() ?? toStatus}`,
      })
    }
  } catch (err) {
    console.error('[ticketFamily] falha ao avisar o pai:', err)
  }
}
