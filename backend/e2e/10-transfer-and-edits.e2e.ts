// Transferência por regra de escalonamento + edição de empresas/usuários sem trava de admin.
// Cenário: an1 (só ACME, fila geral) pede ajuda à Mesa Especializada; an3 (só Initech,
// fila especializada) atua no chamado da ACME sem ter a ACME na carteira.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { U, PROVISORIA, as, http, trocarProvisoria, login, openTicket, orgs, uid } from './helpers'

let O: Awaited<ReturnType<typeof orgs>>
let ruleId: string
let ticket: any
let an1Id: string
let an3Id: string

beforeAll(async () => {
  O = await orgs()
  an1Id = (await login(U.an1)).user.id
  an3Id = (await login(U.an3)).user.id
  const r = await http('POST', '/api/escalation', {
    token: await as('admin'),
    body: { name: `Transferir Mesa ${uid()}`, type: 'transfer', target_queue_id: 'especializada' },
  })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  ruleId = r.body.data.id
  ticket = await openTicket('acme1')
})

afterAll(async () => {
  if (ruleId) await http('DELETE', `/api/escalation/${ruleId}`, { token: await as('admin') })
})

const get = async (who: any) => (await http('GET', `/api/tickets/${ticket.id}`, { token: await as(who) }))

describe('escalonamento por transferência', () => {
  it('regra de transferência sem fila é recusada', async () => {
    const r = await http('POST', '/api/escalation', { token: await as('admin'), body: { name: 'sem fila', type: 'transfer' } })
    expect(r.status).toBe(400)
  })

  it('antes: Mesa (an3) não vê o chamado da ACME', async () => {
    expect((await get('an3')).status).toBe(403)
  })

  it('an1 assume e transfere; o chamado sai dele e vai sem responsável para a Mesa', async () => {
    const a = await http('PATCH', `/api/tickets/${ticket.id}`, { token: await as('an1'), body: { assigned_to_id: an1Id } })
    expect(a.status, JSON.stringify(a.body)).toBe(200)

    const r = await http('POST', `/api/tickets/${ticket.id}/escalate`, { token: await as('an1'), body: { ruleId } })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.type).toBe('transfer')
    expect(r.body.data.ticket.queue).toBe('especializada')
    expect(r.body.data.ticket.escalated).toBe(true)
    expect(r.body.data.ticket.assignedToId ?? null).toBeNull()
  })

  it('an1 perde o acesso (sem acompanhar)', async () => {
    expect((await get('an1')).status).toBe(403)
  })

  it('an3 vê na lista, abre, assume, altera e resolve sem ter a ACME na carteira', async () => {
    const list = await http('GET', '/api/tickets?page=1&pageSize=100', { token: await as('an3') })
    expect(list.body.data.map((t: any) => t.id)).toContain(ticket.id)
    expect((await get('an3')).status).toBe(200)

    const take = await http('PATCH', `/api/tickets/${ticket.id}`, { token: await as('an3'), body: { assigned_to_id: an3Id } })
    expect(take.status, JSON.stringify(take.body)).toBe(200)
    const pr = await http('PATCH', `/api/tickets/${ticket.id}`, { token: await as('an3'), body: { priority: 'high' } })
    expect(pr.status, JSON.stringify(pr.body)).toBe(200)
    const msg = await http('POST', `/api/tickets/${ticket.id}/messages`, { token: await as('an3'), body: { text: 'Mesa atuando', type: 'internal' } })
    expect([200, 201]).toContain(msg.status)
    const res = await http('PATCH', `/api/tickets/${ticket.id}`, { token: await as('an3'), body: { status: 'resolved', resolution_details: 'Resolvido pela Mesa Especializada' } })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.status).toBe('resolved')
  })

  it('linha do tempo registra a transferência', async () => {
    const msgs = await http('GET', `/api/tickets/${ticket.id}/messages`, { token: await as('an3') })
    const texts = (msgs.body.data as any[]).map(m => m.text ?? '')
    expect(texts.some(t => t.includes('[ESCALONAMENTO]') && t.includes('Transferência'))).toBe(true)
  })
})

describe('empresas e usuários: Analista/TM/Gerente editam sem trava de admin', () => {
  it('an1 edita usuário da ACME (carteira), inclusive método de login SSO', async () => {
    const target = (await login(U.acme2)).user.id
    const sso = await http('PATCH', `/api/users/${target}`, { token: await as('an1'), body: { position: 'Teste E2E', authProvider: 'microsoft' } })
    expect(sso.status, JSON.stringify(sso.body)).toBe(200)
    const back = await http('PATCH', `/api/users/${target}`, { token: await as('an1'), body: { authProvider: 'local', password: PROVISORIA } })
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    await trocarProvisoria(U.acme2)
  })

  it('an1 não edita usuário de empresa fora da carteira (Globex)', async () => {
    const target = (await login(U.globex1)).user.id
    const r = await http('PATCH', `/api/users/${target}`, { token: await as('an1'), body: { position: 'x' } })
    expect(r.status).toBe(403)
  })

  it('an1 edita a empresa e gerencia domínios SSO da ACME', async () => {
    const p = await http('PATCH', `/api/organizations/${O.acme.id}`, { token: await as('an1'), body: { name: O.acme.name } })
    expect(p.status, JSON.stringify(p.body)).toBe(200)
    const domain = `e2e-${uid()}.com`
    const c = await http('POST', `/api/organizations/${O.acme.id}/authorized-domains`, { token: await as('an1'), body: { domain } })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const d = await http('DELETE', `/api/organizations/${O.acme.id}/authorized-domains/${c.body.data.id}`, { token: await as('an1') })
    expect([200, 204]).toContain(d.status)
  })

  it('gerente cria cliente e depois troca perfil, empresa e login (antes descartado em silêncio)', async () => {
    const email = `e2e-${uid()}@isa.local`
    const c = await http('POST', '/api/users', { token: await as('gerente'), body: { name: 'E2E Edição', email, password: 'Teste@123', role: 'user', org_id: O.acme.id } })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const id = c.body.data.id
    const u = await http('PATCH', `/api/users/${id}`, { token: await as('gerente'), body: { role: 'agent', org_id: O.globex.id, authProvider: 'microsoft' } })
    expect(u.status, JSON.stringify(u.body)).toBe(200)
    const after = await http('GET', `/api/users/${id}`, { token: await as('gerente') })
    expect(after.body.data.role).toBe('agent')
    expect(after.body.data.org_id ?? after.body.data.orgId).toBe(O.globex.id)
    expect(after.body.data.auth_provider ?? after.body.data.authProvider).toBe('microsoft')
    await http('DELETE', `/api/users/${id}`, { token: await as('gerente') })
  })

  it('TM não promove a Gerente', async () => {
    const email = `e2e-${uid()}@isa.local`
    const c = await http('POST', '/api/users', { token: await as('tm'), body: { name: 'E2E TM', email, password: 'Teste@123', role: 'user', org_id: O.acme.id } })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const r = await http('PATCH', `/api/users/${c.body.data.id}`, { token: await as('tm'), body: { role: 'manager' } })
    expect(r.status).toBe(403)
    await http('DELETE', `/api/users/${c.body.data.id}`, { token: await as('tm') })
  })
})
