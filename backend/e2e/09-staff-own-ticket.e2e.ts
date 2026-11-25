// Equipe atendendo o PRÓPRIO chamado e TM/Gerente atendendo como analista.
// Seed: equipe na empresa interna ISA Interna; ISA Interna na carteira do TM, do Gerente e do
// Analista 2 (o Analista 1 não atende a ISA Interna). Ver prisma/seed-test-rbac.mjs.
import { describe, it, expect, beforeAll } from 'vitest'
import { http, login, U } from './helpers'

const tk: Record<string, string> = {}
const uid: Record<string, string> = {}
const who = ['admin', 'gerente', 'tm', 'an1', 'an2', 'acme1'] as const

beforeAll(async () => {
  for (const k of who) {
    const s = await login(U[k])
    tk[k] = s.token
    uid[k] = s.user.id
  }
})

const open = async (k: string, title = 'Notebook não liga') => {
  const r = await http('POST', '/api/tickets', { token: tk[k], body: { title, description: 'Desde hoje cedo o notebook não liga, nem com o carregador.' } })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.data
}
const patch = (k: string, id: string, body: any) => http('PATCH', `/api/tickets/${id}`, { token: tk[k], body })
const say = (k: string, id: string, text: string, type: 'agent' | 'user' | 'internal') => http('POST', `/api/tickets/${id}/messages`, { token: tk[k], body: { text, type } })
const view = async (id: string) => (await http('GET', `/api/tickets/${id}`, { token: tk.admin })).body.data
const RES = { status: 'resolved', resolution_details: 'Fonte trocada, equipamento ligando normalmente.' }

describe('chamado aberto pela equipe para si', () => {
  it('cai na empresa interna (ISA Interna) com fila, e quem atende a ISA Interna enxerga', async () => {
    const t = await open('an1')
    const v = await view(t.id)
    expect(v.org_id ?? v.orgId).toBeTruthy()
    expect(v.queue).toBeTruthy()
    for (const k of ['tm', 'gerente', 'an2']) expect((await http('GET', `/api/tickets/${t.id}`, { token: tk[k] })).status, k).toBe(200)
  })

  it('analista atende o próprio chamado: responde → Em Atendimento; pendente + resposta → continua Pendente', async () => {
    const t = await open('an2')
    expect((await patch('an2', t.id, { assigned_to_id: uid.an2 })).status).toBe(200)
    expect((await say('an2', t.id, 'Vou verificar a fonte.', 'agent')).status).toBe(201)
    expect((await view(t.id)).status).toBe('in_progress')

    // Mesma ordem da tela "Responder ao Cliente": grava o Pendente e depois envia a resposta.
    expect((await patch('an2', t.id, { status: 'pending', pending_reason: 'pending_parts', note: 'Aguardando fonte nova' })).status).toBe(200)
    expect((await say('an2', t.id, 'Aguardando a fonte nova chegar.', 'agent')).status).toBe(201)
    const p = await view(t.id)
    expect(p.status).toBe('pending')
    expect(p.sla_paused_at).toBeTruthy()

    // Nota interna também não tira de Pendente
    expect((await say('an2', t.id, 'nota de acompanhamento', 'internal')).status).toBe(201)
    expect((await view(t.id)).status).toBe('pending')

    // Como solicitante ele responde: volta para Em Atendimento e despausa o SLA
    expect((await say('an2', t.id, 'A fonte chegou, já troquei.', 'user')).status).toBe(201)
    const back = await view(t.id)
    expect(back.status).toBe('in_progress')
    expect(back.sla_paused_at).toBeFalsy()

    expect((await patch('an2', t.id, RES)).status).toBe(200)
    expect((await view(t.id)).status).toBe('resolved')
  })

  it('chamado do TM vai para um analista da ISA Interna, que resolve; o TM fecha', async () => {
    const t = await open('tm')
    expect((await patch('tm', t.id, { assigned_to_id: uid.an2 })).status).toBe(200)
    expect((await patch('an2', t.id, RES)).status).toBe(200)
    expect((await patch('tm', t.id, { status: 'closed' })).status).toBe(200)
  })

  it('chamado do Gerente: o TM atribui a um analista da ISA Interna', async () => {
    const t = await open('gerente')
    expect((await http('GET', `/api/tickets/${t.id}`, { token: tk.tm })).status).toBe(200)
    expect((await patch('tm', t.id, { assigned_to_id: uid.an2 })).status).toBe(200)
  })

  it('cliente de outra empresa não enxerga o chamado interno', async () => {
    const t = await open('tm')
    expect((await http('GET', `/api/tickets/${t.id}`, { token: tk.acme1 })).status).toBe(403)
  })
})

describe('TM e Gerente atendem como analista', () => {
  it('TM assume e resolve o próprio chamado', async () => {
    const t = await open('tm')
    const r = await patch('tm', t.id, { assigned_to_id: uid.tm, ...RES })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect((await view(t.id)).status).toBe('resolved')
  })

  it('Gerente assume chamado de cliente, põe em pendente, resolve', async () => {
    const t = await open('acme1')
    expect((await patch('gerente', t.id, { assigned_to_id: uid.gerente })).status).toBe(200)
    expect((await patch('gerente', t.id, { status: 'pending', pending_reason: 'pending_user', note: 'Aguardando o print' })).status).toBe(200)
    expect((await say('acme1', t.id, 'Segue o print.', 'user')).status).toBe(201)
    expect((await view(t.id)).status).toBe('in_progress')
    expect((await patch('gerente', t.id, RES)).status).toBe(200)
  })

  it('TM e Gerente não resolvem chamado de outro responsável', async () => {
    const t = await open('acme1')
    expect((await patch('tm', t.id, { assigned_to_id: uid.an1 })).status).toBe(200)
    for (const k of ['tm', 'gerente']) {
      const r = await patch(k, t.id, RES)
      expect(r.status, k).toBe(403)
      expect(r.body.code).toBe('ROLE_CANNOT_RESOLVE')
    }
  })
})
