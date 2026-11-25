import prisma from '../../config/prisma'
import { logger } from '../../utils/logger'
import { AppError } from '../../middlewares/errorHandler'
import { TicketService } from '../tickets'
import { getTicketAccess } from '../ticketAccess'
import { createTicketFromEmail, prepareAttachment } from '../externalApi'
import { sendAutoReplyEmail } from './mailer'
import { WELCOME_SUBJECT } from './templates/welcomeUser'
import type { AutoReplyReason } from './templates/autoReply'
import { blockedReason } from './blocklist'
import { buildTicketPayload, emitWebhookEvent } from '../webhookEvents'
import { blobEnabled } from '../../config/blob'
import { isBlobName, resolveAttachmentMime, signReadUrl, uploadDataUri } from '../uploads'
import {
  attachmentMime, ensureFolder, getMessageHtml, listAttachments, listInboxMessages, mailboxAddress, moveMessage, senderInlineImageSizes,
  FILE_ATTACHMENT, ITEM_ATTACHMENT, type GraphAddress, type GraphAttachment, type GraphMessage,
} from './graph'

// Caixa de atendimento → ISA: e-mail novo abre chamado e resposta entra no chamado.
// Cada mensagem da Caixa de Entrada termina numa das duas pastas abaixo; o que
// foi feito com ela fica em inbound_emails.

export const PROCESSED_FOLDER = 'ISA - Processados'
export const IGNORED_FOLDER = 'ISA - Não processados'
const STALE_CLAIM_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 3
const STAFF_ROLES = ['agent', 'supervisor', 'manager', 'admin']
// E-mails do ISA cuja resposta pode entrar no chamado (boas-vindas e pesquisa nunca).
const REPLYABLE_KINDS = ['ticket_created', 'ticket_update', 'auto_reply']

/**
 * reason: código estável do motivo quando o e-mail não abriu chamado (vai no
 * webhook email.not_opened) — ex.: sender_blocked, auto_reply, organization_inactive.
 */
type Outcome = {
  status: 'ticket_created' | 'message_added' | 'note_added' | 'ignored'
  detail: string
  ticketId?: string
  reason?: string
  created?: { organization: { id: string; name: string }; createdOrganization: boolean; createdUser: boolean }
  /** Chamado aberto (payload do webhook email.ticket_opened). */
  ticket?: Record<string, unknown>
}

// ── Classificação (funções puras, testadas isoladamente) ───────────────────────

export const address = (a?: GraphAddress) => (a?.emailAddress?.address ?? '').trim().toLowerCase()

export function header(msg: GraphMessage, name: string): string | undefined {
  return msg.internetMessageHeaders?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value
}

const AUTO_SUBJECT = /^(resposta autom[aá]tica|automatic reply|auto(matic)?[ -]?reply|out of office|fora do escrit[oó]rio|aus[eê]ncia tempor[aá]ria|undeliverable|n[aã]o (foi )?poss[ií]vel entregar|entrega (com falha|falhou)|delivery (status notification|has failed)|mail delivery failed)/i

/** Motivo para descartar sem nem procurar o chamado (loop, devolução, ausência). */
export function automatedReason(msg: GraphMessage, mailbox: string): string | null {
  return automatedCheck(msg, mailbox)?.detail ?? null
}

// Reconhecem resposta a e-mail que não aceita resposta quando os cabeçalhos da conversa se
// perderam. O prefixo saiu do assunto, mas os e-mails já enviados ainda podem ser respondidos.
const NO_REPLY_SUBJECTS = ['[Não responda]', WELCOME_SUBJECT]

function automatedCheck(msg: GraphMessage, mailbox: string): { reason: string; detail: string } | null {
  const from = address(msg.from)
  if (!from) return { reason: 'empty_sender', detail: 'remetente vazio' }
  if (from === mailbox) return { reason: 'own_mailbox', detail: 'enviado pela própria caixa de atendimento' }
  if (/^(mailer-daemon|postmaster|microsoftexchange)/i.test(from)) return { reason: 'delivery_failure', detail: 'aviso de não entrega' }
  if (/multipart\/report/i.test(header(msg, 'Content-Type') ?? '')) return { reason: 'delivery_failure', detail: 'aviso de não entrega' }
  if (AUTO_SUBJECT.test((msg.subject ?? '').trim())) return { reason: 'auto_reply', detail: 'resposta automática' }
  return null
}

/**
 * O remetente é quem diz ser? Vale o veredito do próprio Exchange (DMARC/compauth).
 * E-mail interno do mesmo tenant não traz o cabeçalho e já chega autenticado.
 */
export function senderAuthenticated(msg: GraphMessage): boolean {
  const results = (msg.internetMessageHeaders ?? []).filter(h => h.name.toLowerCase() === 'authentication-results').map(h => h.value)
  return results.length === 0 || /\b(dmarc|compauth)=pass\b/i.test(results[0])
}

export const isAutoSubmitted = (msg: GraphMessage) => {
  const v = header(msg, 'Auto-Submitted')
  return Boolean(v && v.trim().toLowerCase() !== 'no')
}

/** "[INC-11180]" (e-mails novos) ou "Chamado INC-11180" (e-mails antigos do ACS). */
export function ticketNumberFromSubject(subject?: string): string | null {
  const m = (subject ?? '').match(/\[([A-Z]{2,5}-\d{3,})\]|Chamado #?([A-Z]{2,5}-\d{3,})/i)
  return m ? (m[1] ?? m[2]).toUpperCase() : null
}

export function referencedMessageIds(msg: GraphMessage): string[] {
  const raw = [header(msg, 'In-Reply-To'), header(msg, 'References')].filter(Boolean).join(' ')
  return [...new Set(raw.match(/<[^>]+>/g) ?? [])]
}

const CID_RE = /\[cid:([^\]\s]+)\]/gi

/**
 * Texto novo da mensagem (sem o histórico citado); e-mail novo usa o corpo inteiro.
 * Imagem embutida (assinatura, logo) vira "[cid:...]" no texto do Outlook: sai daqui.
 */
export function messageText(msg: GraphMessage, reply: boolean): string {
  const raw = (reply ? msg.uniqueBody?.content : undefined)?.trim() || msg.body?.content?.trim() || ''
  return raw
    .replace(/\r\n/g, '\n')
    .replace(CID_RE, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20000)
}

const cidsIn = (text?: string) => new Set([...(text ?? '').matchAll(CID_RE)].map(m => m[1].toLowerCase()))
const cidOf = (a: GraphAttachment) => a.contentId?.replace(/^<|>$/g, '').toLowerCase()

/** Largura × altura de PNG, JPEG, GIF ou WebP (só o cabeçalho); null se não reconhecer. */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  try {
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    if (b.length > 10 && b.toString('latin1', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
    if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const kind = b.toString('latin1', 12, 16)
      if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
      if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
      if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 } }
    }
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue }
        const marker = b[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
        i += 2 + b.readUInt16BE(i + 2)
      }
    }
  } catch { /* cabeçalho truncado */ }
  return null
}

// Imagem embutida deste tamanho para cima é print colado no corpo, não assinatura:
// nos e-mails reais da caixa, assinaturas e logos ficam abaixo (ex.: 703×203, 465×229)
// e prints acima (884×480, 979×574, 469×359).
const CONTENT_IMAGE_MIN = { width: 300, height: 250 }

function isContentImage(a: GraphAttachment): boolean {
  if (!/^image\//i.test(a.contentType ?? '') || !a.contentBytes) return false
  const size = imageSize(Buffer.from(a.contentBytes.slice(0, 65536), 'base64'))
  return Boolean(size && size.width >= CONTENT_IMAGE_MIN.width && size.height >= CONTENT_IMAGE_MIN.height)
}

/**
 * Separa os anexos do e-mail: arquivos que entram no chamado, e-mails anexados
 * (viram .eml), o que não dá para importar (link de nuvem, arquivo sem conteúdo)
 * e as imagens embutidas com tamanho de print (inlineImages) — essas ainda passam
 * pela checagem de assinatura em emailAttachments. Na resposta, só conta a imagem
 * citada no texto novo: as do histórico citado já entraram antes. Logo e ícone
 * pequenos ficam de fora direto.
 */
export function sortAttachments(msg: GraphMessage, attachments: GraphAttachment[], reply = false) {
  const cited = cidsIn(`${msg.body?.content ?? ''}\n${msg.uniqueBody?.content ?? ''}`)
  const citedInNewText = cidsIn(msg.uniqueBody?.content)
  const files: GraphAttachment[] = []
  const emails: GraphAttachment[] = []
  const inlineImages: GraphAttachment[] = []
  const unsupported: string[] = []
  for (const a of attachments) {
    const cid = cidOf(a)
    const inline = a.isInline || Boolean(cid && cited.has(cid))
    if (a['@odata.type'] === FILE_ATTACHMENT) {
      if (inline) {
        const inThisMessage = !reply || Boolean(cid && citedInNewText.has(cid))
        if (inThisMessage && isContentImage(a)) inlineImages.push(a)
        continue
      }
      if (a.contentBytes) files.push(a)
      else unsupported.push(a.name)
    } else if (a['@odata.type'] === ITEM_ATTACHMENT && a.id) {
      emails.push(a)
    } else {
      unsupported.push(a.name)
    }
  }
  return { files, emails, inlineImages, unsupported }
}

// Blocos de assinatura que os clientes de e-mail marcam no HTML.
const SIGNATURE_DIV = /<div\b[^>]*(?:\bid="(?:x_)?Signature"|\bid="ms-outlook-mobile-signature"|\bclass="[^"]*\bgmail_signature\b[^"]*")[^>]*>/gi
// Outlook desktop marca só o início; vai até o histórico citado ou o fim do corpo.
const SIGNATURE_END = /id="(?:x_)?appendonsend"|id="(?:x_)?divRplyFwdMsg"|<hr\b|<\/body>/i

/** cids das imagens que estão dentro de um bloco de assinatura do HTML. */
export function signatureCids(html: string): Set<string> {
  const ranges: [number, number][] = []
  for (const m of html.matchAll(SIGNATURE_DIV)) {
    // Acha o </div> que fecha este bloco contando os <div> aninhados.
    const tag = /<div\b|<\/div>/gi
    tag.lastIndex = m.index! + m[0].length
    let depth = 1
    let end = html.length
    for (let t = tag.exec(html); t; t = tag.exec(html)) {
      depth += t[0].toLowerCase() === '</div>' ? -1 : 1
      if (depth === 0) { end = t.index; break }
    }
    ranges.push([m.index!, end])
  }
  const auto = html.search(/name="?_MailAutoSig/i)
  if (auto >= 0) {
    const rest = html.slice(auto).search(SIGNATURE_END)
    ranges.push([auto, rest >= 0 ? auto + rest : html.length])
  }
  const cids = new Set<string>()
  for (const [start, end] of ranges) {
    for (const c of html.slice(start, end).matchAll(/cid:([^"'\s>)]+)/gi)) cids.add(c[1].toLowerCase())
  }
  return cids
}

/** Mesmo tamanho (folga de 1%: o Outlook regrava a imagem a cada envio) de uma imagem já vista. */
const sameImageSize = (a: number, b: number) => Math.abs(a - b) <= Math.max(64, a * 0.01)
// Acima disso não é assinatura: as maiores vistas na caixa (banners) têm ~400 KB.
const SIGNATURE_MAX_BYTES = 500 * 1024

export interface EmailFile { name: string; contentType?: string; contentBytes: string }

// ── Processamento ──────────────────────────────────────────────────────────────

let running = false

/** Uma rodada: lê a Caixa de Entrada (a partir da virada) e trata cada mensagem. Não roda em paralelo no mesmo processo. */
export async function processInboundMailbox(since: Date): Promise<number> {
  if (running) return 0
  running = true
  try {
    const messages = await listInboxMessages(since, 25)
    for (const msg of messages) await processMessage(msg)
    return messages.length
  } finally {
    running = false
  }
}

export async function processMessage(msg: GraphMessage): Promise<void> {
  const claim = await claimMessage(msg)
  if (claim === 'busy') return
  if (claim !== 'claimed') return moveTo(msg.id, claim)

  try {
    const outcome = await handleMessage(msg)
    await prisma.inboundEmail.update({
      where: { graph_message_id: msg.id },
      data: { status: outcome.status, detail: outcome.detail.slice(0, 1000), ticket_id: outcome.ticketId ?? null, processed_at: new Date() },
    })
    logger.info('[Email:entrada] Mensagem tratada.', { from: address(msg.from), status: outcome.status, detail: outcome.detail, ticketId: outcome.ticketId })
    await moveTo(msg.id, outcome.status)
    await notifyWebhooks(msg, outcome)
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    logger.error('[Email:entrada] Falha ao tratar mensagem; nova tentativa em alguns minutos.', { id: msg.id, error: detail })
    await prisma.inboundEmail.update({ where: { graph_message_id: msg.id }, data: { status: 'failed', detail: detail.slice(0, 1000) } }).catch(() => {})
  }
}

// A linha em inbound_emails é a trava: o graph_message_id é único, então só uma
// das instâncias do backend processa cada mensagem. Linha parada em processing/
// failed por mais de 10 min volta a ser tentada (até 3 vezes).
async function claimMessage(msg: GraphMessage): Promise<'claimed' | 'busy' | string> {
  // Consulta antes para não gerar erro de chave duplicada no log a cada rodada.
  const existing = await prisma.inboundEmail.findUnique({ where: { graph_message_id: msg.id }, select: { id: true } })
  if (!existing) try {
    await prisma.inboundEmail.create({
      data: {
        graph_message_id: msg.id,
        internet_message_id: msg.internetMessageId ?? null,
        from_email: address(msg.from) || '(vazio)',
        from_name: msg.from?.emailAddress?.name ?? null,
        subject: (msg.subject ?? '').slice(0, 500),
        received_at: new Date(msg.receivedDateTime),
      },
    })
    return 'claimed'
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err
  }

  const row = await prisma.inboundEmail.findUnique({ where: { graph_message_id: msg.id } })
  if (!row) return 'busy'
  // Já tratada, mas ficou na Caixa de Entrada (a movimentação falhou): só move.
  if (!['processing', 'failed'].includes(row.status)) return row.status
  if (Date.now() - row.claimed_at.getTime() < STALE_CLAIM_MS) return 'busy'
  if (row.attempts >= MAX_ATTEMPTS) {
    const detail = `Falhou ${row.attempts} vezes: ${row.detail ?? ''}`.slice(0, 1000)
    await prisma.inboundEmail.update({ where: { id: row.id }, data: { status: 'ignored', detail, processed_at: new Date() } })
    await notifyWebhooks(msg, { status: 'ignored', reason: 'processing_failed', detail })
    return 'ignored'
  }
  const retaken = await prisma.inboundEmail.updateMany({
    where: { id: row.id, claimed_at: row.claimed_at },
    data: { status: 'processing', claimed_at: new Date(), attempts: { increment: 1 } },
  })
  return retaken.count === 1 ? 'claimed' : 'busy'
}

async function moveTo(messageId: string, status: string) {
  const folder = status === 'ignored' ? IGNORED_FOLDER : PROCESSED_FOLDER
  try {
    await moveMessage(messageId, await ensureFolder(folder))
  } catch (err: unknown) {
    logger.error('[Email:entrada] Não consegui mover a mensagem; tento de novo na próxima rodada.', { messageId, error: err instanceof Error ? err.message : String(err) })
  }
}

async function handleMessage(msg: GraphMessage): Promise<Outcome> {
  const automated = automatedCheck(msg, mailboxAddress())
  if (automated) return { status: 'ignored', ...automated }
  // Remetente bloqueado em Admin → E-mail → Bloqueios: nem abre chamado nem entra como resposta.
  const blocked = await blockedReason(address(msg.from))
  if (blocked) return { status: 'ignored', reason: 'sender_blocked', detail: blocked }

  const ref = await findReference(msg)
  if (ref.kind === 'none') {
    // E-mail que não aceita resposta nunca vira chamado, mesmo sem achar o original.
    if (NO_REPLY_SUBJECTS.some(s => (msg.subject ?? '').includes(s))) return { status: 'ignored', reason: 'no_reply_email', detail: 'resposta a e-mail que não aceita resposta, sem chamado identificado' }
    return createTicket(msg)
  }
  if (ref.kind === 'no_ticket') return { status: 'ignored', reason: 'reply_without_ticket', detail: ref.detail }
  if (isAutoSubmitted(msg)) return { status: 'ignored', reason: 'auto_reply', detail: 'resposta automática ao e-mail do chamado', ticketId: ref.ticketId }
  return handleReply(msg, ref.ticketId, ref.logKind)
}

type Reference =
  | { kind: 'none' }
  | { kind: 'no_ticket'; detail: string }
  | { kind: 'ticket'; ticketId: string; logKind: string | null }

// Ordem: cabeçalhos da conversa (Message-ID que enviamos) → conversa do Graph →
// número do chamado no assunto.
async function findReference(msg: GraphMessage): Promise<Reference> {
  const ids = referencedMessageIds(msg)
  let log = ids.length
    ? await prisma.emailLog.findFirst({ where: { internet_message_id: { in: ids } }, orderBy: { created_at: 'desc' } })
    : null
  if (!log && msg.conversationId) {
    log = await prisma.emailLog.findFirst({ where: { conversation_id: msg.conversationId }, orderBy: { created_at: 'desc' } })
  }
  if (log && !log.ticket_id) return { kind: 'no_ticket', detail: `resposta a e-mail sem chamado (${log.kind})` }
  if (log?.ticket_id) return { kind: 'ticket', ticketId: log.ticket_id, logKind: log.kind }

  const number = ticketNumberFromSubject(msg.subject)
  if (!number) return { kind: 'none' }
  const ticket = await prisma.ticket.findFirst({ where: { display_number: number }, select: { id: true } })
  if (!ticket) return { kind: 'no_ticket', detail: `chamado ${number} do assunto não existe` }
  return { kind: 'ticket', ticketId: ticket.id, logKind: null }
}

async function createTicket(msg: GraphMessage): Promise<Outcome> {
  try {
    const { files, notImported } = await emailAttachments(msg, false)
    const { ticket, ...created } = await createTicketFromEmail({
      fromEmail: address(msg.from),
      fromName: msg.from?.emailAddress?.name,
      subject: msg.subject ?? '',
      text: messageText(msg, false),
      attachments: files,
      notImported,
    })
    const extra = [created.createdOrganization && `empresa ${created.organization.name} criada`, created.createdUser && 'usuário criado'].filter(Boolean)
    return {
      status: 'ticket_created',
      detail: `chamado ${ticket?.displayNumber ?? ticket?.id} aberto${extra.length ? ` (${extra.join(', ')})` : ''}`,
      ticketId: ticket?.id,
      created,
      ticket: buildTicketPayload(ticket),
    }
  } catch (err: unknown) {
    // Recusas de regra (solicitante inativo, empresa inativa etc.): não abre chamado.
    if (err instanceof AppError && ['API_ORG_NOT_FOUND', 'ORGANIZATION_INACTIVE', 'REQUESTER_INACTIVE', 'REQUESTER_EMAIL_INVALID', 'SENDER_BLOCKED'].includes(err.code ?? '')) {
      return { status: 'ignored', reason: err.code!.toLowerCase(), detail: err.message }
    }
    throw err
  }
}

// Link de leitura dos anexos no webhook: cobre as novas tentativas de entrega (~15h).
const WEBHOOK_LINK_TTL_MINUTES = 24 * 60

interface WebhookEmailAttachment { id: string; filename: string; content_type: string; url: string }

const webhookUrl = (blobName: string) => (blobEnabled && isBlobName(blobName) ? signReadUrl(blobName, WEBHOOK_LINK_TTL_MINUTES) : blobName)

/** Anexos já gravados no chamado aberto pelo e-mail. */
async function ticketAttachmentsForWebhook(ticketId: string): Promise<WebhookEmailAttachment[]> {
  const rows = await prisma.ticketAttachment.findMany({ where: { ticket_id: ticketId }, select: { id: true, name: true, url: true }, orderBy: { created_at: 'asc' } })
  return rows.map(r => ({ id: r.id, filename: r.name, content_type: resolveAttachmentMime(r.name) ?? 'application/octet-stream', url: webhookUrl(r.url) }))
}

/**
 * E-mail que não abriu chamado não tem anexo guardado: sobe ao blob (pasta
 * inbound-emails/) só para o webhook entregar o link. Mesmas regras do chamado
 * (tipos permitidos, 10 MB, assinatura de fora); sem blob, sai sem anexos.
 */
async function uploadAttachmentsForWebhook(msg: GraphMessage): Promise<WebhookEmailAttachment[]> {
  if (!blobEnabled) return []
  const { files } = await emailAttachments(msg, false)
  const out: WebhookEmailAttachment[] = []
  for (const f of files) {
    try {
      const p = prepareAttachment({ name: f.name, content_bytes: f.contentBytes, content_type: f.contentType } as any)
      const blob = await uploadDataUri(`data:${p.mime};base64,${p.base64}`, 'inbound-emails')
      out.push({ id: blob, filename: p.name, content_type: p.mime, url: webhookUrl(blob) })
    } catch { /* tipo não permitido / grande demais: fica de fora, como no chamado */ }
  }
  return out
}

const hasSubscribers = (event: string) => prisma.webhookEndpoint.count({ where: { active: true, events: { has: event } } }).then(n => n > 0)

// email.ticket_opened / email.not_opened: resposta que entrou no chamado (ou virou
// nota) não dispara nenhum dos dois — já tem os eventos de mensagem do chamado.
// Falha aqui não volta para o processamento: o e-mail já foi tratado e movido.
async function notifyWebhooks(msg: GraphMessage, outcome: Pick<Outcome, 'status' | 'detail' | 'reason' | 'ticketId' | 'created' | 'ticket'>) {
  try {
    const event = outcome.status === 'ticket_created' && outcome.ticketId ? 'email.ticket_opened'
      : outcome.status === 'ignored' ? 'email.not_opened' : null
    if (!event || !(await hasSubscribers(event))) return
    const email = {
      id: msg.id,
      from_email: address(msg.from),
      from_name: msg.from?.emailAddress?.name || null,
      subject: msg.subject ?? '',
      received_at: msg.receivedDateTime,
      body_text: messageText(msg, false),
      attachments: event === 'email.ticket_opened' ? await ticketAttachmentsForWebhook(outcome.ticketId!) : await uploadAttachmentsForWebhook(msg),
    }
    emitEmailWebhook(event, email, outcome)
  } catch (err) {
    logger.error('[Email:entrada] Webhook de e-mail não emitido.', { id: msg.id, error: err instanceof Error ? err.message : String(err) })
  }
}

function emitEmailWebhook(event: 'email.ticket_opened' | 'email.not_opened', email: Record<string, unknown>, outcome: Pick<Outcome, 'status' | 'detail' | 'reason' | 'ticketId' | 'created' | 'ticket'>) {
  if (event === 'email.ticket_opened') {
    emitWebhookEvent('email.ticket_opened', {
      email,
      ticket: outcome.ticket ?? { id: outcome.ticketId },
      organization: outcome.created?.organization ?? null,
      created_organization: outcome.created?.createdOrganization ?? false,
      created_user: outcome.created?.createdUser ?? false,
    })
  } else {
    emitWebhookEvent('email.not_opened', {
      email,
      status: outcome.status,
      reason: outcome.reason ?? 'other',
      detail: outcome.detail,
      ticket_id: outcome.ticketId ?? null,
    })
  }
}

async function handleReply(msg: GraphMessage, ticketId: string, logKind: string | null): Promise<Outcome> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { user: { select: { email: true, name: true } }, org: { select: { email_reply_enabled: true } } },
  })
  if (!ticket || ticket.deleted_at) return { status: 'ignored', reason: 'ticket_deleted', detail: 'chamado excluído', ticketId }

  const from = address(msg.from)
  const fromName = msg.from?.emailAddress?.name || from
  const sender = await prisma.user.findFirst({
    where: { email: { equals: from, mode: 'insensitive' }, deleted_at: null, active: true },
    select: { id: true, role: true, org_id: true },
  })
  const text = messageText(msg, true)
  const { files: attachments, notImported } = await emailAttachments(msg, true)
  const allowed = Boolean(ticket.org?.email_reply_enabled) && (logKind === null || REPLYABLE_KINDS.includes(logKind))
  const encerrado = ticket.status === 'closed' || (ticket.status === 'resolved' && await TicketService.reopenWindowExpired(ticket))

  const note = async (why: string) => {
    const names = [...attachments.map(a => a.name), ...notImported]
    await TicketService.addMessage(ticket.id, 'system', [
      `**E-mail recebido** de ${fromName} <${from}> — ${why}`,
      '',
      text || '(sem texto)',
      names.length ? `\nAnexos não importados: ${names.join(', ')}` : '',
    ].join('\n'), 'internal')
  }

  // Analista respondendo pelo Outlook (estava em cópia): vira resposta do analista.
  // Mesma regra do portal: quem não enxerga o chamado (e o admin, só leitura) não
  // responde por ele. Quem só chega ao chamado por tê-lo aberto segue como cliente.
  if (sender && STAFF_ROLES.includes(sender.role)) {
    const access = await getTicketAccess(ticket, { sub: sender.id, role: sender.role })
    if (sender.role === 'admin' || !access.allowed) {
      await note('remetente da equipe sem acesso para responder este chamado; não entrou como resposta')
      return { status: 'note_added', reason: 'staff_no_access', detail: 'remetente da equipe sem acesso ao chamado', ticketId: ticket.id }
    }
    if (access.via !== 'requester') {
      // Só com o número no assunto, ou sem prova do remetente, não fala em nome do analista.
      if (logKind === null || !senderAuthenticated(msg)) {
        await note('remetente da equipe não confirmado; não entrou como resposta')
        return { status: 'note_added', reason: 'staff_unverified', detail: 'remetente da equipe não confirmado', ticketId: ticket.id }
      }
      if (!allowed || encerrado || ticket.status === 'resolved') {
        await note(!allowed ? 'resposta por e-mail desabilitada; não enviada ao cliente pelo ISA' : 'chamado resolvido/encerrado; registrada só como nota')
        return { status: 'note_added', detail: 'e-mail de analista registrado como nota interna', ticketId: ticket.id }
      }
      // O cliente já recebeu pelo Outlook se estava no Para/Cc: o ISA não reenvia.
      const recipients = [...(msg.toRecipients ?? []), ...(msg.ccRecipients ?? [])].map(address)
      const clientCopied = Boolean(ticket.user?.email && recipients.includes(ticket.user.email.toLowerCase()))
      await addMessageWithAttachments(ticket.id, sender.id, text, 'agent', attachments, notImported, { skipRequesterEmail: clientCopied })
      return { status: 'message_added', detail: `resposta do analista por e-mail${clientCopied ? ' (cliente já em cópia)' : ''}`, ticketId: ticket.id }
    }
  }

  // Colega da empresa entra só se está na conversa (respondeu a um e-mail do chamado).
  // Só com o número no assunto (logKind null) não vira resposta nem recebe o título.
  const clientSide = sender && (ticket.user_id === sender.id || (logKind !== null && sender.org_id && sender.org_id === ticket.org_id))
  if (!clientSide) {
    await note('remetente sem vínculo com o chamado; não entrou como resposta')
    return { status: 'note_added', detail: 'remetente sem vínculo com o chamado', ticketId: ticket.id }
  }

  if (!allowed) {
    await note('resposta por e-mail desabilitada para a empresa; o cliente recebeu o link do chamado')
    await autoReply(ticket, from, fromName, 'reply_disabled')
    return { status: 'note_added', detail: 'resposta por e-mail desabilitada', ticketId: ticket.id }
  }
  if (encerrado) {
    await note('chamado encerrado ou fora do prazo de reabertura; não foi reaberto')
    await autoReply(ticket, from, fromName, 'ticket_closed')
    return { status: 'note_added', detail: 'chamado encerrado / fora do prazo de reabertura', ticketId: ticket.id }
  }

  await addMessageWithAttachments(ticket.id, sender!.id, text, 'user', attachments, notImported)
  return { status: 'message_added', detail: 'resposta do cliente por e-mail', ticketId: ticket.id }
}

// Mesmo formato da API (createTicketMessage): 1º anexo na mensagem, os demais em seguida.
async function addMessageWithAttachments(ticketId: string, userId: string, text: string, type: 'user' | 'agent', attachments: EmailFile[], notImported: string[], opts: { skipRequesterEmail?: boolean } = {}) {
  const valid: { name: string; dataUri: string }[] = []
  const skipped: string[] = [...notImported]
  for (const a of attachments) {
    try {
      const p = prepareAttachment({ name: a.name, content_bytes: a.contentBytes, content_type: a.contentType } as any)
      valid.push({ name: p.name, dataUri: `data:${p.mime};base64,${p.base64}` })
    } catch { skipped.push(a.name) }
  }
  const body = [
    text || (valid.length ? '(anexo enviado por e-mail)' : '(e-mail sem texto)'),
    skipped.length ? `\n\n[Anexos não importados (tipo, tamanho ou formato não suportado): ${skipped.join(', ')}]` : '',
  ].join('')
  const [first, ...rest] = valid
  await TicketService.addMessage(ticketId, userId, body, type, first?.dataUri, undefined, false, opts)
  for (const extra of rest) {
    await TicketService.addMessage(ticketId, userId, `Anexo adicional: ${extra.name}`, type, extra.dataUri, undefined, false, opts)
  }
}

/** Anexos que entram no chamado (e-mail anexado vira .eml) e os nomes dos que ficaram de fora. */
async function emailAttachments(msg: GraphMessage, reply: boolean): Promise<{ files: EmailFile[]; notImported: string[] }> {
  // hasAttachments não conta imagem embutida: print colado no corpo só aparece como [cid:].
  const hasInline = /\[cid:[^\]\s]+\]/i.test(`${msg.body?.content ?? ''}\n${msg.uniqueBody?.content ?? ''}`)
  if (!msg.hasAttachments && !hasInline) return { files: [], notImported: [] }
  const { files, emails, inlineImages, unsupported } = sortAttachments(msg, await listAttachments(msg.id), reply)
  files.push(...await pastedImages(msg, inlineImages))
  const result: EmailFile[] = files.map(a => ({ name: a.name, contentType: a.contentType, contentBytes: a.contentBytes! }))
  for (const e of emails) {
    try {
      const mime = await attachmentMime(msg.id, e.id!)
      const base = (e.name || 'email-anexado').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 150)
      result.push({ name: `${base}.eml`, contentType: 'message/rfc822', contentBytes: mime.toString('base64') })
    } catch (err) {
      logger.warn('[InboundMail] E-mail anexado não baixado.', { messageId: msg.id, error: err instanceof Error ? err.message : String(err) })
      unsupported.push(e.name)
    }
  }
  return { files: result, notImported: unsupported }
}

/**
 * Das imagens embutidas com tamanho de print, quais são print colado e quais são
 * assinatura. Fora do bloco de assinatura (ou maior que 500 KB): print. Dentro: assinatura se a mesma
 * imagem (tamanho) já veio em e-mails anteriores do remetente, ou se não há
 * nenhum e-mail anterior para comparar; senão é print colado na área da assinatura.
 */
async function pastedImages(msg: GraphMessage, images: GraphAttachment[]): Promise<GraphAttachment[]> {
  if (!images.length) return []
  let signature = new Set<string>()
  try { signature = signatureCids(await getMessageHtml(msg.id)) } catch (err) {
    logger.warn('[InboundMail] HTML do e-mail não lido; imagens embutidas entram como anexo.', { messageId: msg.id, error: err instanceof Error ? err.message : String(err) })
  }
  let history: { messages: number; sizes: number[] } | null | undefined
  const pasted: GraphAttachment[] = []
  for (const img of images) {
    const cid = cidOf(img)
    if (!cid || !signature.has(cid) || (img.size ?? 0) > SIGNATURE_MAX_BYTES) { pasted.push(img); continue }
    if (history === undefined) history = await senderInlineImageSizes(address(msg.from), msg.receivedDateTime).catch(() => null)
    const repeated = history?.sizes.some(s => sameImageSize(img.size ?? 0, s))
    if (history && history.messages > 0 && !repeated) pasted.push(img)
  }
  return pasted
}

// No máximo uma resposta automática por chamado e destinatário a cada 24h:
// evita loop com respostas automáticas do outro lado.
async function autoReply(ticket: { id: string; display_number: string; title: string }, to: string, name: string, reason: AutoReplyReason) {
  const recent = await prisma.emailLog.findFirst({
    where: { kind: 'auto_reply', ticket_id: ticket.id, recipient: to, created_at: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
    select: { id: true },
  })
  if (recent) return
  await sendAutoReplyEmail({ to, ticketId: ticket.id, reason, clientName: name, ticketNumber: ticket.display_number, ticketTitle: ticket.title })
}
