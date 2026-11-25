// Editar/apagar mensagens de outras pessoas é opção da ficha (área edit_messages).
// TM vem com ela ligada; a ficha liga para quem precisar e desliga de um TM.
// O admin olha os chamados e não modera mensagens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PASS, U, as, http, login, openTicket } from './helpers'

const id: Record<string, string> = {}
const saved: Record<string, string[]> = {}
let ticket: any
let msgId: string

const token = async (who: keyof typeof U) =>
  (await http('POST', '/api/auth/login', { body: { email: U[who], password: PASS } })).body.data.accessToken as string
const setPerms = async (who: string, permissions: string[]) =>
  http('PATCH', `/api/users/${id[who]}`, { token: await as('admin'), body: { permissions } })
const edit = async (who: keyof typeof U, text: string) =>
  http('PATCH', `/api/tickets/${ticket.id}/messages/${msgId}`, { token: await token(who), body: { text } })

beforeAll(async () => {
  for (const k of ['tm', 'an1', 'an2'] as const) {
    const s = await login(U[k])
    id[k] = s.user.id
    saved[k] = (await http('GET', `/api/users/${s.user.id}`, { token: await as('admin') })).body.data.permissions ?? []
  }
  ticket = await openTicket('acme1')
  const r = await http('POST', `/api/tickets/${ticket.id}/messages`, { token: await as('an1'), body: { text: 'Mensagem do analista', type: 'internal' } })
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status)
  msgId = r.body.data.id
})

afterAll(async () => {
  for (const k of ['tm', 'an2']) await setPerms(k, saved[k])
})

describe('moderar mensagens de outras pessoas', () => {
  it('TM edita mensagem do analista (padrão do cargo)', async () => {
    const r = await edit('tm', 'Corrigida pelo TM')
    expect(r.status, JSON.stringify(r.body)).toBe(200)
  })

  it('analista sem a opção não edita mensagem de colega', async () => {
    const r = await edit('an2', 'Tentativa')
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('MESSAGE_NOT_OWNER')
  })

  it('ficha liga a opção para um analista', async () => {
    expect((await setPerms('an2', ['orgs', 'users', 'edit_messages'])).status).toBe(200)
    expect((await edit('an2', 'Corrigida pela analista com a opção')).status).toBe(200)
  })

  it('ficha desliga a opção de um TM', async () => {
    expect((await setPerms('tm', ['dash_main', 'survey_dashboard', 'organograma', 'categories', 'queues', 'macros', 'audit', 'orgs', 'users'])).status).toBe(200)
    const r = await edit('tm', 'TM sem a opção')
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('MESSAGE_NOT_OWNER')
  })

  it('admin olha e não modera', async () => {
    expect((await edit('admin', 'Admin editando')).status).toBe(403)
    expect((await http('DELETE', `/api/tickets/${ticket.id}/messages/${msgId}`, { token: await token('admin') })).status).toBe(403)
  })

  it('a sessão informa a opção', async () => {
    const s = await http('POST', '/api/auth/login', { body: { email: U.an2, password: PASS } })
    expect(s.body.data.user.capabilities).toContain('tickets.messages.moderate')
  })
})
