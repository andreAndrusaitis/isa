import { button, emailPage, escapeHtml, p, rows } from './layout'

export const WELCOME_SUBJECT = 'Bem-vindo ao portal ISA'

export interface WelcomeUserTemplateParams {
  name: string
  email: string
  portalUrl: string
  initialPassword?: string
  organizationName?: string | null
}

export function buildWelcomeUserTemplate(params: WelcomeUserTemplateParams) {
  const name = escapeHtml(params.name)
  const email = escapeHtml(params.email)
  const portalUrl = escapeHtml(params.portalUrl)
  const organization = params.organizationName ? escapeHtml(params.organizationName) : null
  const passwordText = params.initialPassword
    ? `Senha inicial: ${params.initialPassword}`
    : 'Use a senha inicial definida no cadastro ou solicite a redefinição ao administrador.'

  const subject = WELCOME_SUBJECT
  const text = [
    `Olá, ${params.name}.`,
    '',
    `Seu acesso ao portal ISA${organization ? ` da ${params.organizationName}` : ''} foi criado.`,
    '',
    `Portal: ${params.portalUrl}`,
    `Login: ${params.email}`,
    passwordText,
    '',
    'Acesse o portal para abrir, acompanhar e responder chamados.',
    '',
    'Equipe ISA',
  ].join('\n')

  const html = emailPage({
    subject,
    heading: 'Seu acesso foi criado',
    body: [
      p(`Olá, ${name}.`),
      p(`Seu acesso ao portal ISA${organization ? ` da <strong>${organization}</strong>` : ''} foi criado.`),
      rows([
        ['Portal', portalUrl],
        ['Login', email],
        ['Senha inicial', params.initialPassword ? escapeHtml(params.initialPassword) : 'Use a senha inicial definida no cadastro ou solicite a redefinição ao administrador.'],
      ]),
      p('Acesse o portal para abrir, acompanhar e responder chamados.'),
      button(portalUrl, 'Acessar o portal'),
    ].join('\n                  '),
    footer: 'Equipe ISA',
  })

  return { subject, text, html }
}
