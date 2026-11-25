// Concorrência real: vários clientes abrindo ao mesmo tempo, dois analistas
// disputando o mesmo chamado, rajada de mensagens. É o cenário de segunda 9h.
import { describe, expect, it } from 'vitest'
import { as, http, openTicket } from './helpers'

describe('concorrência', () => {
  it('20 aberturas simultâneas: todas 201 e todos os ids distintos', async () => {
    const tokens = await Promise.all((['acme1', 'acme2', 'globex1', 'initech1'] as const).map(w => as(w)))
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      http('POST', '/api/tickets', { token: tokens[i % 4], body: { title: `concorrente ${i}`, description: 'rajada' } })))
    const statuses = rs.map(r => r.status)
    expect(statuses.filter(s => s !== 201)).toEqual([])
    const ids = rs.map(r => r.body.data.id)
    expect(new Set(ids).size).toBe(20)
  })

  it('dois analistas assumindo o mesmo chamado ao mesmo tempo: um só fica responsável e o histórico é coerente', async () => {
    const t = await openTicket('acme2' as any)
    const admin = await as('admin')
    const staff = (role: string) => http('GET', `/api/users?role=${role}`, { token: admin }).then(r => r.body.data)
    const a1 = (await staff('agent')).find((u: any) => u.email === 'analista1.teste@isa.local').id
    const tm = (await staff('supervisor')).find((u: any) => u.email === 'tm.teste@isa.local').id
    // an1 se autoatribui enquanto o TM assume ao mesmo tempo — os dois são responsáveis
    // válidos (chamado da ACME cai na Fila VIP: só an1 e TM a atendem).
    const [r1, r2] = await Promise.all([
      http('PATCH', `/api/tickets/${t.id}`, { token: await as('an1'), body: { assigned_to_id: a1 } }),
      http('PATCH', `/api/tickets/${t.id}`, { token: await as('tm'), body: { assigned_to_id: tm } }),
    ])
    expect([r1.status, r2.status].every(s => s < 500)).toBe(true)
    // Lê como gerente: o TM costuma chegar aqui perto do limite de 500 req/15 min da varredura.
    const read = await http('GET', `/api/tickets/${t.id}`, { token: await as('gerente') })
    expect(read.status, JSON.stringify(read.body)).toBe(200)
    const final = read.body.data
    expect([a1, tm]).toContain(final.assigned_to_id)
    const assignEvents = final.events.filter((e: any) => /respons/i.test(e.note ?? ''))
    // O último evento de atribuição deve apontar para quem realmente ficou
    expect(assignEvents[0].note).toContain(final.assigned_to?.name)
  })

  it('rajada de 15 mensagens simultâneas no mesmo chamado: nenhuma se perde', async () => {
    const t = await openTicket('acme1')
    const tok = await as('acme1')
    const rs = await Promise.all(Array.from({ length: 15 }, (_, i) =>
      http('POST', `/api/tickets/${t.id}/messages`, { token: tok, body: { text: `msg ${i}` } })))
    expect(rs.filter(r => r.status !== 201).map(r => r.status)).toEqual([])
    const msgs = (await http('GET', `/api/tickets/${t.id}/messages`, { token: tok })).body.data
    expect(msgs.filter((m: any) => /^msg \d+$/.test(m.text)).length).toBe(15)
  })

  it('resolver duas vezes em paralelo não duplica pesquisa de satisfação', async () => {
    const t = await openTicket('acme1')
    const admin = await as('admin')
    const a1 = (await http('GET', '/api/users?role=agent', { token: admin })).body.data.find((u: any) => u.email === 'analista1.teste@isa.local').id
    const an1 = await as('an1')
    await http('PATCH', `/api/tickets/${t.id}`, { token: an1, body: { assigned_to_id: a1 } })
    const body = { status: 'resolved', resolution_details: 'Resolvido em paralelo duas vezes' }
    const rs = await Promise.all([1, 2].map(() => http('PATCH', `/api/tickets/${t.id}`, { token: an1, body })))
    expect(rs.every(r => r.status < 500)).toBe(true)
    const final = (await http('GET', `/api/tickets/${t.id}`, { token: an1 })).body.data
    expect(final.events.filter((e: any) => e.to_status === 'resolved' && e.from_status !== 'resolved').length).toBe(1)
  })
})
