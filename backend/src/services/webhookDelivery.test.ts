import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { lookup } from 'node:dns/promises'
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'

const envMock = vi.hoisted(() => ({ NODE_ENV: 'test', WEBHOOKS_ALLOW_PRIVATE_URLS: false }))
vi.mock('../config/env', () => ({ env: envMock }))

// DNS real é lento/instável em teste; resolve nomes públicos de teste para
// IPs públicos fixos e deixa hosts que já são IP literal passarem direto
// (validateWebhookUrl não chama lookup nesse caso).
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === 'ssrf-rebind.example') return [{ address: '127.0.0.1', family: 4 }]
    return [{ address: '93.184.216.34', family: 4 }]
  }),
}))

const prismaMock = vi.hoisted(() => ({
  webhookDelivery: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}))
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import {
  buildSignature,
  validateWebhookUrl,
  postWithValidatedRedirects,
  webhookTransport,
  attemptDelivery,
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  RESPONSE_BODY_MAX,
} from './webhookDelivery'

describe('buildSignature', () => {
  it('é determinística e retorna hex sha256', () => {
    const a = buildSignature('whsec_abc', '2026-07-16T12:00:00.000Z', '{"x":1}')
    const b = buildSignature('whsec_abc', '2026-07-16T12:00:00.000Z', '{"x":1}')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('muda com secret, timestamp ou corpo diferentes', () => {
    const base = buildSignature('s1', 't1', 'b1')
    expect(buildSignature('s2', 't1', 'b1')).not.toBe(base)
    expect(buildSignature('s1', 't2', 'b1')).not.toBe(base)
    expect(buildSignature('s1', 't1', 'b2')).not.toBe(base)
  })
})

describe('validateWebhookUrl', () => {
  it('aceita URLs http(s) públicas', async () => {
    await expect(validateWebhookUrl('https://example.com/hook')).resolves.not.toThrow()
    await expect(validateWebhookUrl('http://api.exemplo.com.br/x?y=1')).resolves.not.toThrow()
  })

  it('rejeita protocolos não-http', async () => {
    await expect(validateWebhookUrl('ftp://example.com')).rejects.toThrow()
    await expect(validateWebhookUrl('file:///etc/passwd')).rejects.toThrow()
    await expect(validateWebhookUrl('nao-e-url')).rejects.toThrow()
  })

  it('rejeita IPs privados/loopback/link-local', async () => {
    for (const bad of [
      'http://127.0.0.1/x', 'http://10.1.2.3/x', 'http://192.168.0.10/x',
      'http://172.16.5.5/x', 'http://172.31.0.1/x', 'http://169.254.1.1/x',
      'http://[::1]/x', 'http://0.0.0.0/x', 'http://100.64.0.5/x',
      'http://198.18.0.1/x', 'http://224.0.0.1/x', 'http://[::ffff:127.0.0.1]/x',
    ]) {
      await expect(validateWebhookUrl(bad), bad).rejects.toThrow()
    }
  })

  it('não bloqueia 172.32.x (fora do range privado)', async () => {
    await expect(validateWebhookUrl('http://172.32.0.1/x')).resolves.not.toThrow()
  })

  it('rejeita localhost e domínios internos quando WEBHOOKS_ALLOW_PRIVATE_URLS=false', async () => {
    await expect(validateWebhookUrl('http://localhost:3001/x')).rejects.toThrow()
    await expect(validateWebhookUrl('https://meu.servico.local/x')).rejects.toThrow()
    await expect(validateWebhookUrl('https://svc.internal/x')).rejects.toThrow()
  })

  it('rejeita hostname público que resolve via DNS para IP privado (rebinding)', async () => {
    await expect(validateWebhookUrl('http://ssrf-rebind.example/x')).rejects.toThrow(/privadas/)
  })

  it('rejeita o resto de fe80::/10, fec0::/10 e IPv4 privado dentro de NAT64 e 6to4', async () => {
    for (const bad of ['http://[fe90::1]/', 'http://[febf::1]/', 'http://[fec0::1]/', 'http://[64:ff9b::7f00:1]/', 'http://[64:ff9b::a00:1]/', 'http://[2002:7f00:1::]/', 'http://[2002:c0a8:1::1]/']) {
      await expect(validateWebhookUrl(bad), bad).rejects.toThrow(/privadas/)
    }
  })

  it('aceita IPv6 público e NAT64/6to4 de IPv4 público', async () => {
    for (const ok of ['http://[2606:4700::1111]/', 'http://[64:ff9b::5db8:d822]/', 'http://[2002:5db8:d822::1]/']) {
      await expect(validateWebhookUrl(ok), ok).resolves.not.toThrow()
    }
  })
})

describe('conexão de saída fixada no IP validado', () => {
  const lookupMock = vi.mocked(lookup)
  const PUBLIC = [{ address: '93.184.216.34', family: 4 }] as never
  const LOOPBACK = [{ address: '127.0.0.1', family: 4 }] as never
  const received: Array<{ req: IncomingMessage; body: string }> = []
  let respond: (req: IncomingMessage, res: import('node:http').ServerResponse) => void
  let server: Server
  let port: number

  const post = (url: string, signal = AbortSignal.timeout(2000)) =>
    postWithValidatedRedirects(url, { headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': 'e' }, body: '{"a":"ção"}', signal })

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (c) => { body += c })
      req.on('end', () => { received.push({ req, body }); respond(req, res) })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    port = (server.address() as AddressInfo).port
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  })

  beforeEach(() => {
    received.length = 0
    respond = (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok') }
    lookupMock.mockClear()
  })
  afterEach(() => {
    envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = false
    lookupMock.mockReset()
    lookupMock.mockImplementation((async (host: string) => (host === 'ssrf-rebind.example' ? LOOPBACK : PUBLIC)) as never)
  })

  it('DNS rebinding: público na validação, interno na conexão => não conecta', async () => {
    const url = `http://rebind.example:${port}/hook`
    lookupMock.mockResolvedValueOnce(PUBLIC).mockResolvedValue(LOOPBACK)

    await expect(validateWebhookUrl(url)).resolves.not.toThrow()
    await expect(post(url)).rejects.toMatchObject({ code: 'WEBHOOK_URL_PRIVATE' })
    expect(received).toHaveLength(0)
  })

  it('o rebinding também é barrado no destino de um redirect', async () => {
    envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = true // só para o primeiro salto alcançar o servidor local
    lookupMock.mockResolvedValue(LOOPBACK)
    respond = (_req, res) => {
      envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = false
      lookupMock.mockReset()
      lookupMock.mockResolvedValueOnce(PUBLIC).mockResolvedValue(LOOPBACK)
      res.writeHead(302, { Location: `http://rebind.example:${port}/interno` }).end()
    }

    await expect(post(`http://hook.example:${port}/a`)).rejects.toMatchObject({ code: 'WEBHOOK_URL_PRIVATE' })
    expect(received.map((r) => r.req.url)).toEqual(['/a'])
  })

  it('conecta no endereço resolvido pelo lookup próprio, com Host, headers e corpo da URL original', async () => {
    envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = true
    lookupMock.mockResolvedValue(LOOPBACK)

    const response = await post(`http://hook.example:${port}/hook?x=1`)

    expect(response.status).toBe(200)
    expect(response.ok).toBe(true)
    expect(await response.text()).toBe('ok')
    expect(lookupMock).toHaveBeenCalledWith('hook.example', expect.objectContaining({ all: true }))
    const [{ req, body }] = received
    expect(req.method).toBe('POST')
    expect(req.url).toBe('/hook?x=1')
    expect(req.headers.host).toBe(`hook.example:${port}`)
    expect(req.headers['x-webhook-event']).toBe('e')
    expect(body).toBe('{"a":"ção"}')
  })

  it('WEBHOOKS_ALLOW_PRIVATE_URLS mantém a exceção: IP literal local continua entregando', async () => {
    envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = true
    const response = await post(`http://127.0.0.1:${port}/local`)
    expect(response.status).toBe(200)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('segue redirect público e cada salto passa pelo lookup', async () => {
    envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = true
    lookupMock.mockResolvedValue(LOOPBACK)
    respond = (req, res) => {
      if (req.url === '/a') res.writeHead(307, { Location: `http://outro.example:${port}/b` }).end('movido')
      else res.writeHead(200).end('fim')
    }

    const response = await post(`http://hook.example:${port}/a`)

    expect(await response.text()).toBe('fim')
    expect(lookupMock.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['hook.example', 'outro.example']))
    expect(received[1].req.headers.host).toBe(`outro.example:${port}`)
  })

  it('204 e 304 não quebram a montagem da resposta', async () => {
    envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = true
    respond = (req, res) => { res.writeHead(req.url === '/204' ? 204 : 304).end() }
    expect(await (await post(`http://127.0.0.1:${port}/204`)).text()).toBe('')
    expect((await post(`http://127.0.0.1:${port}/304`)).status).toBe(304)
  })

  it('status inválido do destino vira erro da entrega, não exceção solta no processo', async () => {
    envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = true
    respond = (_req, res) => { res.socket?.end('HTTP/1.1 999 Nope\r\nContent-Length: 0\r\n\r\n') }
    await expect(post(`http://127.0.0.1:${port}/x`)).rejects.toThrow()
  })

  it('estouro de tempo mantém o erro TimeoutError que attemptDelivery traduz', async () => {
    envMock.WEBHOOKS_ALLOW_PRIVATE_URLS = true
    respond = () => {}
    await expect(post(`http://127.0.0.1:${port}/lento`, AbortSignal.timeout(50))).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

describe('attemptDelivery', () => {
  const fetchMock = vi.fn()

  const baseDelivery = {
    id: 'del-1',
    event: 'ticket.created',
    payload: { event: 'ticket.created', data: {} },
    attempts: 0,
    endpoint: { id: 'ep-1', url: 'https://example.com/hook', secret: 'whsec_x', active: true },
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(webhookTransport, 'post').mockImplementation(fetchMock)
    fetchMock.mockReset()
    prismaMock.webhookDelivery.updateMany.mockReset()
    prismaMock.webhookDelivery.findUnique.mockReset()
    prismaMock.webhookDelivery.update.mockReset()
    prismaMock.webhookDelivery.update.mockResolvedValue({})
  })

  it('não faz fetch quando o claim falha (outro worker pegou)', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 0 })
    await attemptDelivery('del-1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prismaMock.webhookDelivery.findUnique).not.toHaveBeenCalled()
  })

  it('marca failed sem fetch quando o endpoint está inativo', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({
      ...baseDelivery,
      endpoint: { ...baseDelivery.endpoint, active: false },
    })
    await attemptDelivery('del-1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', error_message: 'Endpoint inativo' }),
    }))
  })

  it('entrega com sucesso: assina, envia headers e marca success', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({ ...baseDelivery })
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' })

    await attemptDelivery('del-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/hook')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Webhook-Event']).toBe('ticket.created')
    expect(init.headers['X-Webhook-Delivery-Id']).toBe('del-1')
    expect(init.headers['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
    // Assinatura corresponde a HMAC(secret, timestamp + '.' + body)
    const expected = buildSignature('whsec_x', init.headers['X-Webhook-Timestamp'], init.body)
    expect(init.headers['X-Webhook-Signature']).toBe(`sha256=${expected}`)

    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'success', attempts: 1, response_status: 200 }),
    }))
  })

  it('falha HTTP agenda retry com backoff da 1ª tentativa', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({ ...baseDelivery })
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })

    const before = Date.now()
    await attemptDelivery('del-1')

    const updateArg = prismaMock.webhookDelivery.update.mock.calls[0][0]
    expect(updateArg.data.status).toBe('pending')
    expect(updateArg.data.attempts).toBe(1)
    expect(updateArg.data.error_message).toBe('HTTP 500')
    const delta = updateArg.data.next_retry_at.getTime() - before
    expect(delta).toBeGreaterThanOrEqual(BACKOFF_MINUTES[0] * 60_000 - 1000)
    expect(delta).toBeLessThanOrEqual(BACKOFF_MINUTES[0] * 60_000 + 5000)
  })

  it('marca failed definitivo na última tentativa', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({
      ...baseDelivery,
      attempts: MAX_ATTEMPTS - 1,
    })
    fetchMock.mockRejectedValue(Object.assign(new Error('rede caiu'), { name: 'FetchError' }))

    await attemptDelivery('del-1')

    const updateArg = prismaMock.webhookDelivery.update.mock.calls[0][0]
    expect(updateArg.data.status).toBe('failed')
    expect(updateArg.data.attempts).toBe(MAX_ATTEMPTS)
    expect(updateArg.data.next_retry_at).toBeNull()
  })

  it('trunca o corpo da resposta', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({ ...baseDelivery })
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'x'.repeat(RESPONSE_BODY_MAX + 500) })

    await attemptDelivery('del-1')

    const updateArg = prismaMock.webhookDelivery.update.mock.calls[0][0]
    expect(updateArg.data.response_body).toHaveLength(RESPONSE_BODY_MAX)
  })

  it('URL que virou privada após edição marca falha sem fetch', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({
      ...baseDelivery,
      endpoint: { ...baseDelivery.endpoint, url: 'http://127.0.0.1/hook' },
    })

    await attemptDelivery('del-1')

    expect(fetchMock).not.toHaveBeenCalled()
    const updateArg = prismaMock.webhookDelivery.update.mock.calls[0][0]
    expect(updateArg.data.status).toBe('pending') // 1ª falha ainda agenda retry
    expect(updateArg.data.error_message).toContain('privadas')
  })

  it('não segue redirect para IP privado (SSRF via 302) e não persiste corpo interno', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({ ...baseDelivery })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'http://127.0.0.1:9999/metadata' }),
      text: async () => 'não deveria ser lido',
    })

    await attemptDelivery('del-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const updateArg = prismaMock.webhookDelivery.update.mock.calls[0][0]
    expect(updateArg.data.response_body).toBeNull()
    expect(updateArg.data.error_message).toContain('privadas')
  })

  it('segue redirect para destino público revalidado e persiste a resposta final', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({ ...baseDelivery })
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ location: 'https://example.com/hook2' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => 'ok' })

    await attemptDelivery('del-1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/hook2')
    const updateArg = prismaMock.webhookDelivery.update.mock.calls[0][0]
    expect(updateArg.data.status).toBe('success')
    expect(updateArg.data.response_body).toBe('ok')
  })

  it('aborta após exceder o limite de redirects', async () => {
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({ ...baseDelivery })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'https://example.com/loop' }),
      text: async () => '',
    })

    await attemptDelivery('del-1')

    expect(fetchMock).toHaveBeenCalledTimes(5)
    const updateArg = prismaMock.webhookDelivery.update.mock.calls[0][0]
    expect(updateArg.data.response_body).toBeNull()
    expect(updateArg.data.error_message).toContain('redirects')
  })
})
