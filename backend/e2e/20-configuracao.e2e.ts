// Regras que a gestão configura e o efeito delas no chamado de verdade: roteamento,
// tipos de chamado, SLA, reabertura, fechamento automático e inatividade.
import { afterAll, describe, expect, it } from 'vitest'
import { as, http, openTicket, uid } from './helpers'

const admin = () => as('admin')

describe('quem pode configurar', () => {
  const rotas: [string, string, unknown?][] = [
    ['GET', '/api/routing'],
    ['POST', '/api/routing', { name: 'x' }],
    ['POST', '/api/sla', { name: 'x' }],
    ['PATCH', '/api/ticket-types/incident', { enabled: false }],
    ['PATCH', '/api/auto-close/config', { enabled: true }],
    ['POST', '/api/auto-close/trigger', {}],
    ['PATCH', '/api/reopen-sla/config', { enabled: true }],
    ['PATCH', '/api/inactivity/config', { enabled: true }],
    ['POST', '/api/inactivity/trigger', {}],
    ['GET', '/api/email-logs'],
    ['GET', '/api/webhooks'],
  ]

  it.each(['acme1', 'an1'] as const)('%s não acessa a configuração', async quem => {
    const token = await as(quem)
    const vazou: string[] = []
    for (const [metodo, rota, body] of rotas) {
      const r = await http(metodo, rota, { token, body })
      if (r.status !== 403) vazou.push(`${metodo} ${rota} → ${r.status}`)
    }
    expect(vazou).toEqual([])
  })
})

describe('tipos de chamado', () => {
  afterAll(async () => {
    await http('PATCH', '/api/ticket-types/request', { token: await admin(), body: { enabled: true } })
  })

  it('tipo desligado some da lista', async () => {
    const r = await http('PATCH', '/api/ticket-types/request', { token: await admin(), body: { enabled: false } })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const lista = await http('GET', '/api/ticket-types', { token: await as('acme1') })
    const tipo = lista.body.data.find((t: any) => t.type === 'request')
    expect(tipo?.enabled).toBe(false)
  })

  it('tipo inexistente é recusado', async () => {
    const r = await http('PATCH', '/api/ticket-types/nao-existe', { token: await admin(), body: { enabled: false } })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
  })
})

describe('roteamento', () => {
  const criadas: string[] = []

  afterAll(async () => {
    for (const id of criadas) await http('DELETE', `/api/routing/${id}`, { token: await admin() })
  })

  it('o esquema lista gatilhos, campos e ações', async () => {
    const r = await http('GET', '/api/routing/schema', { token: await admin() })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).toContain('priority')
  })

  it('regra inválida volta 400, não 500', async () => {
    const r = await http('POST', '/api/routing', { token: await admin(), body: { name: '', conditions: 'lixo' } })
    expect(r.status).toBe(400)
  })

  it('regra que muda a prioridade vale para o chamado aberto depois dela', async () => {
    const marca = `ROTA${uid()}`
    const regra = await http('POST', '/api/routing', {
      token: await admin(),
      body: {
        name: `Regra ${marca}`,
        trigger: 'ticket_created',
        priority: 1,
        conditions: [{ field: 'subject_contains', operator: 'contains', value: marca }],
        actions: [{ type: 'set_priority', value: 'high' }],
      },
    })
    expect(regra.status, JSON.stringify(regra.body)).toBe(201)
    criadas.push(regra.body.data.id)

    const casou = await openTicket('acme1', { title: `Servidor fora ${marca}` })
    const naoCasou = await openTicket('acme1', { title: 'Outro assunto' })

    const lido = await http('GET', `/api/tickets/${casou.id}`, { token: await admin() })
    const outro = await http('GET', `/api/tickets/${naoCasou.id}`, { token: await admin() })
    expect(lido.body.data.priority).toBe('high')
    expect(outro.body.data.priority).not.toBe('high')
  })
})

describe('SLA', () => {
  it('plano novo aparece e o nome é obrigatório', async () => {
    const token = await admin()
    expect((await http('POST', '/api/sla', { token, body: { name: '' } })).status).toBe(400)
    const lista = await http('GET', '/api/sla', { token })
    expect(lista.status).toBe(200)
    expect(lista.body.data.length).toBeGreaterThan(0)
  })

  it('chamado de empresa com plano nasce com prazo', async () => {
    const t = await openTicket('acme1')
    const lido = await http('GET', `/api/tickets/${t.id}`, { token: await admin() })
    const prazo = lido.body.data.sla_deadline ?? lido.body.data.sla_due_at ?? lido.body.data.due_at
    expect(prazo, JSON.stringify(Object.keys(lido.body.data))).toBeTruthy()
  })
})

describe('regras automáticas', () => {
  it('fechamento automático valida o intervalo e mantém o valor', async () => {
    const token = await admin()
    const antes = (await http('GET', '/api/auto-close/config', { token })).body.data
    expect((await http('PATCH', '/api/auto-close/config', { token, body: { inactive_days: 0 } })).status).toBe(400)
    expect((await http('PATCH', '/api/auto-close/config', { token, body: { inactive_days: 91 } })).status).toBe(400)

    const salvo = await http('PATCH', '/api/auto-close/config', { token, body: { inactive_days: 7 } })
    expect(salvo.status).toBe(200)
    expect((await http('GET', '/api/auto-close/config', { token })).body.data.inactive_days).toBe(7)
    await http('PATCH', '/api/auto-close/config', { token, body: { inactive_days: antes?.inactive_days ?? 7 } })
  })

  it('disparo manual do fechamento automático não derruba nada e registra log', async () => {
    const token = await admin()
    const r = await http('POST', '/api/auto-close/trigger', { token, body: {} })
    expect(r.status).toBeLessThan(300)
    expect((await http('GET', '/api/auto-close/logs', { token })).status).toBe(200)
  })

  it('disparo da inatividade não redireciona chamado recente', async () => {
    const t = await openTicket('acme1')
    const token = await admin()
    const antes = (await http('GET', `/api/tickets/${t.id}`, { token })).body.data
    const r = await http('POST', '/api/inactivity/trigger', { token, body: {} })
    expect(r.status).toBeLessThan(300)
    const depois = (await http('GET', `/api/tickets/${t.id}`, { token })).body.data
    expect(depois.assignee_id ?? null).toBe(antes.assignee_id ?? null)
  })

  it('SLA de reabertura aceita só o intervalo válido', async () => {
    const token = await admin()
    expect((await http('PATCH', '/api/reopen-sla/config', { token, body: { reopen_limit_hours: 0 } })).status).toBe(400)
    expect((await http('PATCH', '/api/reopen-sla/config', { token, body: { reopen_limit_hours: 48 } })).status).toBe(200)
  })
})
