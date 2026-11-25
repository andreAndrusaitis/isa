// Tempo real de Documentos no banco de teste, com um Socket.IO falso em memória
// (salas e envio): o fluxo com rede de verdade está em e2e/25-documentos.e2e.ts.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import prisma from '../config/prisma'
import { MAX_UPDATE_BYTES, docFromState, extractText } from '../services/docContent'
import { removeMember, setMember, archiveSpace } from '../services/docSpaces'
import { trashPage } from '../services/docTrash'
import { createVersion, restoreVersion } from '../services/docVersions'
import { movePage, updatePage } from '../services/docPages'
import { flushAllDocs, initDocsRealtime, recheckDocAccess, registerDocHandlers } from './docs'

const S = Date.now()

class Sock {
  id = randomUUID()
  connected = true
  inbox: { ev: string; data: any }[] = []
  handlers = new Map<string, (payload: unknown, ack: unknown) => void>()
  constructor(readonly net: Net, readonly userId: string) {
    net.socks.push(this)
    this.join(`user:${userId}`)
    registerDocHandlers(this as any, userId, async () => true)
  }
  rooms = new Set<string>()
  on(ev: string, fn: any) { this.handlers.set(ev, fn) }
  join(r: string) { (this.rooms ??= new Set()).add(r) }
  leave(r: string) { this.rooms.delete(r) }
  emit(ev: string, data: any) { this.inbox.push({ ev, data }) }
  to(room: string) { return this.net.room(room, this) }
  get local() { return this }
  call(ev: string, payload: unknown): Promise<any> { return new Promise(res => this.handlers.get(ev)!(payload, res)) }
  got(ev: string) { return this.inbox.filter(m => m.ev === ev).map(m => m.data) }
  close() {
    this.connected = false
    this.net.socks = this.net.socks.filter(s => s !== this)
    this.handlers.get('disconnect')!(undefined, undefined)
  }
}
class Net {
  socks: Sock[] = []
  room(room: string, except?: Sock) {
    return { emit: (ev: string, data: any) => { for (const s of this.socks) if (s !== except && s.rooms.has(room)) s.emit(ev, data) } }
  }
  to(room: string) { return this.room(room) }
  get local() { return this }
  of() { return { adapter: {} } }
  on() {}
}

const net = new Net()
initDocsRealtime(net as any)

/** Editor de mentira: um Y.Doc ligado à página como o cliente fará. */
class Client {
  doc = new Y.Doc()
  sock: Sock
  constructor(readonly userId: string, readonly pageId: string) { this.sock = new Sock(net, userId) }
  async join() {
    const r = await this.sock.call('doc:join', { pageId: this.pageId, stateVector: Buffer.from(Y.encodeStateVector(this.doc)) })
    if (r.ok) Y.applyUpdate(this.doc, r.update, 'remote')
    return r
  }
  /** Escreve um parágrafo e devolve a resposta do servidor. */
  async type(text: string) {
    const before = Y.encodeStateVector(this.doc)
    const p = new Y.XmlElement('paragraph')
    const t = new Y.XmlText()
    t.insert(0, text)
    p.insert(0, [t])
    this.doc.getXmlFragment('default').push([p])
    return this.sock.call('doc:update', { pageId: this.pageId, update: Buffer.from(Y.encodeStateAsUpdate(this.doc, before)) })
  }
  pull() {
    for (const m of this.sock.got('doc:update')) Y.applyUpdate(this.doc, m.update, 'remote')
    return extractText(this.doc)
  }
}

const actor = (id: string) => ({ id, role: 'agent' })
let dona = ''
let editora = ''
let leitor = ''
let fora = ''
let space = ''
const newPage = async () => (await prisma.docPage.create({ data: { space_id: space, title: 'P', created_by_id: dona, updated_by_id: dona } })).id
const stored = async (id: string) => prisma.docPage.findUniqueOrThrow({ where: { id } })

beforeAll(async () => {
  const mk = async (n: string, extra = {}) => (await prisma.user.create({ data: { name: n, email: `${n}-${S}@rt.test`, role: 'agent', module_documents: true, ...extra } })).id
  ;[dona, editora, leitor, fora] = [await mk('dona'), await mk('editora'), await mk('leitor'), await mk('fora')]
})
beforeEach(async () => {
  space = (await prisma.docSpace.create({
    data: { name: `RT ${S}`, created_by_id: dona, members: { create: [{ user_id: dona, role: 'owner' }, { user_id: editora, role: 'editor' }, { user_id: leitor, role: 'viewer' }] } },
  })).id
})
afterAll(async () => {
  for (const s of [...net.socks]) s.close()
  await flushAllDocs()
  const ids = [dona, editora, leitor, fora]
  await prisma.docSpace.deleteMany({ where: { created_by_id: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('entrar na página', () => {
  it('cada papel recebe o seu; quem está fora recebe o mesmo de página inexistente', async () => {
    const page = await newPage()
    expect(await new Client(dona, page).join()).toMatchObject({ ok: true, role: 'owner' })
    expect(await new Client(leitor, page).join()).toMatchObject({ ok: true, role: 'viewer' })
    expect(await new Client(fora, page).join()).toEqual({ ok: false, error: 'not_found' })
    expect(await new Client(dona, randomUUID()).join()).toEqual({ ok: false, error: 'not_found' })
    for (const bad of [undefined, null, 'x', { pageId: 3 }, { pageId: '' }, { pageId: 'x'.repeat(100) }]) {
      expect((await new Sock(net, dona).call('doc:join', bad)).ok).toBe(false)
    }
  })

  it('módulo desligado não entra, mesmo sendo membro', async () => {
    const page = await newPage()
    await prisma.user.update({ where: { id: editora }, data: { module_documents: false } })
    expect((await new Client(editora, page).join()).error).toBe('not_found')
    await prisma.user.update({ where: { id: editora }, data: { module_documents: true } })
  })
})

describe('edição', () => {
  it('dois editores convergem, o texto fica gravado e buscável', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    const b = new Client(editora, page)
    await a.join()
    await b.join()
    expect((await Promise.all([a.type('oi da dona'), b.type('oi da editora')])).every(r => r.ok)).toBe(true)
    expect(a.pull()).toBe(b.pull())
    expect(a.pull()).toContain('oi da editora')
    expect(a.sock.got('doc:update')).toHaveLength(1) // não recebe o próprio
    expect(a.sock.got('doc:update')[0].userId).toBe(editora)

    await flushAllDocs()
    const row = await stored(page)
    expect(row.content_text.split('\n').sort()).toEqual(['oi da dona', 'oi da editora'])
    expect(row.revision).toBe(1)
    expect([dona, editora]).toContain(row.updated_by_id)

    const c = new Client(leitor, page)
    await c.join()
    expect(extractText(c.doc)).toBe(a.pull())
  })

  it('grava sozinho depois do atraso, e na saída do último', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    await a.join()
    await a.type('gravou sozinho')
    await vi.waitFor(async () => expect((await stored(page)).content_text).toBe('gravou sozinho'), { timeout: 6000, interval: 200 })
    await a.type('na saída')
    a.sock.close()
    await vi.waitFor(async () => expect((await stored(page)).content_text).toContain('na saída'), { timeout: 5000, interval: 50 })
  })

  it('soma ao que outra instância gravou no meio', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    await a.join()
    const outra = new Y.Doc()
    const p = new Y.XmlElement('paragraph')
    const t = new Y.XmlText()
    t.insert(0, 'de outra instância')
    p.insert(0, [t])
    outra.getXmlFragment('default').push([p])
    await prisma.docPage.update({ where: { id: page }, data: { ydoc: Buffer.from(Y.encodeStateAsUpdate(outra)) } })
    await a.type('daqui')
    await flushAllDocs()
    expect((await stored(page)).content_text.split('\n').sort()).toEqual(['daqui', 'de outra instância'])
  })

  it('reconexão: sincroniza só o que falta, dos dois lados', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    const b = new Client(editora, page)
    await a.join()
    await b.join()
    await a.type('um')
    const r = await b.sock.call('doc:sync', { pageId: page, stateVector: Buffer.from(Y.encodeStateVector(b.doc)) })
    Y.applyUpdate(b.doc, r.update)
    expect(extractText(b.doc)).toBe('um')
    expect(Y.encodeStateAsUpdate(b.doc, r.stateVector).length).toBe(2) // servidor já tem tudo
    expect((await a.sock.call('doc:sync', { pageId: page, stateVector: Buffer.from('lixo') })).ok).toBe(true)
  })

  it('o leitor acompanha e não escreve', async () => {
    const page = await newPage()
    const v = new Client(leitor, page)
    const a = new Client(dona, page)
    await v.join()
    await a.join()
    expect(await v.type('invasão')).toEqual({ ok: false, error: 'forbidden' })
    expect(a.sock.got('doc:update')).toEqual([])
    await a.type('público')
    expect(v.sock.got('doc:update')).toHaveLength(1)
    await flushAllDocs()
    expect((await stored(page)).content_text).toBe('público')
  })

  it('sem entrar, nada passa', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    expect((await a.type('x')).error).toBe('not_joined')
    expect((await a.sock.call('doc:awareness', { pageId: page, update: Buffer.from([1]) })).error).toBe('not_joined')
    expect((await a.sock.call('doc:sync', { pageId: page })).error).toBe('not_joined')
  })

  it('lixo, tipo errado e tamanho acima do limite são recusados sem estragar a página', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    const b = new Client(editora, page)
    await a.join()
    await b.join()
    await a.type('bom')
    const send = (update: unknown) => a.sock.call('doc:update', { pageId: page, update })
    for (const bad of [Buffer.from('lixo lixo lixo'), Buffer.alloc(500, 255), Buffer.from([1, 1, 5]), Buffer.alloc(0), 'texto', { a: 1 }, null, [1, 2]]) {
      expect(await send(bad)).toEqual({ ok: false, error: 'invalid' })
    }
    expect(await send(Buffer.alloc(MAX_UPDATE_BYTES + 1))).toEqual({ ok: false, error: 'too_large' })
    expect(b.sock.got('doc:update')).toHaveLength(1)
    expect((await a.type('continua')).ok).toBe(true)
    await flushAllDocs()
    expect((await stored(page)).content_text).toBe('bom\ncontinua')
  })

  it('página no tamanho máximo recusa crescer', async () => {
    const page = await newPage()
    const big = new Y.Doc()
    big.getText('peso').insert(0, 'x'.repeat(8 * 1024 * 1024 - 200_000))
    await prisma.docPage.update({ where: { id: page }, data: { ydoc: Buffer.from(Y.encodeStateAsUpdate(big)) } })
    const a = new Client(dona, page)
    await a.join()
    expect((await a.type('pequeno')).ok).toBe(true)
    expect((await a.type('y'.repeat(300_000))).error).toBe('too_large')
  })

  it('fragmento de outro tipo não derruba a gravação', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    await a.join()
    const evil = new Y.Doc()
    evil.getMap('default').set('x', '\u0000\ud800')
    expect((await a.sock.call('doc:update', { pageId: page, update: Buffer.from(Y.encodeStateAsUpdate(evil)) })).ok).toBe(true)
    await flushAllDocs()
    expect((await stored(page)).revision).toBe(1)
  })

  it('limita a taxa de updates por conexão', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    await a.join()
    const noop = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))
    const rs = await Promise.all(Array.from({ length: 400 }, () => a.sock.call('doc:update', { pageId: page, update: noop })))
    expect(rs.filter(r => r.error === 'rate_limited').length).toBeGreaterThan(50)
  })
})

describe('presença', () => {
  it('repassa com identidade do servidor, inclusive de leitor, e não grava', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    const v = new Client(leitor, page)
    await a.join()
    await v.join()
    expect(a.sock.got('doc:joined')).toEqual([{ pageId: page, socketId: v.sock.id, userId: leitor }])
    await v.sock.call('doc:awareness', { pageId: page, update: Buffer.from([9]), userId: dona })
    expect(a.sock.got('doc:awareness')).toEqual([{ pageId: page, update: Buffer.from([9]), userId: leitor, socketId: v.sock.id }])
    expect((await v.sock.call('doc:awareness', { pageId: page, update: Buffer.alloc(17 * 1024) })).error).toBe('too_large')
    v.sock.close()
    expect(a.sock.got('doc:left')).toEqual([{ pageId: page, socketId: v.sock.id, userId: leitor }])
    await flushAllDocs()
    expect((await stored(page)).revision).toBe(0)
  })
})

describe('perda de acesso tira da sala na hora', () => {
  it('membro removido', async () => {
    const page = await newPage()
    const b = new Client(editora, page)
    await b.join()
    expect((await b.sock.call('docspace:join', { spaceId: space })).role).toBe('editor')
    await removeMember(actor(dona), space, editora, {})
    expect(b.sock.got('doc:revoked')).toEqual([{ pageId: page, reason: 'access' }])
    expect(b.sock.got('docspace:revoked')).toEqual([{ spaceId: space }])
    expect((await b.type('x')).error).toBe('not_joined')
    expect([...b.sock.rooms]).toEqual([`user:${editora}`])
    expect((await b.join()).error).toBe('not_found')
  })

  it('rebaixado a leitor sai e volta só lendo', async () => {
    const page = await newPage()
    const b = new Client(editora, page)
    await b.join()
    await setMember(actor(dona), space, editora, { role: 'viewer' }, {})
    expect(b.sock.got('doc:revoked')).toEqual([{ pageId: page, reason: 'role', role: 'viewer' }])
    expect((await b.join()).role).toBe('viewer')
    expect((await b.type('x')).error).toBe('forbidden')
  })

  it('página excluída, espaço arquivado e mudança para espaço alheio', async () => {
    const [p1, p2, p3] = [await newPage(), await newPage(), await newPage()]
    const a = new Client(editora, p1)
    await a.join()
    await trashPage(actor(dona), p1, {})
    expect(a.sock.got('doc:revoked')).toEqual([{ pageId: p1, reason: 'deleted' }])

    const other = (await prisma.docSpace.create({ data: { name: 'Só da dona', created_by_id: dona, members: { create: { user_id: dona, role: 'owner' } } } })).id
    const b = new Client(editora, p2)
    const own = new Client(dona, p2)
    await b.join()
    await own.join()
    await movePage(actor(dona), p2, { spaceId: other }, {})
    expect(b.sock.got('doc:revoked')).toEqual([{ pageId: p2, reason: 'moved' }])
    expect(own.sock.got('doc:revoked')).toEqual([])

    const c = new Client(dona, p3)
    await c.join()
    await archiveSpace(actor(dona), space, {})
    expect(c.sock.got('doc:revoked')).toEqual([{ pageId: p3, reason: 'archived' }])
  })

  it('a reconferência pega o módulo desligado por fora', async () => {
    const page = await newPage()
    const v = new Client(leitor, page)
    await v.join()
    await prisma.user.update({ where: { id: leitor }, data: { module_documents: false } })
    await recheckDocAccess({})
    expect(v.sock.got('doc:revoked')).toEqual([{ pageId: page, reason: 'access' }])
    await prisma.user.update({ where: { id: leitor }, data: { module_documents: true } })
  })
})

describe('avisos e versões', () => {
  it('a barra lateral recebe a árvore; quem está fora não entra na sala', async () => {
    const page = await newPage()
    const v = new Client(leitor, page)
    const f = new Client(fora, page)
    await v.sock.call('docspace:join', { spaceId: space })
    expect((await f.sock.call('docspace:join', { spaceId: space })).ok).toBe(false)
    await v.join()
    await updatePage(actor(dona), page, { title: 'Novo nome' })
    expect(v.sock.got('doc:tree')).toEqual([expect.objectContaining({ spaceId: space, type: 'updated', pageId: page, title: 'Novo nome' })])
    expect(v.sock.got('doc:meta')).toEqual([{ pageId: page, title: 'Novo nome', icon: null }])
    expect(f.sock.inbox).toEqual([])
  })

  it('versão automática guarda o estado anterior e respeita o intervalo', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    await a.join()
    await a.type('ontem')
    await flushAllDocs()
    expect(await prisma.docPageVersion.count({ where: { page_id: page } })).toBe(0)
    await prisma.docPage.update({ where: { id: page }, data: { created_at: new Date(Date.now() - 3600_000) } })
    await a.type('hoje')
    await flushAllDocs()
    await a.type('agora')
    await flushAllDocs()
    const versions = await prisma.docPageVersion.findMany({ where: { page_id: page } })
    expect(versions).toHaveLength(1)
    expect(versions[0].label).toBeNull()
    expect(extractText(docFromState(versions[0].ydoc))).toBe('ontem')
  })

  it('restaurar chega a quem está editando', async () => {
    const page = await newPage()
    const a = new Client(dona, page)
    await a.join()
    await a.type('original')
    const v = await createVersion(actor(dona), page, { label: 'boa' })
    await a.type('estrago')
    await restoreVersion(actor(editora), page, v.id)
    expect(a.pull()).toBe('original')
    expect((await stored(page)).content_text).toBe('original')
    await a.type('segue')
    expect(a.pull()).toBe('original\nsegue')
  })
})
