/**
 * Cabeçalho e linha da lista de chamados da equipe (Analista, TM, Gerente).
 * Antes eram duas cópias (AgentPage e SupervisorPage) que se distanciaram com o
 * tempo; as diferenças de hoje estão preservadas na `variant` e listadas abaixo.
 * Igualar qualquer uma delas é decisão de produto (fora da refatoração).
 *
 * Diferenças agent × mgmt:
 * - não lidas e "Sem responsável" em destaque no chamado aberto: só agent;
 * - status: agent mostra "reaberto"; mgmt o status puro, com "Reaberto" ao lado.
 */
import type { Ticket } from '@/types'
import { SLABadge, isAiResolved } from '@/components/ui'
import { IntakeFlag } from '@/components/IntakeFlag'
import type { SortDir } from '@/hooks/useTableSort'
import { TicketRow, TicketRowsHeader } from './TicketRow'

export type TicketGridVariant = 'agent' | 'mgmt'

export function TicketGridHeader({ header }: { header: (label: string) => { dir: SortDir | null; onClick: () => void } }) {
  return (
    <TicketRowsHeader
      className="ticket-grid-header"
      number={['ID', 'Número']}
      subject={['Título / solicitante', 'Assunto']}
      status={['Status', 'Situação']}
      priority="Prioridade"
      owner={['Atribuído', 'Responsável']}
      due={['SLA', 'Prazo']}
      header={header}
    />
  )
}

export interface TicketGridLookups {
  getUser: (id: any) => any
  getOrg: (id: any) => any
  getCat: (id: any) => any
  queues: { id: string; name?: string; color?: string }[]
}

export function TicketGridRow({ ticket, variant, lookups, unreadCount = 0, onOpen }: {
  ticket: Ticket
  variant: TicketGridVariant
  lookups: TicketGridLookups
  unreadCount?: number
  onOpen: (ticket: Ticket) => void
}) {
  const agentView = variant === 'agent'
  const { getUser, getOrg, getCat, queues } = lookups
  const req = getUser(ticket.userId)
  const activeCollab = ticket.participants?.find(p => p.role === 'collaborator' && p.active)
  const agent = activeCollab ? getUser(activeCollab.agentId) : (ticket.assignedToId ? getUser(ticket.assignedToId) : null)
  const org = ticket.orgId ? getOrg(ticket.orgId) : null
  const cat = getCat(ticket.categoryId)
  const queue = queues.find(q => q.id === ticket.queue)

  return (
    <TicketRow
      className="ticket-grid-row"
      status={agentView && ticket.is_reopened ? 'reopened' : ticket.status}
      number={ticket.displayNumber}
      title={ticket.title}
      type={ticket.type}
      unread={agentView ? unreadCount : 0}
      priority={ticket.priority}
      done={['resolved', 'closed'].includes(ticket.status)}
      meta={[
        ticket.is_reopened && !agentView && <span className="danger">Reaberto</span>,
        ticket.escalated && <span>Escalonado</span>,
        <IntakeFlag ticketId={ticket.id} status={ticket.intake_status} ticketStatus={ticket.status} compact />,
        req && <span>{req.name}</span>,
        org && <span>{org.name}</span>,
        <span>{ticket.queue ? queue?.name ?? 'Fila desconhecida' : 'Sem fila'}</span>,
        cat && <span>{cat.name}</span>,
      ]}
      deadline={isAiResolved(ticket) ? '—' : (
        <SLABadge
          deadline={ticket.slaDeadline}
          status={ticket.status}
          resolvedAt={ticket.resolved_at}
          forecastOverdue={!!ticket.project_forecast_alerted_at && ticket.pendingReason === 'pending_project'}
          compact
        />
      )}
      ownerName={agent?.name}
      owner={agent ? <span title={agent.name}>{agent.name}</span> : <span className={agentView && ticket.status === 'open' ? 'strong' : undefined}>Sem responsável</span>}
      onOpen={() => onOpen(ticket)}
    />
  )
}
