import prisma from '../../config/prisma'
import { logger } from '../../utils/logger'
import { readStoredAttachment } from '../uploads'
import type { MailAttachment } from './mailer'

export type RequesterUpdate =
  // attachment: anexo da mensagem como está no banco (nome do blob ou data URI).
  | { kind: 'reply'; text: string; attachment?: string | null }
  | { kind: 'status'; from: string; to: string }
  // Nova previsão do chamado em projeto (prazo da task, ISO).
  | { kind: 'forecast'; to: string }

// Agrupa as atualizações do mesmo chamado numa janela curta: uma ação do analista
// (resposta + anexos + mudança de status) vira UM e-mail para o solicitante.
// Cada nova atualização reinicia a janela.
// Buffer em memória — com várias instâncias do App Service a mesma ação
// pode cair em instâncias diferentes (2 e-mails), e um restart dentro da janela
// perde o envio; mover para uma tabela/fila se isso passar a importar.
export const DIGEST_WINDOW_MS = 15_000
const pending = new Map<string, { updates: RequesterUpdate[]; timer: NodeJS.Timeout }>()

export function queueRequesterUpdate(ticketId: string, update: RequesterUpdate) {
  const entry = pending.get(ticketId)
  if (entry) clearTimeout(entry.timer)
  const updates = [...(entry?.updates ?? []), update]
  const timer = setTimeout(() => {
    pending.delete(ticketId)
    flushRequesterUpdates(ticketId, updates).catch(err =>
      logger.error('[Email] Falha ao enviar atualização do chamado.', { ticketId, error: err instanceof Error ? err.message : String(err) }),
    )
  }, DIGEST_WINDOW_MS)
  timer.unref()
  pending.set(ticketId, { updates, timer })
}

// Mensagem extra que o portal cria para cada arquivo além do primeiro.
const ADDITIONAL_RE = /^Anexo adicional: (.+)$/

// Várias mudanças de status viram uma só: do primeiro "de" ao último "para".
// Se voltou ao mesmo status, não há mudança a relatar.
export function summarizeUpdates(updates: RequesterUpdate[]) {
  const statuses = updates.flatMap(u => (u.kind === 'status' ? [u] : []))
  const first = statuses[0]
  const last = statuses[statuses.length - 1]
  return {
    status: first && first.from !== last.to ? { from: first.from, to: last.to } : null,
    // "Anexo adicional: x" é só o arquivo extra da mesma resposta: vai na lista de anexos.
    replies: updates.flatMap(u => (u.kind === 'reply' && !(u.attachment && ADDITIONAL_RE.test(u.text)) ? [u.text] : [])),
    attachments: updates.flatMap(u => (u.kind === 'reply' && u.attachment
      ? [{ value: u.attachment, name: ADDITIONAL_RE.exec(u.text)?.[1]?.trim() || null }]
      : [])),
    forecast: updates.flatMap(u => (u.kind === 'forecast' ? [u.to] : [])).pop() ?? null,
  }
}

async function flushRequesterUpdates(ticketId: string, updates: RequesterUpdate[]) {
  const { status, replies, forecast, attachments } = summarizeUpdates(updates)
  if (!status && replies.length === 0 && !forecast && attachments.length === 0) return

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { user: true, org: { select: { email_reply_enabled: true } }, assigned_to: { select: { email: true, active: true } } },
  })
  const requester = ticket?.user
  if (!ticket || ticket.deleted_at || !requester?.email || requester.deleted_at || !requester.active) return

  // Resposta por e-mail liberada: o analista vai em cópia para acompanhar a conversa.
  const replyable = Boolean(ticket.org?.email_reply_enabled)
  const analyst = ticket.assigned_to?.active && ticket.assigned_to.email
  const cc = replyable && analyst && analyst.toLowerCase() !== requester.email.toLowerCase() ? [analyst] : undefined

  const files = await loadAttachments(ticket.display_number, attachments)
  const { sendTicketUpdateEmail } = await import('./mailer')
  await sendTicketUpdateEmail({
    attachments: files,
    replyable,
    cc,
    to: requester.email,
    ticketId: ticket.id,
    clientName: requester.name,
    ticketNumber: ticket.display_number,
    ticketTitle: ticket.title,
    status,
    replies,
    forecast,
    pendingReason: ticket.pending_reason,
    resolutionDetails: ticket.resolution_details,
  })
}

// Total anexado num e-mail (bytes do arquivo; em base64 cresce ~1/3): fica abaixo
// do limite de 35 MB do Exchange e do que a maioria dos servidores aceita receber.
export const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024

/**
 * Lê do blob os anexos das respostas. O que não couber no limite do e-mail (ou não
 * puder ser lido) vai só pelo nome, com o link do chamado.
 */
async function loadAttachments(ticketNumber: string, list: { value: string; name: string | null }[]): Promise<MailAttachment[]> {
  const out: MailAttachment[] = []
  let total = 0
  for (const [i, a] of list.entries()) {
    const fallbackName = `${ticketNumber}-anexo-${i + 1}`
    try {
      const file = await readStoredAttachment(a.value)
      const name = a.name || `${fallbackName}.${file?.ext ?? 'bin'}`
      if (!file || total + file.buffer.length > MAX_EMAIL_ATTACHMENT_BYTES) {
        out.push({ name, contentType: file?.mime ?? 'application/octet-stream', contentBytes: null, size: file?.buffer.length ?? 0 })
        continue
      }
      total += file.buffer.length
      out.push({ name, contentType: file.mime, contentBytes: file.buffer.toString('base64'), size: file.buffer.length })
    } catch (err) {
      logger.warn('[Email] Anexo da resposta não lido; vai só o nome no e-mail.', { ticketNumber, error: err instanceof Error ? err.message : String(err) })
      out.push({ name: a.name || fallbackName, contentType: 'application/octet-stream', contentBytes: null, size: 0 })
    }
  }
  return out
}
