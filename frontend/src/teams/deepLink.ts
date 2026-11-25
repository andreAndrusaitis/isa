/**
 * Link profundo para um chamado dentro da aba do Teams. O Teams abre a aba
 * `isa-home` com `subEntityId` = id do chamado, que chega no contexto como
 * `page.subPageId`; a aba então vai para /c/<id> (TicketLink).
 */

/** `id` do app no manifesto do Teams; defina VITE_TEAMS_APP_ID no build. */
export const TEAMS_APP_ID: string = import.meta.env.VITE_TEAMS_APP_ID ?? '00000000-0000-0000-0000-000000000000'
/** `entityId` da aba pessoal no manifesto. */
export const TEAMS_TAB_ENTITY_ID = 'isa-home'

const TICKET_ID_RE = /^[\w.-]{1,64}$/

export function teamsTicketDeepLink(ticketId: string): string {
  const context = encodeURIComponent(JSON.stringify({ subEntityId: ticketId }))
  return `https://teams.microsoft.com/l/entity/${TEAMS_APP_ID}/${TEAMS_TAB_ENTITY_ID}?context=${context}`
}

/** Caminho do chamado para o subEntityId recebido do Teams; null se não for um id válido. */
export function ticketPathFromSubEntity(subEntityId?: string | null): string | null {
  const id = subEntityId?.trim()
  if (!id || !TICKET_ID_RE.test(id)) return null
  return `/c/${encodeURIComponent(id)}`
}
