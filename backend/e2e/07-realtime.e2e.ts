// Socket.IO real (mesmo client do frontend): o que cada papel RECEBE em tempo
// real quando um chamado muda. O REST pode estar certo e o socket vazar.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE, as, http, openTicket } from './helpers'

const req = createRequire(join(__dirname, '..', '..', 'frontend', 'package.json'))
const { io } = req('socket.io-client') as typeof import('socket.io-client')

type Inbox = { sock: any; events: { ev: string; data: any }[] }
const inboxes: Record<string, Inbox> = {}

async function connect(who: any): Promise<Inbox> {
  const sock = io(BASE, { transports: ['websocket'], auth: { token: await as(who) }, forceNew: true })
  const box: Inbox = { sock, events: [] }
  sock.onAny((ev: string, data: any) => box.events.push({ ev, data }))
  await new Promise<void>((res, rej) => { sock.on('connect', () => res()); sock.on('connect_error', rej) })
  await new Promise(r => setTimeout(r, 300)) // entra nas salas de papel/fila após o connect
  inboxes[who] = box
  return box
}
const settle = () => new Promise(r => setTimeout(r, 1500))
const seen = (who: string, needle: string) => inboxes[who].events.filter(e => JSON.stringify(e.data ?? '').includes(needle))

let ids: Record<string, string> = {}
beforeAll(async () => {
  const admin = await as('admin')
  for (const u of (await http('GET', '/api/users?role=agent', { token: admin })).body.data) ids[u.email] = u.id
  for (const who of ['acme1', 'acme2', 'an1', 'an3', 'tm', 'tm2', 'initech1']) await connect(who)
})
afterAll(() => Object.values(inboxes).forEach(b => b.sock.close()))

describe('tempo real', () => {
  it('socket sem token / token inválido é recusado', async () => {
    for (const auth of [{}, { token: 'lixo' }]) {
      const s = io(BASE, { transports: ['websocket'], auth, forceNew: true, reconnection: false })
      const err = await new Promise(r => { s.on('connect_error', e => r(e.message)); s.on('connect', () => r('conectou')) })
      s.close()
      expect(err).not.toBe('conectou')
    }
  })

  it('cliente não entra na sala de chamado de outro cliente (ticket:join)', async () => {
    const t = await openTicket('acme2')
    const ack: any = await new Promise(r => inboxes.acme1.sock.emit('ticket:join', t.id, r))
    expect(ack.ok).toBe(false)
  })

  describe('chamado ACME com nota interna', () => {
    let t: any
    beforeAll(async () => {
      t = await openTicket('acme1')
      await new Promise(r => inboxes.acme1.sock.emit('ticket:join', t.id, r))
      const an1 = await as('an1')
      await http('PATCH', `/api/tickets/${t.id}`, { token: an1, body: { assigned_to_id: ids['analista1.teste@isa.local'] } })
      await http('POST', `/api/tickets/${t.id}/messages`, { token: an1, body: { text: 'NOTA-SOCKET-SECRETA', type: 'internal' } })
      await http('PATCH', `/api/tickets/${t.id}`, { token: an1, body: { priority: 'high' } })
      await settle()
    })

    it('o próprio cliente recebe o chamado atualizado, mas SEM a nota interna', async () => {
      expect(seen('acme1', t.id).length).toBeGreaterThan(0)
      expect(seen('acme1', 'NOTA-SOCKET-SECRETA')).toEqual([])
    })

    it('outro cliente da mesma empresa não recebe nada do chamado', async () => {
      expect(seen('acme2', t.id)).toEqual([])
    })

    it('TM de outra carteira (Initech) não recebe o chamado da ACME', async () => {
      expect(seen('tm2', t.id).map(e => e.ev)).toEqual([])
    })

    it('analista de outra carteira (Initech) não recebe o chamado da ACME', async () => {
      expect(seen('an3', t.id).map(e => e.ev)).toEqual([])
    })

    it('cliente de outra empresa não recebe nada', async () => {
      expect(seen('initech1', t.id)).toEqual([])
    })
  })

  it('analista de outra carteira que compartilha a FILA não recebe chamado de outra empresa', async () => {
    const t = await openTicket('globex1')
    await http('PATCH', `/api/tickets/${t.id}`, { token: await as('tm'), body: { queue: 'geral' } })
    await settle()
    // an3 atende só a Initech, mas está na fila "geral"
    expect(seen('an3', t.id).map(e => e.ev)).toEqual([])
  })

  it('mensagem pública chega em tempo real para o cliente na sala do chamado', async () => {
    const t = await openTicket('acme1')
    await new Promise(r => inboxes.acme1.sock.emit('ticket:join', t.id, r))
    const an1 = await as('an1')
    await http('PATCH', `/api/tickets/${t.id}`, { token: an1, body: { assigned_to_id: ids['analista1.teste@isa.local'] } })
    await http('POST', `/api/tickets/${t.id}/messages`, { token: an1, body: { text: 'RESPOSTA-PUBLICA', type: 'agent' } })
    await settle()
    expect(inboxes.acme1.events.some(e => e.ev === 'ticket:message' && e.data?.text === 'RESPOSTA-PUBLICA')).toBe(true)
  })

  it('socket de usuário desativado é derrubado (ou para de receber)', async () => {
    const admin = await as('admin')
    const users = (await http('GET', '/api/users?role=user', { token: admin })).body.data
    const target = users.find((u: any) => u.email === 'usuario1.initech@isa.local')
    await http('PATCH', `/api/users/${target.id}`, { token: admin, body: { active: false } })
    await settle()
    const stillConnected = inboxes.initech1.sock.connected
    await http('PATCH', `/api/users/${target.id}`, { token: admin, body: { active: true } })
    expect(stillConnected).toBe(false)
  })
})
