/** Janela de reabertura: enquanto aberta, o cliente ainda vai dizer se resolveu. */
export interface ReopenTicket {
  status: string
  reopen_sla_enabled: boolean | null
  reopen_sla_limit_hours: number | null
  resolved_at: Date | null
  closed_at: Date | null
  updated_at: Date | null
}
export interface ReopenConfig { enabled: boolean; reopen_limit_hours: number }

export function canStillReopen(ticket: ReopenTicket, config?: ReopenConfig | null, now = Date.now()): boolean {
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') return false
  const enabled = ticket.reopen_sla_enabled !== null ? ticket.reopen_sla_enabled : (config?.enabled ?? true)
  if (!enabled) return true
  const limitHours = ticket.reopen_sla_limit_hours !== null ? ticket.reopen_sla_limit_hours : (config?.reopen_limit_hours ?? 24)
  const since = ticket.resolved_at || ticket.closed_at || ticket.updated_at
  return !!since && (now - new Date(since).getTime()) / 3600000 <= limitHours
}
