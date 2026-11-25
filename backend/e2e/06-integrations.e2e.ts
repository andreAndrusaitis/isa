// API keys + API externa v1 + webhooks de saída + horário comercial: o que
// integradores e o admin fazem e que, mal validado, derruba produção.
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, http, openTicket, orgs, uid } from './helpers'

const ALL_SCOPES = ['create_ticket', 'update_ticket', 'close_ticket', 'create_user', 'update_user', 'read_categories', 'read_subcategories', 'read_queues', 'read_organizations', 'read_tickets']

async function newKey(scopes: string[], org_id: string | null = null) {
  const r = await http('POST', '/api/integrations/keys', { token: await as('admin'), body: { name: `e2e ${uid()}`, scopes, org_id } })
  if (r.status !== 201) throw new Error(`key → ${r.status} ${JSON.stringify(r.body)}`)
  return { id: r.body.data.id, key: r.body.data.key ?? r.body.data.plainKey ?? r.body.data.token }
}
const ext = (key: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  http(method, `/api/integrations/v1${path}`, { headers: { authorization: `Bearer ${key}`, ...headers }, body })

describe('API keys', () => {
  it('só admin gerencia keys', async () => {
    for (const who of ['gerente', 'tm', 'an1', 'acme1'] as const) {
      expect((await http('GET', '/api/integrations/keys', { token: await as(who) })).status).toBe(403)
      expect((await http('POST', '/api/integrations/keys', { token: await as(who), body: { name: 'x', scopes: ['read_tickets'] } })).status).toBe(403)
    }
  })

  it('key em claro aparece só na criação; listagem não vaza key nem hash', async () => {
    const k = await newKey(['read_queues'])
    expect(k.key).toBeTruthy()
    const list = await http('GET', '/api/integrations/keys', { token: await as('admin') })
    const s = JSON.stringify(list.body)
    expect(s).not.toContain(k.key)
    expect(s).not.toMatch(/key_hash/)
  })

  it('escopo ausente → 403; key desativada → 401; key regenerada invalida a antiga', async () => {
    const k = await newKey(['read_queues'])
    expect((await ext(k.key, 'GET', '/queues')).status).toBe(200)
    expect((await ext(k.key, 'GET', '/tickets')).status).toBe(403)
    const regen = await http('POST', `/api/integrations/keys/${k.id}/regenerate`, { token: await as('admin') })
    expect(regen.status).toBeLessThan(300)
    expect((await ext(k.key, 'GET', '/queues')).status).toBe(401)
    const newPlain = regen.body.data.key ?? regen.body.data.plainKey ?? regen.body.data.token
    expect((await ext(newPlain, 'GET', '/queues')).status).toBe(200)
    await http('PATCH', `/api/integrations/keys/${k.id}`, { token: await as('admin'), body: { active: false } })
    expect((await ext(newPlain, 'GET', '/queues')).status).toBe(401)
  })
})

describe('API externa v1 com key travada na ACME', () => {
  let key: string
  let globexT: any
  beforeAll(async () => {
    key = (await newKey(ALL_SCOPES, (await orgs()).acme.id)).key
    globexT = await openTicket('globex1')
  })

  it('lista só chamados da ACME e não lê chamado da Globex nem por id nem por número', async () => {
    const r = await ext(key, 'GET', '/tickets?per_page=100')
    expect(r.status).toBe(200)
    expect(r.body.data.every((t: any) => t.org.id === undefined || t.org.id === null || t.org.name.startsWith('ACME'))).toBe(true)
    expect((await ext(key, 'GET', `/tickets/${globexT.id}`)).status).toBe(404)
    expect((await ext(key, 'GET', `/tickets/${globexT.display_number ?? globexT.displayNumber}`)).status).toBe(404)
    expect((await ext(key, 'GET', `/tickets?organization_id=${(await orgs()).globex.id}`)).status).toBe(404)
  })

  it('não altera nem fecha chamado da Globex', async () => {
    expect((await ext(key, 'PATCH', `/tickets/${globexT.id}`, { external_request_id: uid(), priority: 'low' })).status).toBe(404)
    expect((await ext(key, 'POST', `/tickets/${globexT.id}/closure`, { external_request_id: uid(), status: 'closed', note: 'fechando de fora' })).status).toBe(404)
  })

  it('cria chamado para cliente ACME; não cria usuário em outra empresa', async () => {
    const t = await ext(key, 'POST', '/tickets', { external_request_id: uid(), requester: { email: 'usuario1.acme@isa.local' }, ticket: { title: 'via API', description: 'integração' } })
    expect(t.status).toBeLessThan(300)
    const email = `intruso.${uid()}@isa.local`
    const u = await ext(key, 'POST', '/users', { external_request_id: uid(), name: 'Intruso', email, organization_id: (await orgs()).globex.id })
    expect(u.status).toBeLessThan(500)
    const created = (await http('GET', '/api/users?role=user', { token: await as('admin') })).body.data.find((x: any) => x.email === email)
    if (created) expect(created.org_id).not.toBe((await orgs()).globex.id)
  })

  it('não atribui chamado a cliente nem a analista de outra empresa via assigned_to_email', async () => {
    const t = await openTicket('acme1')
    const r = await ext(key, 'PATCH', `/tickets/${t.id}`, { external_request_id: uid(), assigned_to_email: 'usuario2.acme@isa.local' })
    expect(r.status).toBeGreaterThanOrEqual(400)
  })

  it('mesmo external_request_id enviado 2x em paralelo (retry do integrador) não cria dois chamados', async () => {
    const since = new Date(Date.now() - 2000).toISOString()
    const idem = `e2e-${uid()}`
    const body = { external_request_id: idem, requester: { email: 'usuario1.acme@isa.local' }, ticket: { title: `idem ${idem}`, description: 'x' } }
    const [a, b] = await Promise.all([ext(key, 'POST', '/tickets', body), ext(key, 'POST', '/tickets', body)])
    // um cria (201) e a retentativa simultânea recebe 409 "em processamento" — nunca 500
    expect([a.status, b.status].sort()).toEqual([201, 409])
    const list = await ext(key, 'GET', `/tickets?per_page=100&created_since=${encodeURIComponent(since)}`)
    expect(list.body.data.filter((t: any) => t.title === body.ticket.title).length).toBe(1)
  })

  it('paginação: per_page acima do limite é recusada, filtros inválidos → 400', async () => {
    expect((await ext(key, 'GET', '/tickets?per_page=1000')).status).toBe(400)
    expect((await ext(key, 'GET', '/tickets?status=foo')).status).toBe(400)
    expect((await ext(key, 'GET', '/tickets?updated_since=ontem')).status).toBe(400)
  })
})

describe('webhooks de saída', () => {
  const create = async (url: string) => http('POST', '/api/webhooks/endpoints', {
    token: await as('admin'), body: { name: `e2e ${uid()}`, url, events: ['ticket.created'] },
  })

  it('URLs internas (SSRF) são recusadas', async () => {
    for (const url of ['http://127.0.0.1:3002/health', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://[::1]/', 'http://0.0.0.0/', 'file:///etc/passwd', 'http://2130706433/']) {
      const r = await create(url)
      expect(r.status, url).toBeGreaterThanOrEqual(400)
      expect(r.status, url).toBeLessThan(500)
    }
  })

  it('só admin (ou permissão webhooks) gerencia endpoints', async () => {
    for (const who of ['tm', 'an1', 'acme1'] as const) {
      expect((await http('GET', '/api/webhooks/endpoints', { token: await as(who) })).status).toBe(403)
    }
  })
})

describe('entrega real de webhook', () => {
  // Receptor local: só funciona se o backend aceitar URL privada; senão o teste é ignorado.
  let server: ReturnType<typeof createServer>
  const got: any[] = []
  beforeAll(async () => {
    server = createServer((req, res) => {
      let b = ''
      req.on('data', c => (b += c)).on('end', () => { got.push({ headers: req.headers, body: b }); res.end('ok') })
    })
    await new Promise<void>(r => server.listen(4599, r))
  })
  afterAll(() => server.close())

  it('URL privada é recusada também no envio de teste (ambiente sem WEBHOOKS_ALLOW_PRIVATE_URLS)', async () => {
    const r = await http('POST', '/api/webhooks/endpoints', { token: await as('admin'), body: { name: 'local', url: 'http://127.0.0.1:4599/hook', events: ['ticket.created'] } })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(got.length).toBe(0)
  })
})

describe('horário comercial (motor de SLA)', () => {
  let original: any
  beforeAll(async () => { original = (await http('GET', '/api/business-hours', { token: await as('admin') })).body.data })
  afterAll(async () => {
    await http('PATCH', '/api/business-hours', { token: await as('admin'), body: {
      business_hours_start: original.business_hours_start, business_hours_end: original.business_hours_end,
      working_days: original.working_days, timezone: original.timezone,
    } })
  })

  it('fuso inválido é recusado (senão todo cálculo de SLA quebra)', async () => {
    const r = await http('PATCH', '/api/business-hours', { token: await as('admin'), body: { timezone: 'Marte/Olympus' } })
    expect(r.status).toBe(400)
  })

  it('início depois do fim é recusado', async () => {
    const r = await http('PATCH', '/api/business-hours', { token: await as('admin'), body: { business_hours_start: '18:00', business_hours_end: '08:00' } })
    expect(r.status).toBe(400)
  })

  it('início == fim é recusado', async () => {
    const r = await http('PATCH', '/api/business-hours', { token: await as('admin'), body: { business_hours_start: '09:00', business_hours_end: '09:00' } })
    expect(r.status).toBe(400)
  })

  it('hora impossível (25:99) é recusada', async () => {
    const r = await http('PATCH', '/api/business-hours', { token: await as('admin'), body: { business_hours_start: '25:99' } })
    expect(r.status).toBe(400)
  })

  it('depois de qualquer PATCH aceito, abrir chamado continua funcionando e rápido', async () => {
    const t0 = Date.now()
    const t = await openTicket('acme1')
    expect(t.id).toBeTruthy()
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})

describe('filas', () => {
  it('criar sem nome → 400; PATCH parcial não apaga nome nem descrição', async () => {
    const admin = await as('admin')
    expect((await http('POST', '/api/queues', { token: admin, body: {} })).status).toBe(400)
    const q = await http('POST', '/api/queues', { token: admin, body: { name: `Fila E2E ${uid()}`, description: 'desc' } })
    expect(q.status).toBe(201)
    const p = await http('PATCH', `/api/queues/${q.body.data.id}`, { token: admin, body: { active: false } })
    expect(p.status).toBe(200)
    expect(p.body.data.name).toBe(q.body.data.name)
    expect(p.body.data.description).toBe('desc')
    expect((await http('PATCH', `/api/queues/${q.body.data.id}`, { token: admin, body: { name: '  ' } })).status).toBe(400)
  })
})
