/**
 * Entrega de webhooks de saída.
 *
 * Cada WebhookDelivery pendente é entregue via POST JSON assinado (HMAC-SHA256).
 * A primeira tentativa acontece logo após a emissão do evento; falhas são
 * retentadas pelo job webhookRetry com backoff exponencial até MAX_ATTEMPTS.
 */
import { createHmac } from 'node:crypto'
import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { Agent as HttpAgent, request as httpRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { AppError } from '../middlewares/errorHandler'
import { logger } from '../utils/logger'

export const BACKOFF_MINUTES = [1, 5, 30, 120, 720]
export const MAX_ATTEMPTS = 5
export const DELIVERY_TIMEOUT_MS = 10_000
export const RESPONSE_BODY_MAX = 2000

/** Lease do claim: se o processo morrer no meio do envio, o cron retoma depois. */
const CLAIM_LEASE_MINUTES = 5

/** Assinatura enviada no header X-Webhook-Signature: sha256=<hex> */
export function buildSignature(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

// CWE-918 (SSRF): faixas privadas e reservadas que um webhook não pode alcançar.
const PRIVATE_V4 = [
  /^0\./,                          // "esta rede" / unspecified
  /^10\./,                         // RFC1918
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 CGNAT
  /^127\./,                        // loopback
  /^169\.254\./,                   // link-local
  /^172\.(1[6-9]|2\d|3[01])\./,    // RFC1918
  /^192\.168\./,                   // RFC1918
  /^198\.(1[89])\./,               // 198.18.0.0/15 benchmarking
  /^(22[4-9]|2[3-9]\d)\./,         // 224.0.0.0/4+ multicast/reservado (224-255)
]

const v4FromHex = (hi: string, lo: string) => {
  const h = parseInt(hi, 16)
  const l = parseInt(lo, 16)
  return `${h >> 8}.${h & 0xff}.${l >> 8}.${l & 0xff}`
}

function isPrivateIp(host: string): boolean {
  const version = isIP(host)
  if (version === 4) return PRIVATE_V4.some((re) => re.test(host))
  if (version === 6) {
    const h = host.toLowerCase()
    // IPv4-mapped/compat, forma dotted (::ffff:127.0.0.1) -> revalida a parte v4
    const mappedDotted = h.match(/^::(ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
    if (mappedDotted) return isPrivateIp(mappedDotted[2])
    // Mesma coisa, forma hex normalizada pelo parser de URL (::ffff:7f00:1)
    const mappedHex = h.match(/^::(ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (mappedHex) return isPrivateIp(v4FromHex(mappedHex[2], mappedHex[3]))
    // NAT64 (64:ff9b::/96) e 6to4 (2002::/16) levam um IPv4 dentro do endereço
    const embedded = h.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ?? h.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(:|$)/)
    if (embedded) return isPrivateIp(v4FromHex(embedded[1], embedded[2]))
    return (
      h === '::1' ||
      h === '::' ||
      h.startsWith('fc') || h.startsWith('fd') || // fc00::/7 ULA
      /^fe[89a-f]/.test(h) ||                     // fe80::/10 link-local, fec0::/10 site-local
      h.startsWith('ff')                          // ff00::/8 multicast
    )
  }
  return false
}

/**
 * Validação anti-SSRF da URL de destino. Aplicada na criação/edição do
 * endpoint e revalidada a cada envio (a URL pode ter sido editada).
 *
 * Faz DNS lookup do host e rejeita se qualquer endereço resolvido for
 * privado/loopback/link-local/reservado — um hostname público pode
 * resolver para um IP interno (rebinding/DNS pointing a 127.0.0.1 etc).
 * Falha fechada: erro ou resolução vazia => rejeita.
 *
 * Isto é só a validação de cadastro: quem barra rebinding é a conexão, que
 * resolve de novo e confere o endereço em que vai conectar (pinnedLookup).
 */
export async function validateWebhookUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new AppError(400, 'URL inválida', 'WEBHOOK_URL_INVALID')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(400, 'A URL deve usar http ou https', 'WEBHOOK_URL_INVALID')
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '')

  if (env.WEBHOOKS_ALLOW_PRIVATE_URLS) return

  if (isPrivateIp(host)) {
    throw new AppError(400, 'URLs para redes privadas não são permitidas', 'WEBHOOK_URL_PRIVATE')
  }

  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
    throw new AppError(400, 'URLs para redes privadas não são permitidas', 'WEBHOOK_URL_PRIVATE')
  }

  // Host já é um IP literal: nada a resolver, a checagem acima já decidiu.
  if (isIP(host)) return

  await resolveAllowed(host)
}

/** Resolve o host e rejeita se algum endereço for privado (salvo WEBHOOKS_ALLOW_PRIVATE_URLS). */
async function resolveAllowed(host: string, options: { family?: number; hints?: number } = {}): Promise<LookupAddress[]> {
  let addresses: LookupAddress[]
  try {
    addresses = await lookup(host, { ...options, all: true })
  } catch {
    throw new AppError(400, 'Não foi possível resolver o host da URL', 'WEBHOOK_URL_UNRESOLVABLE')
  }
  if (addresses.length === 0) {
    throw new AppError(400, 'Não foi possível resolver o host da URL', 'WEBHOOK_URL_UNRESOLVABLE')
  }
  if (!env.WEBHOOKS_ALLOW_PRIVATE_URLS && addresses.some((a) => isPrivateIp(a.address))) {
    throw new AppError(400, 'URLs para redes privadas não são permitidas', 'WEBHOOK_URL_PRIVATE')
  }
  return addresses
}

/**
 * CWE-367 (DNS rebinding): validar um nome e deixar o cliente HTTP resolver de
 * novo abre uma janela entre a checagem e a conexão. Aqui a resposta que passou
 * pela checagem é a mesma em que o socket conecta. Host e SNI seguem o nome da URL.
 */
const pinnedLookup = ((hostname: string, options: { all?: boolean; family?: number; hints?: number }, callback: (err: Error | null, address?: string | LookupAddress[], family?: number) => void) => {
  const { family, hints } = options
  resolveAllowed(hostname, { family, hints }).then(
    (addresses) => (options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)),
    (err) => callback(err),
  )
}) as LookupFunction

// Sem keepAlive: socket reaproveitado pularia a checagem do lookup na conexão seguinte.
const pinnedHttpAgent = new HttpAgent({ lookup: pinnedLookup })
const pinnedHttpsAgent = new HttpsAgent({ lookup: pinnedLookup })

/** Status em que o construtor de Response não aceita corpo. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

type OutboundInit = { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }

/** POST com a conexão fixada. Mesmo contrato do fetch: resolve nos headers, corpo em stream. */
function pinnedPost(url: string, init: OutboundInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const isHttps = target.protocol === 'https:'
    const fail = (err: Error) => reject(init.signal.aborted ? init.signal.reason : err)
    const send = isHttps ? httpsRequest : httpRequest
    const req = send(target, {
      method: init.method,
      headers: init.headers,
      signal: init.signal,
      agent: isHttps ? pinnedHttpsAgent : pinnedHttpAgent,
    }, (res) => {
      // O destino é de terceiro: status ou header inválido não pode virar exceção fora da Promise.
      try {
        const status = res.statusCode ?? 0
        const headers = new Headers()
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1])
        const hasBody = !NULL_BODY_STATUSES.has(status)
        if (!hasBody) res.resume()
        resolve(new Response(hasBody ? (Readable.toWeb(res) as unknown as ConstructorParameters<typeof Response>[0]) : null, { status, headers }))
      } catch (err) {
        res.destroy()
        fail(err as Error)
      }
    })
    req.on('error', fail)
    req.end(init.body)
  })
}

/** Saída de rede das entregas; os testes de fluxo trocam `post` em vez de abrir socket. */
export const webhookTransport = { post: pinnedPost }

export function truncate(text: string | null | undefined, max = RESPONSE_BODY_MAX): string | null {
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Faz o POST de entrega sem seguir redirect automaticamente: cada `Location`
 * é revalidado por validateWebhookUrl (anti-SSRF) antes de ser seguido, com
 * um limite de hops. Um redirect para IP interno é assim rejeitado em vez
 * de ser seguido silenciosamente.
 */
export async function postWithValidatedRedirects(
  url: string,
  init: { headers: Record<string, string>; body: string; signal: AbortSignal },
): Promise<Response> {
  let currentUrl = url
  for (let hop = 0; ; hop++) {
    if (hop > 0) await validateWebhookUrl(currentUrl)

    const response = await webhookTransport.post(currentUrl, { ...init, method: 'POST' })

    if (!REDIRECT_STATUSES.has(response.status)) return response

    const location = response.headers.get('location')
    if (!location) return response
    await response.body?.cancel().catch(() => {})
    if (hop + 1 >= MAX_REDIRECTS) {
      throw new AppError(400, 'Número máximo de redirects excedido', 'WEBHOOK_TOO_MANY_REDIRECTS')
    }
    currentUrl = new URL(location, currentUrl).toString()
  }
}

/**
 * Tenta entregar uma delivery. Segura para chamadas concorrentes (job × tentativa
 * imediata × múltiplas instâncias): o claim atômico garante um único executor.
 */
export async function attemptDelivery(deliveryId: string): Promise<void> {
  const now = new Date()

  // Claim atômico com lease: só prossegue quem "ganhar" o updateMany.
  const claimed = await prisma.webhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: 'pending',
      OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
    },
    data: { next_retry_at: new Date(now.getTime() + CLAIM_LEASE_MINUTES * 60_000) },
  })
  if (claimed.count === 0) return

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  })
  if (!delivery) return

  if (!delivery.endpoint.active) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', error_message: 'Endpoint inativo', next_retry_at: null },
    })
    return
  }

  const attemptNumber = delivery.attempts + 1
  const started = Date.now()
  let responseStatus: number | null = null
  let responseBody: string | null = null
  let errorMessage: string | null = null

  try {
    await validateWebhookUrl(delivery.endpoint.url)

    const timestamp = new Date().toISOString()
    const body = JSON.stringify(delivery.payload)
    const signature = buildSignature(delivery.endpoint.secret, timestamp, body)

    const response = await postWithValidatedRedirects(delivery.endpoint.url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Event': delivery.event,
        'X-Webhook-Delivery-Id': delivery.id,
        'User-Agent': 'ISA-Webhooks/1.0',
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })

    responseStatus = response.status
    responseBody = truncate(await response.text().catch(() => null))

    if (!response.ok) {
      errorMessage = `HTTP ${response.status}`
    }
  } catch (error: any) {
    errorMessage = error?.name === 'TimeoutError'
      ? `Timeout após ${DELIVERY_TIMEOUT_MS / 1000}s`
      : truncate(error?.message ?? 'Erro de rede', 500)
  }

  const durationMs = Date.now() - started
  const succeeded = responseStatus !== null && responseStatus >= 200 && responseStatus < 300

  if (succeeded) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'success',
        attempts: attemptNumber,
        next_retry_at: null,
        response_status: responseStatus,
        response_body: responseBody,
        error_message: null,
        duration_ms: durationMs,
        delivered_at: new Date(),
      },
    })
    return
  }

  const exhausted = attemptNumber >= MAX_ATTEMPTS
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: exhausted ? 'failed' : 'pending',
      attempts: attemptNumber,
      next_retry_at: exhausted
        ? null
        : new Date(Date.now() + BACKOFF_MINUTES[Math.min(attemptNumber - 1, BACKOFF_MINUTES.length - 1)] * 60_000),
      response_status: responseStatus,
      response_body: responseBody,
      error_message: errorMessage,
      duration_ms: durationMs,
    },
  })

  if (exhausted) {
    logger.warn(`[Webhooks] Entrega ${deliveryId} falhou definitivamente após ${attemptNumber} tentativas`, {
      endpoint: delivery.endpoint.url,
      event: delivery.event,
      error: errorMessage,
    })
  }
}

/** Processa deliveries pendentes cujo retry venceu. Usado pelo job de cron. */
export async function processDueDeliveries(limit = 50): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: 'pending',
      OR: [{ next_retry_at: null }, { next_retry_at: { lte: new Date() } }],
    },
    select: { id: true },
    orderBy: { created_at: 'asc' },
    take: limit,
  })

  const BATCH = 5
  for (let i = 0; i < due.length; i += BATCH) {
    await Promise.allSettled(due.slice(i, i + BATCH).map((d) => attemptDelivery(d.id)))
  }

  return due.length
}
