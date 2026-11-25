// Lixeira (soft delete/restaurar/expurgar), pesquisa de satisfação pública e
// notificações — fluxos que cruzam vários módulos.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, http, openTicket } from './helpers'

let ids: Record<string, string> = {}
beforeAll(async () => {
  const admin = await as('admin')
  for (const role of ['agent', 'user']) for (const u of (await http('GET', `/api/users?role=${role}`, { token: admin })).body.data) ids[u.email] = u.id
})

async function resolved(who: 'acme1' | 'initech1' = 'acme1') {
  const t = await openTicket(who)
  const [ag, email] = who === 'acme1' ? ['an1', 'analista1.teste@isa.local'] : ['an3', 'analista3.teste@isa.local']
  const tok = await as(ag as any)
  await http('PATCH', `/api/tickets/${t.id}`, { token: tok, body: { assigned_to_id: ids[email] } })
  const r = await http('PATCH', `/api/tickets/${t.id}`, { token: tok, body: { status: 'resolved', resolution_details: 'Resolvido para o teste E2E' } })
  if (r.status !== 200) throw new Error(`resolver → ${r.status} ${JSON.stringify(r.body)}`)
  return t
}

describe('lixeira', () => {
  it('sem a permissão "Excluir chamados" ninguém além do admin exclui', async () => {
    const t = await openTicket('acme1')
    for (const who of ['tm', 'gerente', 'an1'] as const) {
      expect((await http('DELETE', `/api/tickets/${t.id}`, { token: await as(who) })).status).toBe(403)
    }
    expect((await http('DELETE', `/api/tickets/${t.id}`, { token: await as('acme1') })).status).toBe(403)
  })

  it('excluído some de todo lugar (detalhe, listas, API externa) e volta ao restaurar', async () => {
    const t = await openTicket('acme1')
    const admin = await as('admin')
    expect((await http('DELETE', `/api/tickets/${t.id}`, { token: admin })).status).toBe(204)
    expect((await http('GET', `/api/tickets/${t.id}`, { token: await as('tm') })).status).toBe(404)
    expect((await http('GET', `/api/tickets/${t.id}`, { token: await as('acme1') })).status).toBe(404)
    const list = await http('GET', `/api/tickets?page=1&ids=${t.id}`, { token: await as('tm') })
    expect(list.body.data).toEqual([])
    expect((await http('POST', `/api/tickets/${t.id}/messages`, { token: await as('acme1'), body: { text: 'oi' } })).status).toBe(404)
    const trash = await http('GET', '/api/tickets/trash', { token: admin })
    expect(JSON.stringify(trash.body)).toContain(t.id)
    expect((await http('POST', `/api/tickets/${t.id}/restore`, { token: admin })).status).toBeLessThan(300)
    expect((await http('GET', `/api/tickets/${t.id}`, { token: await as('acme1') })).status).toBe(200)
  })

  it('expurgo definitivo não reaproveita o número do chamado', async () => {
    const admin = await as('admin')
    const a = await openTicket('acme1')
    await http('DELETE', `/api/tickets/${a.id}`, { token: admin })
    expect((await http('DELETE', `/api/tickets/${a.id}/permanent`, { token: admin })).status).toBeLessThan(300)
    const b = await openTicket('acme1')
    expect(b.id).not.toBe(a.id)
  })

  it('expurgar chamado que NÃO está na lixeira é recusado', async () => {
    const t = await openTicket('acme1')
    const r = await http('DELETE', `/api/tickets/${t.id}/permanent`, { token: await as('admin') })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect((await http('GET', `/api/tickets/${t.id}`, { token: await as('acme1') })).status).toBe(200)
  })

  it('só admin mexe na configuração da lixeira', async () => {
    for (const who of ['gerente', 'tm', 'an1', 'acme1'] as const) {
      expect((await http('PUT', '/api/tickets/trash/config', { token: await as(who), body: { retention_days: 1 } })).status).toBe(403)
    }
  })
})

describe('pesquisa de satisfação', () => {
  // Fora do escopo por decisão do time (doc de bugs): link da pesquisa sem controle de acesso.
  it.skip('cliente não obtém o link de pesquisa de chamado de OUTRA empresa', async () => {
    const t = await resolved('initech1')
    const r = await http('GET', `/api/tickets/${t.id}/survey-link`, { token: await as('acme1') })
    expect(r.status).toBe(403)
  })

  it('token público inválido → 404; resposta enviada duas vezes é recusada', async () => {
    expect((await http('GET', '/api/survey/public/nao-existe')).status).toBe(404)
    const t = await resolved('acme1')
    const link = await http('GET', `/api/tickets/${t.id}/survey-link`, { token: await as('acme1') })
    const token = link.body.data.token
    const survey = await http('GET', `/api/survey/public/${token}`)
    expect(survey.status).toBe(200)
    const qs = survey.body.data?.template?.questions ?? survey.body.data?.questions ?? []
    const answers = qs.map((q: any) => ({ question_id: q.id, valor_numero: 5, valor_texto: 'ótimo', valores_opcao: q.options?.length ? [q.options[0].id ?? q.options[0].value] : undefined }))
    const first = await http('POST', `/api/survey/public/${token}`, { body: { answers } })
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    const again = await http('POST', `/api/survey/public/${token}`, { body: { answers } })
    expect(again.status).toBeGreaterThanOrEqual(400)
    expect(again.status).toBeLessThan(500)
  })

  it('página pública da pesquisa não expõe e-mail/dados internos', async () => {
    const t = await resolved('acme1')
    const token = (await http('GET', `/api/tickets/${t.id}/survey-link`, { token: await as('acme1') })).body.data.token
    const s = JSON.stringify((await http('GET', `/api/survey/public/${token}`)).body)
    expect(s).not.toMatch(/@n1\.local/)
    expect(s).not.toMatch(/"password"|sla_config|internal/)
  })
})

describe('notificações', () => {
  it('cada um só vê e marca as próprias', async () => {
    const t = await openTicket('acme1')
    await http('PATCH', `/api/tickets/${t.id}`, { token: await as('tm'), body: { assigned_to_id: ids['analista1.teste@isa.local'] } })
    const mine = await http('GET', '/api/notifications', { token: await as('an1') })
    const n = (mine.body.data ?? mine.body).find((x: any) => (x.ticket_id ?? x.ticketId) === t.id)
    expect(n).toBeTruthy()
    const other = await http('PATCH', `/api/notifications/${n.id}/read`, { token: await as('acme2') })
    expect(other.status).toBeLessThan(500)
    const after = await http('GET', '/api/notifications', { token: await as('an1') })
    expect((after.body.data ?? after.body).find((x: any) => x.id === n.id)).toBeTruthy()
  })

  it('notificação de chamado novo não chega a analista fora da carteira', async () => {
    const t = await openTicket('initech1')
    await new Promise(r => setTimeout(r, 800))
    for (const who of ['an1', 'an2' as any]) {
      const r = await http('GET', '/api/notifications', { token: await as(who) })
      expect(JSON.stringify(r.body)).not.toContain(t.id)
    }
  })
})
