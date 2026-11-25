import { createHash, createPrivateKey, randomUUID, sign, X509Certificate } from 'node:crypto'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'

// Cliente mínimo do Microsoft Graph para a caixa de atendimento (app-only com
// certificado). O app só enxerga essa caixa: a restrição é feita no Exchange
// (RBAC for Applications), não aqui.

export function isGraphConfigured(): boolean {
  return Boolean(
    env.MAIL_GRAPH_TENANT_ID && env.MAIL_GRAPH_CLIENT_ID && env.MAIL_GRAPH_CERT &&
    env.MAIL_GRAPH_PRIVATE_KEY && env.MAIL_GRAPH_MAILBOX,
  )
}

export function mailboxAddress(): string {
  return (env.MAIL_GRAPH_MAILBOX ?? '').toLowerCase()
}

// App settings do Azure guardam o PEM numa linha só, às vezes com "\n" literal. Só o
// trecho entre BEGIN/END conta: o openssl põe "Bag Attributes"/subject antes do bloco.
function normalizePem(pem: string, label: string): string {
  const text = pem.replace(/\\n/g, '\n')
  const block = text.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`))
  const body = (block ? block[1] : text).replace(/\s/g, '')
  return `-----BEGIN ${label}-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`
}

// Client assertion (private_key_jwt): o Entra ID identifica o certificado pelo
// x5t (SHA-1 do DER), como no SSO (services/oidc.ts).
export function buildClientAssertion(input: { tenantId: string; clientId: string; certPem: string; keyPem: string; now?: number }): string {
  const der = Buffer.from(normalizePem(input.certPem, 'CERTIFICATE').replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ''), 'base64')
  const x5t = createHash('sha1').update(der).digest('base64url')
  const now = Math.floor((input.now ?? Date.now()) / 1000)
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT', x5t })}.${b64({
    aud: `https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/token`,
    iss: input.clientId,
    sub: input.clientId,
    jti: randomUUID(),
    nbf: now,
    iat: now,
    exp: now + 600,
  })}`
  const key = createPrivateKey(normalizePem(input.keyPem, 'PRIVATE KEY'))
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 120_000) return cachedToken.value
  const tenantId = env.MAIL_GRAPH_TENANT_ID!
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.MAIL_GRAPH_CLIENT_ID!,
      scope: 'https://graph.microsoft.com/.default',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: buildClientAssertion({
        tenantId, clientId: env.MAIL_GRAPH_CLIENT_ID!, certPem: env.MAIL_GRAPH_CERT!, keyPem: env.MAIL_GRAPH_PRIVATE_KEY!,
      }),
    }),
  })
  const body = await res.json().catch(() => ({})) as any
  if (!res.ok || !body.access_token) {
    throw new Error(`Graph token: ${res.status} ${body.error ?? ''} ${String(body.error_description ?? '').split('\r\n')[0]}`.trim())
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 }
  return cachedToken.value
}

/** Só para os testes: o token fica em cache no módulo. */
export function resetGraphTokenCache() {
  cachedToken = null
}

// ImmutableId: o id da mensagem não muda quando ela é movida de pasta.
async function graph<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const res = await send(method, path, body, extraHeaders)
  if (res.status === 202 || res.status === 204) return undefined as T
  const json = await res.json().catch(() => ({})) as any
  if (!res.ok) throw new Error(`Graph ${method} ${path.split('?')[0]}: ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`.trim())
  return json as T
}

async function send(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxAddress())}${path}`
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        Prefer: 'IdType="ImmutableId"',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    // Limite de taxa / indisponibilidade: espera o Retry-After e tenta de novo.
    if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
      const wait = Math.min(Number(res.headers.get('retry-after') ?? attempt * 2), 30) * 1000
      logger.warn('[Graph] Limite/indisponível, tentando de novo.', { status: res.status, attempt, wait })
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    return res
  }
}

export interface OutgoingMail {
  to: string
  cc?: string[]
  subject: string
  html: string
  /** Número do chamado: vai num cabeçalho próprio para reconhecer a resposta. */
  ticketNumber?: string
  attachments?: { name: string; contentType: string; contentBytes: string; size: number }[]
}

// Anexo até 3 MB vai junto com o rascunho; acima, pela sessão de upload do Graph
// (pedaços múltiplos de 320 KiB). https://learn.microsoft.com/graph/outlook-large-attachments
const SMALL_ATTACHMENT_BYTES = 3 * 1024 * 1024
const UPLOAD_CHUNK_BYTES = 320 * 1024 * 10

async function addDraftAttachment(draftId: string, a: NonNullable<OutgoingMail['attachments']>[number]) {
  const path = `/messages/${encodeURIComponent(draftId)}/attachments`
  if (a.size < SMALL_ATTACHMENT_BYTES) {
    await graph('POST', path, { '@odata.type': FILE_ATTACHMENT, name: a.name, contentType: a.contentType, contentBytes: a.contentBytes })
    return
  }
  const bytes = Buffer.from(a.contentBytes, 'base64')
  const session = await graph<{ uploadUrl: string }>('POST', `${path}/createUploadSession`, {
    AttachmentItem: { attachmentType: 'file', name: a.name, size: bytes.length, contentType: a.contentType },
  })
  // A URL da sessão já é autorizada: não leva o token.
  for (let start = 0; start < bytes.length; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, bytes.length)
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}`, 'Content-Type': 'application/octet-stream' },
      body: bytes.subarray(start, end),
    })
    if (!res.ok) throw new Error(`Graph upload do anexo ${a.name}: ${res.status}`)
  }
}

/**
 * Cria o rascunho e envia: assim temos o Message-ID e a conversa do e-mail
 * enviado (o /sendMail não devolve nada), que ligam a resposta do cliente ao chamado.
 */
export async function sendGraphMail(mail: OutgoingMail): Promise<{ internetMessageId: string | null; conversationId: string | null }> {
  const draft = await graph<{ id: string; internetMessageId?: string; conversationId?: string }>('POST', '/messages', {
    subject: mail.subject,
    body: { contentType: 'HTML', content: mail.html },
    toRecipients: [{ emailAddress: { address: mail.to } }],
    ccRecipients: (mail.cc ?? []).map(address => ({ emailAddress: { address } })),
    ...(mail.ticketNumber ? { internetMessageHeaders: [{ name: 'X-ISA-Ticket', value: mail.ticketNumber }] } : {}),
  })
  try {
    for (const a of mail.attachments ?? []) await addDraftAttachment(draft.id, a)
    await graph('POST', `/messages/${encodeURIComponent(draft.id)}/send`)
  } catch (err) {
    // Não deixa rascunho pela metade na caixa: quem chamou tenta a reserva (ACS).
    await graph('DELETE', `/messages/${encodeURIComponent(draft.id)}`).catch(() => {})
    throw err
  }
  return { internetMessageId: draft.internetMessageId ?? null, conversationId: draft.conversationId ?? null }
}

export interface GraphAddress { emailAddress?: { name?: string; address?: string } }

export interface GraphMessage {
  id: string
  internetMessageId?: string
  conversationId?: string
  subject?: string
  from?: GraphAddress
  toRecipients?: GraphAddress[]
  ccRecipients?: GraphAddress[]
  receivedDateTime: string
  hasAttachments?: boolean
  internetMessageHeaders?: { name: string; value: string }[]
  body?: { content?: string }
  uniqueBody?: { content?: string }
}

export interface GraphAttachment {
  '@odata.type'?: string
  id?: string
  name: string
  contentType?: string
  contentBytes?: string
  /** Referência usada no corpo ([cid:...]) quando o anexo é imagem embutida. */
  contentId?: string
  isInline?: boolean
  size?: number
}

export const FILE_ATTACHMENT = '#microsoft.graph.fileAttachment'
/** E-mail anexado a outro e-mail (ex.: "ENC:" como anexo). */
export const ITEM_ATTACHMENT = '#microsoft.graph.itemAttachment'

const TEXT_BODY = { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' }

/**
 * Mais antigos primeiro (respostas entram no chamado na ordem em que chegaram), só os
 * recebidos a partir de `since`: o que já estava na caixa antes da virada fica intocado.
 */
export async function listInboxMessages(since: Date, top = 25): Promise<GraphMessage[]> {
  const select = 'id,internetMessageId,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,internetMessageHeaders,body,uniqueBody'
  const filter = `receivedDateTime ge ${since.toISOString()}`
  const res = await graph<{ value: GraphMessage[] }>('GET', `/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$top=${top}&$orderby=receivedDateTime asc&$select=${select}`, undefined, TEXT_BODY)
  return res.value
}

/** Todos os anexos (arquivo, e-mail anexado, link de nuvem); quem decide o que entra é o inbound. */
export async function listAttachments(messageId: string): Promise<GraphAttachment[]> {
  const res = await graph<{ value: GraphAttachment[] }>('GET', `/messages/${encodeURIComponent(messageId)}/attachments`)
  return res.value
}

/** Corpo em HTML (a leitura normal pede texto): só para achar o bloco de assinatura. */
export async function getMessageHtml(messageId: string): Promise<string> {
  const res = await graph<{ body?: { content?: string } }>('GET', `/messages/${encodeURIComponent(messageId)}?$select=body`)
  return res.body?.content ?? ''
}

/**
 * Tamanhos das imagens embutidas nos últimos e-mails do remetente antes de `before`
 * (a imagem de assinatura se repete de um e-mail para o outro; um print colado, não).
 */
export async function senderInlineImageSizes(from: string, before: string, top = 5): Promise<{ messages: number; sizes: number[] }> {
  const filter = `receivedDateTime lt ${before} and from/emailAddress/address eq '${from.replace(/'/g, "''")}'`
  const res = await graph<{ value: { attachments?: GraphAttachment[] }[] }>('GET',
    `/messages?$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime desc&$top=${top}&$select=id&$expand=attachments($select=size,isInline)`)
  return {
    messages: res.value.length,
    sizes: res.value.flatMap(m => (m.attachments ?? []).filter(a => a.isInline && a.size).map(a => a.size!)),
  }
}

/** E-mail anexado no formato MIME, para guardar como .eml. */
export async function attachmentMime(messageId: string, attachmentId: string): Promise<Buffer> {
  const path = `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`
  const res = await send('GET', path)
  if (!res.ok) throw new Error(`Graph GET ${path}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const folderIds = new Map<string, string>()

/** Pasta de primeiro nível da caixa; criada na primeira vez. */
export async function ensureFolder(displayName: string): Promise<string> {
  const cached = folderIds.get(displayName)
  if (cached) return cached
  const found = await graph<{ value: { id: string }[] }>('GET', `/mailFolders?$filter=displayName eq '${displayName.replace(/'/g, "''")}'&$select=id`)
  const id = found.value[0]?.id ?? (await graph<{ id: string }>('POST', '/mailFolders', { displayName })).id
  folderIds.set(displayName, id)
  return id
}

/** Metadados da Caixa de Entrada (sem ler mensagens): usado no "Testar conexão" do admin. */
export async function getInboxSummary(): Promise<{ totalItemCount: number; unreadItemCount: number }> {
  return graph('GET', '/mailFolders/inbox?$select=totalItemCount,unreadItemCount')
}

/** Dados públicos do certificado configurado (nunca a chave): titular, validade e thumbprint. */
export function certificateInfo(): { subject: string; validTo: string; thumbprint: string } | null {
  if (!env.MAIL_GRAPH_CERT) return null
  try {
    const cert = new X509Certificate(normalizePem(env.MAIL_GRAPH_CERT, 'CERTIFICATE'))
    return { subject: cert.subject.replace(/^CN=/, ''), validTo: new Date(cert.validTo).toISOString(), thumbprint: cert.fingerprint.replace(/:/g, '') }
  } catch {
    return null
  }
}

export async function moveMessage(messageId: string, folderId: string): Promise<void> {
  await graph('POST', `/messages/${encodeURIComponent(messageId)}/move`, { destinationId: folderId })
}
