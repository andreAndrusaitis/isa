import { renderTemplate, TemplateVars } from '../../templateVariables'
import { button, emailPage, escapeHtml, p, small } from './layout'

export interface SurveyEmailParams {
  vars: TemplateVars
  linkSurvey: string
  subjectTemplate: string
  bodyTemplate: string
}

export function buildSurveyInviteTemplate(params: SurveyEmailParams) {
  const linkSurvey = params.linkSurvey // URLs shouldn't be HTML-escaped inside href
  const vars = { ...params.vars, link_pesquisa: linkSurvey }

  // Mesma lista/função de variáveis das macros
  const subject = renderTemplate(params.subjectTemplate, vars)
  const text = renderTemplate(params.bodyTemplate, vars)

  // Cada linha vira parágrafo; a que traz o link vira o botão e o aviso de link único fica menor.
  const body = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      if (line.includes(linkSurvey) || line === '{link_pesquisa}') return button(linkSurvey, 'Responder pesquisa de satisfação')
      const lower = line.toLowerCase()
      return lower.includes('exclusivo') || lower.includes('uma única vez') ? small(escapeHtml(line)) : p(escapeHtml(line))
    })
    .join('\n                  ')

  const html = emailPage({
    subject,
    heading: 'Pesquisa de satisfação',
    body,
    footer: 'Este é um e-mail transacional enviado pelo sistema ISA.<br>Por favor, não responda diretamente a esta mensagem.',
  })

  return { subject, text, html }
}
