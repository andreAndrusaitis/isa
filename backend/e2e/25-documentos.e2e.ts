// Documentos de ponta a ponta: módulo, espaço compartilhado, coedição com Socket.IO
// de verdade, leitor sem escrita, busca, versões e perda de acesso na hora.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BASE, PNG, U, as, http, login, uid } from './helpers'

const req = createRequire(join(__dirname, '..', '..', 'frontend', 'package.json'))
const { io } = req('socket.io-client') as typeof import('socket.io-client')

const QUEM = ['gerente', 'tm', 'an1', 'an2'] as const
const ids: Record<string, string> = {}
const socks: any[] = []
let space = ''
let page = ''

async function editor(who: keyof typeof U) {
  const sock: any = io(BASE, { transports: ['websocket'], auth: { token: await as(who) }, forceNew: true })
  socks.push(sock)
  const doc = new Y.Doc()
  const revoked: any[] = []
  const trees: any[] = []
  sock.on('doc:update', (m: any) => Y.applyUpdate(doc, new Uint8Array(m.update)))
  sock.on('doc:revoked', (m: any) => revoked.push(m))
  sock.on('doc:tree', (m: any) => trees.push(m))
  // Entra sem esperar nada depois do connect: o servidor precisa já estar ouvindo.
  const joined: any = await new Promise(res => sock.on('connect', () => sock.emit('doc:join', { pageId: page, stateVector: Y.encodeStateVector(doc) }, res)))
  if (joined.ok) Y.applyUpdate(doc, new Uint8Array(joined.update))
  const call = (ev: string, payload: object): Promise<any> => new Promise(res => sock.emit(ev, payload, res))
  return {
    sock, doc, joined, revoked, trees, call,
    type: (text: string) => {
      const before = Y.encodeStateVector(doc)
      const p = new Y.XmlElement('paragraph')
      const t = new Y.XmlText()
      t.insert(0, text)
      p.insert(0, [t])
      doc.getXmlFragment('default').push([p])
      return call('doc:update', { pageId: page, update: Y.encodeStateAsUpdate(doc, before) })
    },
    text: () => doc.getXmlFragment('default').toString(),
  }
}
const until = async (fn: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 80; i++) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)) }
  return false
}

beforeAll(async () => {
  const admin = await as('admin')
  for (const q of QUEM) {
    ids[q] = (await login(U[q])).user.id
    expect((await http('PATCH', `/api/users/${ids[q]}`, { token: admin, body: { module_documents: true } })).status).toBe(200)
  }
})
afterAll(async () => {
  socks.forEach(s => s.close())
  const admin = await as('admin')
  for (const q of QUEM) await http('PATCH', `/api/users/${ids[q]}`, { token: admin, body: { module_documents: null } })
})

describe('documentos', () => {
  it('cliente e quem está sem o módulo não entram', async () => {
    expect((await http('GET', '/api/docs/spaces', { token: await as('acme1') })).status).toBe(403)
    const admin = await as('admin')
    const id = (await login(U.an3)).user.id
    await http('PATCH', `/api/users/${id}`, { token: admin, body: { module_documents: false } })
    expect((await http('GET', '/api/docs/spaces', { token: await as('an3') })).status).toBe(403)
    await http('PATCH', `/api/users/${id}`, { token: admin, body: { module_documents: null } })
  })

  it('espaço compartilhado com página aninhada', async () => {
    const token = await as('gerente')
    space = (await http('POST', '/api/docs/spaces', { token, body: { name: `E2E ${uid()}`, icon: '🧪' } })).body.data.id
    expect((await http('PUT', `/api/docs/spaces/${space}/members/${ids.tm}`, { token, body: { role: 'editor' } })).status).toBe(200)
    expect((await http('PUT', `/api/docs/spaces/${space}/members/${ids.an1}`, { token, body: { role: 'viewer' } })).status).toBe(200)
    const root = (await http('POST', `/api/docs/spaces/${space}/pages`, { token, body: { title: 'Raiz' } })).body.data.id
    const created = await http('POST', `/api/docs/spaces/${space}/pages`, { token, body: { title: 'Ata', parentId: root } })
    expect(created.status).toBe(201)
    page = created.body.data.id
    expect((await http('GET', `/api/docs/pages/${page}`, { token: await as('tm') })).body.data.breadcrumb).toEqual([{ id: root, title: 'Raiz', icon: null }])
    expect((await http('GET', `/api/docs/pages/${page}`, { token: await as('an2') })).status).toBe(404)
  })

  it('coedição em tempo real; leitor só acompanha; quem está fora não entra', async () => {
    const a = await editor('gerente')
    const b = await editor('tm')
    const v = await editor('an1')
    const x = await editor('an2')
    expect([a.joined.role, b.joined.role, v.joined.role]).toEqual(['owner', 'editor', 'viewer'])
    expect(x.joined).toEqual({ ok: false, error: 'not_found' })

    const word = `Girafa${uid()}`
    expect((await Promise.all([a.type(`${word} da gerente`), b.type('linha do tm')])).map(r => r.ok)).toEqual([true, true])
    expect(await until(() => a.text() === b.text() && v.text() === a.text() && a.text().includes('linha do tm'))).toBe(true)
    expect(await v.type('invasão')).toEqual({ ok: false, error: 'forbidden' })
    expect((await a.call('doc:update', { pageId: page, update: new Uint8Array([9, 9, 9]) })).ok).toBe(false)
    expect(a.text()).not.toContain('invasão')

    // Gravado e buscável, só para quem entra no espaço.
    const search = async (who: keyof typeof U) => (await http('GET', `/api/docs/search?q=${word}`, { token: await as(who) })).body.data
    expect(await until(async () => (await search('an1')).length === 1)).toBe(true)
    expect(await search('an2')).toEqual([])

    // Versão, estrago, restauração: chega a quem está com a página aberta.
    const token = await as('tm')
    const version = (await http('POST', `/api/docs/pages/${page}/versions`, { token, body: { label: 'Boa' } })).body.data
    await b.type('estrago')
    expect((await http('POST', `/api/docs/pages/${page}/versions/${version.id}/restore`, { token })).status).toBe(200)
    expect(await until(() => !a.text().includes('estrago') && a.text().includes(word))).toBe(true)
    const bin = await fetch(`${BASE}/api/docs/versions/${version.id}/ydoc`, { headers: { authorization: `Bearer ${token}` } })
    expect(bin.headers.get('content-type')).toBe('application/octet-stream')
    const restored = new Y.Doc()
    Y.applyUpdate(restored, new Uint8Array(await bin.arrayBuffer()))
    expect(restored.getXmlFragment('default').toString()).toContain(word)

    // Perde o acesso com a página aberta.
    expect((await http('DELETE', `/api/docs/spaces/${space}/members/${ids.tm}`, { token: await as('gerente') })).status).toBe(204)
    expect(await until(() => b.revoked.length === 1)).toBe(true)
    expect(b.revoked[0]).toEqual({ pageId: page, reason: 'access' })
    expect((await b.type('depois')).ok).toBe(false)
  })

  it('anexo segue o acesso da página', async () => {
    const token = await as('gerente')
    const att = await http('POST', `/api/docs/pages/${page}/attachments`, { token, body: { filename: 'foto.png', dataUri: PNG } })
    expect(att.status).toBe(201)
    expect((await http('GET', `/api/docs/attachments/${att.body.data.id}`, { token: await as('an1') })).status).toBe(200)
    expect((await http('GET', `/api/docs/attachments/${att.body.data.id}`, { token: await as('an2') })).status).toBe(404)
    const svg = await http('POST', `/api/docs/pages/${page}/attachments`, { token, body: { filename: 'x.svg', dataUri: 'data:image/svg+xml;base64,PHN2Zy8+' } })
    expect(svg.status).toBe(400)
  })

  it('excluir tira quem está na página; restaurar devolve', async () => {
    const v = await editor('an1')
    const token = await as('gerente')
    expect((await http('DELETE', `/api/docs/pages/${page}`, { token })).status).toBe(204)
    expect(await until(() => v.revoked.length === 1)).toBe(true)
    expect(v.revoked[0].reason).toBe('deleted')
    expect((await http('POST', `/api/docs/pages/${page}/restore`, { token })).status).toBe(200)
    expect((await http('GET', `/api/docs/pages/${page}`, { token: await as('an1') })).status).toBe(200)
  })
})
