import prisma from '../config/prisma'
import { getEffectiveScope, canSeeOrg, canSeeQueue, scopeTicketWhere, type EffectiveScope } from './scope'
import { TICKET_DENIAL, roleDenied, forbidden } from '../utils/denials'
import { AppError } from '../middlewares/errorHandler'
import { getEffectiveModules } from './moduleAccess'
import { issuedBeforeInvalidation } from '../middlewares/auth'

export type TicketAccess =
  | { allowed: true; via: 'admin' | 'requester' | 'assigned' | 'scope' | 'collaborator' | 'collab_queue' | 'escalated_queue' }
  | { allowed: false; code: string; message: string }

export interface TicketLike {
  id: string
  user_id: string
  org_id: string | null
  queue: string | null
  assigned_to_id: string | null
  collab_queue?: string | null
  escalated?: boolean | null
}

const deny = (code: string, message: string): TicketAccess => ({ allowed: false, code, message })

/**
 * Acesso = carteira (empresa ∩ fila) OU envolvimento direto no chamado
 * (responsável, colaborador ativo, fila colaboradora, escalonado para a fila).
 * Mesma regra para ver e para agir; o que pode ser alterado é decidido no updateTicket.
 * Filas colaboradora/escalonada valem só para analista: a fila de gestor é só notificação.
 */
export async function getTicketAccess(ticket: TicketLike, user: { sub: string; role: string }): Promise<TicketAccess> {
  if (user.role === 'admin') return { allowed: true, via: 'admin' }
  if (user.role === 'user') {
    return ticket.user_id === user.sub ? { allowed: true, via: 'requester' } : deny('NOT_OWN_TICKET', TICKET_DENIAL.NOT_OWN_TICKET())
  }
  if (!['agent', 'supervisor', 'manager'].includes(user.role)) {
    const e = roleDenied(['agent', 'supervisor', 'manager'], user.role, 'O atendimento de chamados')
    return deny(e.code, e.message)
  }
  // Chamados desligado: a pessoa enxerga como solicitante (só o que abriu). Decidido
  // aqui, na hora, vale para rotas, ponte com Projetos, tempo real e notificações.
  if (!(await getEffectiveModules(user.sub, user.role)).tickets) return getTicketAccess(ticket, { sub: user.sub, role: 'user' })
  if (ticket.assigned_to_id === user.sub) return { allowed: true, via: 'assigned' }

  const scope = await getEffectiveScope(user.sub, user.role)
  if (canSeeOrg(scope, ticket.org_id) && canSeeQueue(scope, ticket.queue)) return { allowed: true, via: 'scope' }

  const participant = await prisma.ticketParticipant.findUnique({
    where: { ticket_id_agent_id: { ticket_id: ticket.id, agent_id: user.sub } },
  })
  if (participant?.active) return { allowed: true, via: 'collaborator' }

  if (scope.enforceQueues) {
    if (ticket.collab_queue && scope.queueIds.includes(ticket.collab_queue)) return { allowed: true, via: 'collab_queue' }
    if (ticket.escalated && ticket.queue && scope.queueIds.includes(ticket.queue)) return { allowed: true, via: 'escalated_queue' }
  }

  // Por último: via 'requester' significa "só chega aqui por ter aberto o chamado".
  // Quem recebe esse via vê e responde como cliente, mesmo sendo da equipe.
  if (ticket.user_id === user.sub) return { allowed: true, via: 'requester' }

  return explainDenial(ticket, scope)
}

async function explainDenial(ticket: TicketLike, scope: EffectiveScope): Promise<TicketAccess> {
  if (!scope.scopeAll && scope.orgIds.length === 0) return deny('SCOPE_NOT_CONFIGURED', TICKET_DENIAL.SCOPE_NOT_CONFIGURED())
  if (!canSeeOrg(scope, ticket.org_id)) {
    const org = ticket.org_id
      ? await prisma.organization.findUnique({ where: { id: ticket.org_id }, select: { name: true } })
      : null
    return deny('ORG_OUT_OF_SCOPE', TICKET_DENIAL.ORG_OUT_OF_SCOPE(org?.name))
  }
  if (scope.enforceQueues && scope.queueIds.length === 0) return deny('NO_QUEUES', TICKET_DENIAL.NO_QUEUES())
  const q = ticket.queue ? await prisma.queue.findUnique({ where: { id: ticket.queue }, select: { name: true } }) : null
  return deny('QUEUE_NOT_ASSIGNED', TICKET_DENIAL.QUEUE_NOT_ASSIGNED(q?.name ?? ticket.queue))
}

/** Filtro de lista coerente com getTicketAccess: carteira OU envolvimento direto. */
export function ticketVisibilityWhere(userId: string | null | undefined, scope: EffectiveScope): any {
  const byScope = scopeTicketWhere(scope)
  if (!byScope.AND) return {}
  // Sem ator não há envolvimento — e { assigned_to_id: undefined } no Prisma casaria TUDO.
  if (!userId) return byScope
  const or: any[] = [
    byScope,
    { user_id: userId }, // solicitante sempre vê o próprio chamado, mesmo fora da carteira
    { assigned_to_id: userId },
    { participants: { some: { agent_id: userId, active: true } } },
  ]
  if (scope.enforceQueues && scope.queueIds.length > 0) {
    or.push({ collab_queue: { in: scope.queueIds } })
    or.push({ escalated: true, queue: { in: scope.queueIds } })
  }
  return { OR: or }
}

/** Campos que `getTicketAccess` precisa — para buscar o chamado só para checar acesso. */
export const TICKET_ACCESS_SELECT = {
  id: true, user_id: true, org_id: true, queue: true, assigned_to_id: true, collab_queue: true, escalated: true,
} as const

type ScopedSocket = {
  data: any
  rooms: Set<string>
  emit: (ev: string, ...args: any[]) => any
  leave?: (room: string) => any
  disconnect?: (close?: boolean) => any
}

type SocketToken = { iat?: number; iat_ms?: number }
type SessionState = { active: boolean; deleted_at: Date | null; session_invalidated_at: Date | null }

/** A conta segue ativa e a sessão que abriu o socket não foi revogada (logout, troca de senha). */
export const socketSessionAlive = (user: SessionState | null | undefined, token: SocketToken | undefined): boolean =>
  !!user && user.active && !user.deleted_at && !issuedBeforeInvalidation(token ?? {}, user.session_invalidated_at)

/**
 * Sockets das salas, separados por quem PODE ver o chamado (mesma regra do REST).
 * Salas de fila e `role:*` juntam gente de várias empresas: sem isto o tempo
 * real vaza chamado entre carteiras. Cache por usuário (vários sockets/abas).
 * O cargo e a sessão vêm do banco a cada entrega (uma consulta só): o que o socket
 * guardou na conexão fica velho quando a pessoa é rebaixada ou sai. Sessão revogada
 * derruba o socket. `requesterView` são os que veem como cliente (sem nota interna).
 */
export async function socketsByTicketAccess(
  io: { in: (rooms: string | string[]) => { fetchSockets: () => Promise<ScopedSocket[]> } },
  rooms: string[],
  ticket: TicketLike,
): Promise<{ allowed: ScopedSocket[]; denied: ScopedSocket[]; requesterView: Set<ScopedSocket> }> {
  const sockets = await io.in(rooms).fetchSockets()
  const allowed: ScopedSocket[] = []
  const denied: ScopedSocket[] = []
  const requesterView = new Set<ScopedSocket>()
  const ids = [...new Set(sockets.map(s => s.data?.userId).filter(Boolean))] as string[]
  if (!ids.length) return { allowed, denied: sockets, requesterView }

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, role: true, active: true, deleted_at: true, session_invalidated_at: true },
  })
  const byId = new Map(users.map(u => [u.id, u]))
  const cache = new Map<string, TicketAccess>()
  for (const s of sockets) {
    const { userId, token } = s.data ?? {}
    const user = byId.get(userId)
    if (!user || !socketSessionAlive(user, token)) {
      s.disconnect?.(true)
      denied.push(s)
      continue
    }
    const access = cache.get(user.id) ?? await getTicketAccess(ticket, { sub: user.id, role: user.role })
    cache.set(user.id, access)
    ;(access.allowed ? allowed : denied).push(s)
    if (access.allowed && access.via === 'requester') requesterView.add(s)
  }
  return { allowed, denied, requesterView }
}

/**
 * Responsável precisa ser da equipe (ativo) e enxergar o chamado pela própria
 * carteira/fila — senão o chamado vai parar com um cliente ou com um analista
 * de outra empresa (que passaria a ver dados que não atende).
 */
export async function assertValidAssignee(ticket: TicketLike, userId: string, opts: { skipScope?: boolean } = {}) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true, active: true, deleted_at: true } })
  if (!u || u.deleted_at || !u.active) throw new AppError(404, 'Responsável não encontrado ou inativo', 'ASSIGNEE_NOT_FOUND')
  if (!['agent', 'supervisor', 'manager'].includes(u.role)) {
    throw new AppError(400, `${u.name} não é da equipe de atendimento e não pode ser responsável por chamados.`, 'ASSIGNEE_NOT_STAFF')
  }
  if (!(await getEffectiveModules(userId, u.role)).tickets) {
    throw new AppError(400, `${u.name} está com o módulo Chamados desligado e não pode ser responsável por chamados.`, 'ASSIGNEE_TICKETS_OFF')
  }
  // Escalonamento: o destino ganha acesso por ser o responsável, mesmo fora da carteira.
  if (opts.skipScope) return
  // Sem responsável e sem solicitante: ter aberto o chamado não é atendê-lo.
  const access = await getTicketAccess({ ...ticket, assigned_to_id: null, user_id: '' }, { sub: userId, role: u.role })
  if (!access.allowed) {
    throw forbidden('ASSIGNEE_OUT_OF_SCOPE', `${u.name} não atende a empresa ou a fila deste chamado. Escolha alguém da carteira ou ajuste a carteira de ${u.name}.`)
  }
}
