import prisma from '../../config/prisma'
import { env } from '../../config/env'
import { SYSTEM_USER_ID } from '../../utils/constants'
import { sendTicketCreatedEmail } from './mailer'

// Confirmação de abertura para o solicitante (inclusive quando a equipe abre em
// nome dele). Vale para todos os canais: portal, API e e-mail.
export async function notifyTicketCreated(ticketId: string) {
  // A suíte cria chamados em massa e o .env local pode ter o ACS real.
  if (env.NODE_ENV === 'test') return

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { user: true, category: { select: { name: true } }, org: { select: { email_reply_enabled: true } } },
  })
  const requester = ticket?.user
  if (!ticket || ticket.deleted_at || !requester?.email || requester.deleted_at || !requester.active) return
  if (requester.id === SYSTEM_USER_ID) return

  await sendTicketCreatedEmail({
    to: requester.email,
    ticketId: ticket.id,
    clientName: requester.name,
    ticketNumber: ticket.display_number,
    ticketTitle: ticket.title,
    description: ticket.description,
    categoryName: ticket.category?.name ?? null,
    openedAt: ticket.created_at,
    openedOnBehalf: Boolean(ticket.created_by_id),
    replyable: Boolean(ticket.org?.email_reply_enabled),
  })
}
