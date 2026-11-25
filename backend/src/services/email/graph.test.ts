import { describe, it, expect, vi } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes, verify } from 'node:crypto'

const { env } = vi.hoisted(() => ({ env: {} as Record<string, string> }))
vi.mock('../../config/env', () => ({ env }))
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { buildClientAssertion, listInboxMessages, resetGraphTokenCache, sendGraphMail } from './graph'

// Chave gerada na hora (nada de chave privada no repositório). O "certificado" só
// entra no cálculo do x5t (SHA-1 do DER), então bytes quaisquer servem.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const der = randomBytes(300)
const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString())

describe('client assertion do Graph (certificado)', () => {
  it('identifica o certificado pelo x5t e assina com RS256 para o tenant certo', () => {
    const jwt = buildClientAssertion({ tenantId: 'tenant-1', clientId: 'client-1', certPem, keyPem, now: 1_700_000_000_000 })
    const [h, p, s] = jwt.split('.')
    expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT', x5t: createHash('sha1').update(der).digest('base64url') })
    expect(decode(p)).toMatchObject({
      aud: 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
      iss: 'client-1', sub: 'client-1', nbf: 1_700_000_000, exp: 1_700_000_600,
    })
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })

  it('ignora o texto que o openssl põe antes do bloco (Bag Attributes, subject)', () => {
    const withBag = `Bag Attributes\n    localKeyID: 01 00 00 00\nsubject=CN=ISA - E-mail\nissuer=CN=ISA - E-mail\n${certPem}\n`
    const keyWithBag = `Bag Attributes\n    Microsoft CSP Name: Microsoft Software Key Storage Provider\n${keyPem}`
    const [h, p, s] = buildClientAssertion({ tenantId: 't', clientId: 'c', certPem: withBag, keyPem: keyWithBag }).split('.')
    expect(decode(h).x5t).toBe(createHash('sha1').update(der).digest('base64url'))
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })

  it('aceita o PEM numa linha só com "\\n" literal (formato das app settings do Azure)', () => {
    const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n')
    const a = buildClientAssertion({ tenantId: 't', clientId: 'c', certPem: oneLine(certPem), keyPem: oneLine(keyPem) })
    const [h, p, s] = a.split('.')
    expect(decode(h).x5t).toBe(createHash('sha1').update(der).digest('base64url'))
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })
})

describe('envio com anexos', () => {
  const cfg = () => Object.assign(env, {
    MAIL_GRAPH_TENANT_ID: 't', MAIL_GRAPH_CLIENT_ID: 'c', MAIL_GRAPH_MAILBOX: 'atendimento@example.com',
    MAIL_GRAPH_CERT: certPem, MAIL_GRAPH_PRIVATE_KEY: keyPem,
  })
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })

  it('pequeno vai no rascunho, grande pela sessão de upload em pedaços; depois envia', async () => {
    cfg()
    resetGraphTokenCache()
    const big = Buffer.alloc(4 * 1024 * 1024, 1)
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/oauth2/')) return json({ access_token: 'tok', expires_in: 3600 })
      if (url.endsWith('/messages') && init.method === 'POST') return json({ id: 'd1', internetMessageId: '<m@x>', conversationId: 'c1' })
      if (url.endsWith('/createUploadSession')) return json({ uploadUrl: 'https://upload.example/s1' })
      if (url.startsWith('https://upload.example/')) return new Response(null, { status: 200 })
      return new Response(null, { status: url.endsWith('/send') ? 202 : 201 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await sendGraphMail({ to: 'cli@x.com', subject: 's', html: '<p>x</p>', attachments: [
      { name: 'a.pdf', contentType: 'application/pdf', contentBytes: 'JVBERg==', size: 4 },
      { name: 'big.zip', contentType: 'application/zip', contentBytes: big.toString('base64'), size: big.length },
    ] })
    const calls = fetchMock.mock.calls.map(([u, i]: any) => `${i?.method ?? 'GET'} ${String(u).replace(/^https:\/\/graph\.microsoft\.com\/v1\.0\/users\/[^/]+/, '')}`)
    expect(calls.filter(c => !c.includes('oauth2'))).toEqual([
      'POST /messages',
      'POST /messages/d1/attachments',
      'POST /messages/d1/attachments/createUploadSession',
      'PUT https://upload.example/s1',
      'PUT https://upload.example/s1',
      'POST /messages/d1/send',
    ])
    const puts = fetchMock.mock.calls.filter(([u]: any) => String(u).startsWith('https://upload.example/'))
    expect(puts.map(([, i]: any) => i.headers['Content-Range'])).toEqual([`bytes 0-${3276800 - 1}/${big.length}`, `bytes 3276800-${big.length - 1}/${big.length}`])
    expect(puts.every(([, i]: any) => !i.headers.Authorization)).toBe(true)
    vi.unstubAllGlobals()
    resetGraphTokenCache()
  })

  it('falha ao anexar apaga o rascunho e devolve o erro (o mailer cai para o ACS)', async () => {
    cfg()
    resetGraphTokenCache()
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/oauth2/')) return json({ access_token: 'tok', expires_in: 3600 })
      if (url.endsWith('/messages') && init.method === 'POST') return json({ id: 'd2' })
      if (url.endsWith('/attachments')) return json({ error: { code: 'ErrorAttachmentSizeLimitExceeded', message: 'grande' } }, 413)
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendGraphMail({ to: 'cli@x.com', subject: 's', html: 'x', attachments: [{ name: 'a.pdf', contentType: 'application/pdf', contentBytes: 'JVBERg==', size: 4 }] }))
      .rejects.toThrow(/413/)
    expect(fetchMock.mock.calls.some(([u, i]: any) => i?.method === 'DELETE' && String(u).endsWith('/messages/d2'))).toBe(true)
    expect(fetchMock.mock.calls.some(([u]: any) => String(u).endsWith('/send'))).toBe(false)
    vi.unstubAllGlobals()
    resetGraphTokenCache()
  })
})

describe('leitura da caixa', () => {
  it('só pede os e-mails recebidos a partir da virada, mais antigos primeiro', async () => {
    Object.assign(env, {
      MAIL_GRAPH_TENANT_ID: 't', MAIL_GRAPH_CLIENT_ID: 'c', MAIL_GRAPH_MAILBOX: 'atendimento@example.com',
      MAIL_GRAPH_CERT: certPem, MAIL_GRAPH_PRIVATE_KEY: keyPem,
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] })))
    vi.stubGlobal('fetch', fetchMock)
    await listInboxMessages(new Date('2026-10-30T12:00:00Z'))
    const url = decodeURIComponent(fetchMock.mock.calls[1][0])
    expect(url).toContain('/users/atendimento@example.com/mailFolders/inbox/messages')
    expect(url).toContain('$filter=receivedDateTime ge 2026-10-30T12:00:00.000Z')
    expect(url).toContain('$orderby=receivedDateTime asc')
    vi.unstubAllGlobals()
  })
})
