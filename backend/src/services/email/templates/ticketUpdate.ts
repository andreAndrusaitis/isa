import { button, emailPage, escapeHtml, muted, p, quote, rows, section, small } from './layout'

export { escapeHtml }

export interface TicketUpdateEmailParams {
  clientName: string
  ticketNumber: string
  ticketTitle: string
  status?: { from: string; to: string } | null
  replies: string[]
  /** Nova previsão (ISO) do chamado que segue o prazo de uma task de projeto. */
  forecast?: string | null
  pendingReason?: string | null
  resolutionDetails?: string | null
  ticketUrl: string
  /** Empresa com resposta por e-mail: a resposta do cliente entra no chamado. */
  replyable?: boolean
  /** Anexos das respostas; attached false = não coube no e-mail, está no chamado. */
  attachments?: { name: string; attached: boolean }[]
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  in_progress: 'Em atendimento',
  pending: 'Pendente',
  resolved: 'Resolvido',
  closed: 'Fechado',
}

const STATUS_MESSAGES: Record<string, string> = {
  open: 'Seu chamado foi reaberto e voltou para a fila de atendimento.',
  in_progress: 'Um analista está trabalhando no seu chamado.',
  pending: 'Seu chamado foi colocado em espera.',
  resolved: 'Seu chamado foi resolvido. Se o problema persistir, você pode reabri-lo pelo portal.',
  closed: 'Seu chamado foi encerrado.',
}

const PENDING_REASON_LABELS: Record<string, string> = {
  pending_user: 'Aguardando retorno seu — acesse o chamado para responder.',
  pending_vendor: 'Aguardando fornecedor.',
  pending_approval: 'Aguardando aprovação interna.',
  pending_parts: 'Aguardando peça/material.',
  pending_schedule: 'Aguardando o horário agendado.',
  pending_project: 'Em projeto — seu chamado está sendo tratado por uma demanda da equipe e segue a previsão abaixo.',
}

// Com resposta por e-mail liberada para a empresa, o cliente responde direto;
// sem ela, o corpo do e-mail diz para não responder.
export const replyHint = (replyable?: boolean) => replyable
  ? 'Para falar com o analista, basta responder este e-mail.'
  : 'Não responda este e-mail. Para falar com o analista, acesse o chamado pelo botão abaixo.'

export const replyFooter = (replyable?: boolean) => replyable
  ? 'Este e-mail foi enviado pelo sistema ISA. Sua resposta é registrada no chamado.'
  : 'Este é um e-mail transacional enviado pelo sistema ISA.<br>Por favor, não responda diretamente a esta mensagem.'

export function buildTicketUpdateTemplate(params: TicketUpdateEmailParams) {
  const { status, replies } = params
  const to = status ? STATUS_LABELS[status.to] ?? status.to : null
  const from = status ? STATUS_LABELS[status.from] ?? status.from : null
  const message = status ? STATUS_MESSAGES[status.to] ?? 'O status do seu chamado foi atualizado.' : null
  const pendingReason = status?.to === 'pending' && params.pendingReason ? PENDING_REASON_LABELS[params.pendingReason] : null
  const resolution = status?.to === 'resolved' ? params.resolutionDetails?.trim() : null
  const attachments = params.attachments ?? []
  const onlyInTicket = attachments.filter(a => !a.attached)
  const repliesTitle = replies.length === 1 ? 'Nova resposta' : replies.length ? `${replies.length} novas respostas` : attachments.length === 1 ? 'Novo anexo' : 'Novos anexos'
  const forecast = params.forecast ? new Date(params.forecast).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null // prazo é data: UTC não volta um dia

  const ref = `Chamado [${params.ticketNumber}]`
  const subject = to ? `${ref}: ${to}`
    : !replies.length && forecast ? `${ref}: nova previsão ${forecast}`
    : `${ref}: ${repliesTitle.toLowerCase()}`

  const text = [
    `Olá, ${params.clientName}!`,
    '',
    `Seu chamado ${params.ticketNumber} — ${params.ticketTitle} foi atualizado.`,
    status ? `Status: ${from} -> ${to}. ${message}` : null,
    pendingReason ? `Motivo: ${pendingReason}` : null,
    resolution ? `Resolução: ${resolution}` : null,
    forecast ? `Previsão de conclusão: ${forecast}` : null,
    ...(replies.length ? ['', `${repliesTitle}:`, ...replies.map(r => `> ${r}`)] : []),
    ...(attachments.length ? ['', 'Anexos:', ...attachments.map(a => `- ${a.name}${a.attached ? '' : ' (disponível no chamado)'}`)] : []),
    '',
    `Acompanhe o chamado: ${params.ticketUrl}`,
  ].filter(l => l !== null).join('\n')

  const body = [
    p(`Olá, ${escapeHtml(params.clientName)}!`),
    p(`Seu chamado <strong>${escapeHtml(params.ticketNumber)} — ${escapeHtml(params.ticketTitle)}</strong> foi atualizado.`),
    status || forecast ? rows([
      !!status && ['Situação', `${escapeHtml(from!)} &rarr; <strong>${escapeHtml(to!)}</strong><br>${muted(escapeHtml(message!))}`],
      !!pendingReason && ['Motivo', escapeHtml(pendingReason)],
      !!resolution && ['Resolução', `<span style="white-space: pre-wrap;">${escapeHtml(resolution)}</span>`],
      !!forecast && ['Previsão de conclusão', `${escapeHtml(forecast)}<br>${muted('Se a previsão mudar, avisaremos você por aqui.')}`],
    ]) : '',
    replies.length ? section(repliesTitle) + replies.map(quote).join('') : '',
    attachments.length ? section(attachments.length === 1 ? 'Anexo' : `${attachments.length} anexos`)
      + attachments.map(a => p(`${escapeHtml(a.name)}${a.attached ? '' : ` ${muted('(disponível no chamado)')}`}`)).join('')
      + (onlyInTicket.length ? '' : small('Os arquivos estão anexados a este e-mail.')) : '',
    small(escapeHtml(replyHint(params.replyable))),
    button(escapeHtml(params.ticketUrl), 'Ver meu chamado'),
  ].join('\n                  ')

  const html = emailPage({ subject, heading: 'Atualização do seu chamado', body, footer: replyFooter(params.replyable) })

  return { subject, text, html }
}
