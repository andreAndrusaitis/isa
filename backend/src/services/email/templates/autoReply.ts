import { button, emailPage, escapeHtml, p } from './layout'

// Resposta automática a um e-mail do cliente que NÃO entrou no chamado.
// - reply_disabled: a empresa não tem resposta por e-mail liberada.
// - ticket_closed: o chamado está encerrado (ou passou do prazo de reabertura).
export type AutoReplyReason = 'reply_disabled' | 'ticket_closed'

export interface AutoReplyEmailParams {
  reason: AutoReplyReason
  clientName: string
  ticketNumber: string
  ticketTitle: string
  ticketUrl: string
}

const MESSAGES: Record<AutoReplyReason, { subject: string; lines: string[] }> = {
  reply_disabled: {
    subject: 'sua resposta por e-mail não foi registrada',
    lines: [
      'Recebemos o seu e-mail, mas as respostas a este chamado são feitas pelo portal do ISA.',
      'Para falar com o analista, acesse o chamado pelo botão abaixo e escreva a sua mensagem por lá.',
    ],
  },
  ticket_closed: {
    subject: 'chamado encerrado',
    lines: [
      'Recebemos o seu e-mail, mas este chamado já está encerrado e não pode mais ser reaberto.',
      'Se precisar de um novo atendimento, envie um novo e-mail (sem responder a este) para a nossa caixa de atendimento ou abra um chamado pelo portal.',
    ],
  },
}

export function buildAutoReplyTemplate(params: AutoReplyEmailParams) {
  const m = MESSAGES[params.reason]
  const subject = `Chamado [${params.ticketNumber}]: ${m.subject}`

  const text = [
    `Olá, ${params.clientName}!`,
    '',
    `Sobre o chamado ${params.ticketNumber} — ${params.ticketTitle}:`,
    ...m.lines,
    '',
    `Acesse o chamado: ${params.ticketUrl}`,
    '',
    'Esta é uma resposta automática. Não responda este e-mail.',
  ].join('\n')

  const html = emailPage({
    subject,
    heading: 'Resposta automática',
    body: [
      p(`Olá, ${escapeHtml(params.clientName)}!`),
      p(`Sobre o chamado <strong>${escapeHtml(params.ticketNumber)} — ${escapeHtml(params.ticketTitle)}</strong>:`),
      ...m.lines.map(l => p(escapeHtml(l))),
      button(escapeHtml(params.ticketUrl), 'Ver meu chamado'),
    ].join('\n                  '),
    footer: 'Esta é uma resposta automática do sistema ISA.<br>Por favor, não responda diretamente a esta mensagem.',
  })

  return { subject, text, html }
}
