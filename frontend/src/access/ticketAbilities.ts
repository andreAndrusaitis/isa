/**
 * O que a pessoa pode fazer no detalhe de um chamado. Antes eram ~20 checagens
 * de cargo espalhadas pelo TicketDetail; aqui cada regra tem nome. O servidor é
 * a autoridade (access/capabilities.ts e adminReadOnly() no backend): estas
 * regras só decidem o que a tela oferece.
 */
import type { AuthUser } from '@/store/auth'
import type { Ticket } from '@/types'
import { canDeleteTickets, canModerateMessages } from '@/utils/permissions'

type Who = Pick<AuthUser, 'id' | 'role' | 'permissions' | 'modules' | 'queues'>
type TicketLike = Pick<Ticket, 'status' | 'queue' | 'escalated'> & { collabQueue?: string | null }

export interface TicketAbilities {
  /** Atua no chamado: assume, responde, altera, resolve. O admin só olha. */
  act: boolean
  /** Colaborador escalonado: altera e resolve, mas não troca o responsável principal. */
  collaboratorOnly: boolean
  /** Troca o responsável. */
  reassign: boolean
  /** Entra como colaborador num chamado escalonado para uma fila dele. */
  join: boolean
  /** Desfaz o escalonamento (responsável ou gestão). */
  revert: boolean
  /** Exclui o chamado (permissão individual). */
  delete: boolean
  /** Edita/apaga mensagens de outras pessoas. */
  moderate: boolean
  /** Liga o chamado a uma task de Projetos. */
  useProjects: boolean
  /** Ações sobre a IA: dispensar o checklist, vetar orientação, aplicar triagem. */
  aiActions: boolean
  /** Vê o painel de triagem da IA. */
  seesTriage: boolean
}

export function ticketAbilities(
  user: Who,
  ticket: TicketLike,
  { isOwner, participation }: { isOwner: boolean; participation?: { role?: string } | null },
): TicketAbilities {
  const isAdmin = user.role === 'admin'
  const act = !isAdmin
  const isManager = user.role === 'supervisor' || user.role === 'manager'
  const collaboratorOnly = user.role === 'agent' && !isOwner && participation?.role === 'collaborator'
  const myQueues = user.queues || []
  const join = user.role === 'agent' && !isOwner && !participation &&
    !['resolved', 'closed'].includes(ticket.status) &&
    ((!!ticket.collabQueue && myQueues.includes(ticket.collabQueue)) || (!!ticket.escalated && !!ticket.queue && myQueues.includes(ticket.queue)))
  return {
    act,
    collaboratorOnly,
    reassign: act && !collaboratorOnly,
    join,
    revert: (isOwner || isManager) && act,
    delete: canDeleteTickets(user),
    moderate: canModerateMessages(user),
    useProjects: !!user.modules?.projects && act,
    aiActions: act,
    seesTriage: user.role !== 'user',
  }
}
