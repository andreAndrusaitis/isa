import { button, emailPage, escapeHtml, p, quote, rows, section, small } from './layout'
import { replyFooter, replyHint } from './ticketUpdate'

export interface TicketCreatedEmailParams {
  clientName: string
  ticketNumber: string
  ticketTitle: string
  /** Nulo em chamado especial (formulário estruturado no lugar da descrição). */
  description?: string | null
  categoryName?: string | null
  openedAt: Date
  /** Aberto pela equipe em nome do cliente (abertura proativa). */
  openedOnBehalf?: boolean
  ticketUrl: string
  /** Empresa com resposta por e-mail: a resposta do cliente entra no chamado. */
  replyable?: boolean
}

const DESCRIPTION_MAX = 1000

export function buildTicketCreatedTemplate(params: TicketCreatedEmailParams) {
  const openedAt = params.openedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
  const rawDescription = params.description?.trim() ?? ''
  const description = rawDescription.length > DESCRIPTION_MAX ? `${rawDescription.slice(0, DESCRIPTION_MAX)}…` : rawDescription
  const intro = params.openedOnBehalf
    ? 'A equipe de atendimento abriu um chamado em seu nome. Ele já está na fila de atendimento.'
    : 'Recebemos o seu chamado. Ele já está na fila de atendimento.'
  const subject = `Chamado [${params.ticketNumber}] aberto: ${params.ticketTitle.slice(0, 120)}`

  const text = [
    `Olá, ${params.clientName}!`,
    '',
    intro,
    '',
    `Número: ${params.ticketNumber}`,
    `Título: ${params.ticketTitle}`,
    params.categoryName ? `Categoria: ${params.categoryName}` : null,
    `Aberto em: ${openedAt}`,
    'Status: Aberto',
    ...(description ? ['', 'Descrição:', description] : []),
    '',
    'Você receberá um e-mail a cada resposta ou mudança de status. Use o número do chamado como referência.',
    replyHint(params.replyable),
    '',
    `Acompanhe o chamado: ${params.ticketUrl}`,
  ].filter(l => l !== null).join('\n')

  const body = [
    p(`Olá, ${escapeHtml(params.clientName)}!`),
    p(escapeHtml(intro)),
    rows([
      ['Número', `<strong>${escapeHtml(params.ticketNumber)}</strong>`],
      ['Título', escapeHtml(params.ticketTitle)],
      !!params.categoryName && ['Categoria', escapeHtml(params.categoryName)],
      ['Aberto em', escapeHtml(openedAt)],
      ['Situação', 'Aberto'],
    ]),
    description ? section('Descrição') + quote(description) : '',
    small(`Você receberá um e-mail a cada resposta ou mudança de status. Use o número do chamado como referência. ${escapeHtml(replyHint(params.replyable))}`),
    button(escapeHtml(params.ticketUrl), 'Ver meu chamado'),
  ].join('\n                  ')

  const html = emailPage({ subject, heading: 'Confirmação de abertura do chamado', body, footer: replyFooter(params.replyable) })

  return { subject, text, html }
}
