// Fronteiras com o mundo de fora: bloqueio de e-mail, Teams, IA e o que o
// servidor em modo produção expõe. Nada aqui sai da máquina: o ambiente não tem
// credencial nenhuma, então Teams e IA precisam falhar de forma limpa.
import { afterAll, describe, expect, it } from 'vitest'
import { as, http, openTicket, orgs, uid } from './helpers'

describe('bloqueio de remetentes', () => {
  const criados: string[] = []

  afterAll(async () => {
    for (const id of criados) await http('DELETE', `/api/email-logs/blocks/${id}`, { token: await as('admin') })
  })

  it('bloqueia, recusa duplicado e valida o formato', async () => {
    const token = await as('admin')
    const value = `spam-${uid()}@exemplo.test`
    const r = await http('POST', '/api/email-logs/blocks', { token, body: { kind: 'email', value } })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    criados.push(r.body.id ?? r.body.data?.id)

    expect((await http('POST', '/api/email-logs/blocks', { token, body: { kind: 'email', value } })).status).toBe(409)
    expect((await http('POST', '/api/email-logs/blocks', { token, body: { kind: 'email', value: 'nao-e-email' } })).status).toBe(400)
    expect((await http('POST', '/api/email-logs/blocks', { token, body: { kind: 'domain', value: 'sem espaço.com' } })).status).toBe(400)
  })

  it('a tela de configuração não expõe segredo', async () => {
    const r = await http('GET', '/api/email-logs/settings', { token: await as('admin') })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toMatch(/PRIVATE KEY|BEGIN CERTIFICATE|accesskey=/i)
  })
})

describe('Teams desligado', () => {
  it('o webhook do bot responde 503 e não processa nada', async () => {
    const r = await http('POST', '/api/teams/messages', { body: { type: 'message', text: 'oi' } })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('TEAMS_BOT_DISABLED')
  })
})

// A suíte fala com o stub local (e2e/foundry-stub.mjs), com todos os agentes off.
describe('IA desligada', () => {
  it('o status mostra os agentes desligados', async () => {
    const r = await http('GET', '/api/ai/status', { token: await as('admin') })
    expect(r.status).toBe(200)
    expect(r.body.data.agents.filter((a: any) => a.mode !== 'off')).toEqual([])
    expect(JSON.stringify(r.body)).not.toMatch(/AZURE_AI_KEY|api[-_]?key/i)
  })

  it('o painel de IA é só para admin', async () => {
    expect((await http('GET', '/api/ai/status', { token: await as('an1') })).status).toBe(403)
    expect((await http('GET', '/api/ai/runs', { token: await as('acme1') })).status).toBe(403)
  })

  it('chamado abre normalmente sem a IA', async () => {
    const t = await openTicket('acme1')
    expect(t.id).toBeTruthy()
  })

  it('assistente recusa a equipe e não cai com a IA desligada', async () => {
    const equipe = await http('POST', '/api/assistant/chat', { token: await as('an1'), body: { message: 'oi' } })
    expect(equipe.status).toBe(403)

    const cliente = await http('POST', '/api/assistant/chat', { token: await as('acme1'), body: { message: 'oi' } })
    expect(cliente.status).toBeLessThan(500 + 4) // 503 é falha limpa; 500 não
    expect(cliente.status).not.toBe(500)
  })
})

describe('servidor em modo produção', () => {
  it('health responde sem revelar detalhes internos', async () => {
    const r = await http('GET', '/health')
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toMatch(/postgres(ql)?:\/\/|password|secret/i)
  })

  it('não anuncia o framework e manda os cabeçalhos de segurança', async () => {
    const r = await http('GET', '/health')
    expect(r.headers.get('x-powered-by')).toBeNull()
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('strict-transport-security')).toBeTruthy()
  })

  it('erro não devolve stack nem SQL', async () => {
    const respostas = await Promise.all([
      http('GET', '/rota-que-nao-existe'),
      http('POST', '/api/auth/login', { raw: '{json quebrado' }),
      http('GET', '/api/tickets/nao-e-uuid', { token: await as('admin') }),
    ])
    for (const r of respostas) {
      expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts:\d+|node_modules|prisma\.|SELECT /i)
      expect(r.status).toBeLessThan(500)
    }
  })

  it('origem desconhecida não recebe permissão de CORS', async () => {
    const r = await http('OPTIONS', '/api/auth/login', {
      headers: { origin: 'https://atacante.example', 'access-control-request-method': 'POST' },
    })
    expect(r.headers.get('access-control-allow-origin')).not.toBe('https://atacante.example')
    expect(r.headers.get('access-control-allow-origin')).not.toBe('*')
  })
})
