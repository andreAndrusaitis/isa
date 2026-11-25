import { EmailClient } from '@azure/communication-email'
import prisma from '../../config/prisma'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { isGraphConfigured, sendGraphMail } from './graph'
import { buildWelcomeUserTemplate } from './templates/welcomeUser'
import { buildSurveyInviteTemplate, SurveyEmailParams } from './templates/surveyInvite'
import { buildTicketUpdateTemplate, TicketUpdateEmailParams } from './templates/ticketUpdate'
import { buildTicketCreatedTemplate, TicketCreatedEmailParams } from './templates/ticketCreated'
import { buildAutoReplyTemplate, AutoReplyEmailParams } from './templates/autoReply'

export type EmailStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED_ACS_NOT_CONFIGURED'
export type EmailKind = 'welcome' | 'ticket_created' | 'ticket_update' | 'survey' | 'survey_resend' | 'auto_reply'

/** Arquivo anexado ao e-mail. contentBytes null: não coube/não foi lido — vai só o nome no corpo. */
export interface MailAttachment { name: string; contentType: string; contentBytes: string | null; size: number }

// O ACS aceita até 10 MB por e-mail no total (em base64): acima disso a reserva vai sem os arquivos.
const ACS_MAX_BASE64 = 9 * 1024 * 1024

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text: string
  kind: EmailKind
  ticketId?: string
  /** Número do chamado (vai no cabeçalho X-ISA-Ticket). */
  ticketNumber?: string
  /** HTML gravado no log quando o enviado tem segredo (ex.: senha inicial). */
  logHtml?: string
  /** Convida a responder (a resposta entra no chamado). Falso = só o corpo pede para não responder. */
  replyable?: boolean
  cc?: string[]
  attachments?: MailAttachment[]
}

interface DeliveryResult {
  status: EmailStatus
  error?: string
  provider?: 'graph' | 'acs'
  internetMessageId?: string | null
  conversationId?: string | null
}

export function isAcsConfigured(): boolean {
  return Boolean(env.AZURE_COMMUNICATION_CONNECTION_STRING)
}

// Todo envio passa por aqui e vira uma linha em email_logs (tela admin "Logs de E-mail").
async function sendEmail(params: SendEmailParams): Promise<{ status: EmailStatus; error?: string }> {
  const replyable = Boolean(params.replyable)
  const result = await deliver({ ...params, replyable })
  await prisma.emailLog
    .create({
      data: {
        kind: params.kind,
        recipient: params.to,
        subject: params.subject.slice(0, 500),
        status: result.status,
        error: result.error?.slice(0, 1000) ?? null,
        html: params.logHtml ?? params.html,
        ticket_id: params.ticketId ?? null,
        provider: result.provider ?? null,
        internet_message_id: result.internetMessageId ?? null,
        conversation_id: result.conversationId ?? null,
        replyable,
      },
    })
    .catch(err => logger.error('[Email] Falha ao gravar email_log.', { to: params.to, error: err instanceof Error ? err.message : String(err) }))
  return { status: result.status, error: result.error }
}

// Caixa de atendimento (Graph) primeiro; se ela falhar, o ACS entrega para o
// cliente não ficar sem o aviso (sem poder responder, mas com o link do chamado).
async function deliver(params: SendEmailParams): Promise<DeliveryResult> {
  let graphError: string | undefined
  if (isGraphConfigured()) {
    try {
      const sent = await sendGraphMail({
        to: params.to, cc: params.cc, subject: params.subject, html: params.html, ticketNumber: params.ticketNumber,
        attachments: attached(params.attachments),
      })
      logger.info('[Email] E-mail enviado pela caixa de atendimento.', { to: params.to, internetMessageId: sent.internetMessageId })
      return { status: 'SUCCESS', provider: 'graph', ...sent }
    } catch (err: unknown) {
      graphError = err instanceof Error ? err.message : String(err)
      logger.error('[Email] Falha ao enviar pela caixa de atendimento; tentando ACS.', { to: params.to, error: graphError })
    }
  }
  const acs = await deliverAcs(params)
  return graphError ? { ...acs, error: [`graph: ${graphError}`, acs.error].filter(Boolean).join(' | ') } : acs
}

async function deliverAcs(params: SendEmailParams): Promise<DeliveryResult> {
  if (!isAcsConfigured()) {
    logger.warn('[Email] AZURE_COMMUNICATION_CONNECTION_STRING não configurada. E-mail ignorado.', { to: params.to })
    return { status: 'SKIPPED_ACS_NOT_CONFIGURED' }
  }

  try {
    const client = new EmailClient(env.AZURE_COMMUNICATION_CONNECTION_STRING!)

    const files = attached(params.attachments)
    const base64Total = files.reduce((n, a) => n + a.contentBytes.length, 0)
    const message = {
      senderAddress: env.AZURE_EMAIL_SENDER,
      recipients: { to: [{ address: params.to }] },
      content: {
        subject: params.subject,
        plainText: params.text,
        html: params.html,
      },
      ...(files.length && base64Total <= ACS_MAX_BASE64
        ? { attachments: files.map(a => ({ name: a.name, contentType: a.contentType, contentInBase64: a.contentBytes })) }
        : {}),
    }

    const poller = await client.beginSend(message)
    const result = await poller.pollUntilDone()

    if (result.error) {
      logger.error('[Email] ACS retornou erro.', { to: params.to, error: result.error })
      return { status: 'FAILED', provider: 'acs', error: JSON.stringify(result.error) }
    }

    logger.info('[Email] E-mail enviado via ACS.', { to: params.to, messageId: result.id })
    return { status: 'SUCCESS', provider: 'acs' }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('[Email] Falha ao enviar e-mail via ACS.', { to: params.to, error: message })
    return { status: 'FAILED', provider: 'acs', error: message }
  }
}

const attached = (list?: MailAttachment[]) =>
  (list ?? []).filter((a): a is MailAttachment & { contentBytes: string } => Boolean(a.contentBytes))

// ── Funções públicas ──────────────────────────────────────────────────────────

interface SendWelcomeEmailParams {
  to: string
  name: string
  initialPassword?: string
  organizationName?: string | null
}

export async function sendWelcomeEmail(params: SendWelcomeEmailParams): Promise<{ status: EmailStatus; error?: string }> {
  const build = (initialPassword?: string) => buildWelcomeUserTemplate({
    name: params.name,
    email: params.to,
    portalUrl: env.PORTAL_URL,
    initialPassword,
    organizationName: params.organizationName,
  })
  const template = build(params.initialPassword)
  // A senha inicial nunca vai para o log: o admin vê o e-mail com ela mascarada.
  const logHtml = params.initialPassword ? build('••••••••').html : undefined

  return sendEmail({ to: params.to, subject: template.subject, html: template.html, text: template.text, kind: 'welcome', logHtml })
}

export async function sendSurveyEmail(
  params: SurveyEmailParams & { to: string; ticketId: string; resend?: boolean },
): Promise<{ status: EmailStatus; error?: string }> {
  const template = buildSurveyInviteTemplate(params)
  // O link responde como o cliente: nunca vai para o log, igual à senha do boas-vindas.
  const logHtml = template.html.split(params.linkSurvey).join(params.linkSurvey.replace(/[^/]+$/, '••••••••'))
  return sendEmail({
    to: params.to, subject: template.subject, html: template.html, text: template.text,
    kind: params.resend ? 'survey_resend' : 'survey', ticketId: params.ticketId, logHtml,
  })
}

// Link curto /c/<id>: abre o chamado na tela certa para qualquer cargo.
const ticketUrl = (ticketId: string) => `${env.PORTAL_URL.replace(/\/+$/, '')}/c/${encodeURIComponent(ticketId)}`

export async function sendTicketCreatedEmail(
  params: Omit<TicketCreatedEmailParams, 'ticketUrl'> & { to: string; ticketId: string },
): Promise<{ status: EmailStatus; error?: string }> {
  const template = buildTicketCreatedTemplate({ ...params, ticketUrl: ticketUrl(params.ticketId) })
  return sendEmail({
    to: params.to, subject: template.subject, html: template.html, text: template.text,
    kind: 'ticket_created', ticketId: params.ticketId, ticketNumber: params.ticketNumber, replyable: params.replyable,
  })
}

export async function sendTicketUpdateEmail(
  params: Omit<TicketUpdateEmailParams, 'ticketUrl' | 'attachments'> & { to: string; ticketId: string; cc?: string[]; attachments?: MailAttachment[] },
): Promise<{ status: EmailStatus; error?: string }> {
  const files = params.attachments ?? []
  const template = buildTicketUpdateTemplate({
    ...params,
    ticketUrl: ticketUrl(params.ticketId),
    attachments: files.map(a => ({ name: a.name, attached: Boolean(a.contentBytes) })),
  })
  return sendEmail({
    to: params.to, subject: template.subject, html: template.html, text: template.text,
    kind: 'ticket_update', ticketId: params.ticketId, ticketNumber: params.ticketNumber,
    replyable: params.replyable, cc: params.replyable ? params.cc : undefined,
    attachments: files,
  })
}

export async function sendAutoReplyEmail(
  params: Omit<AutoReplyEmailParams, 'ticketUrl'> & { to: string; ticketId: string },
): Promise<{ status: EmailStatus; error?: string }> {
  const template = buildAutoReplyTemplate({ ...params, ticketUrl: ticketUrl(params.ticketId) })
  return sendEmail({
    to: params.to, subject: template.subject, html: template.html, text: template.text,
    kind: 'auto_reply', ticketId: params.ticketId, ticketNumber: params.ticketNumber,
  })
}
