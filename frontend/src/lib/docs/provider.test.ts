import * as Y from 'yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ socket: null as any }))
vi.mock('@/services/socketService', () => ({ connectSocket: () => h.socket }))
import { DocProvider, caretColor } from './provider'

/** Servidor de mentira: um Y.Doc e o protocolo do realtime. */
function fakeServer(role = 'editor') {
  const doc = new Y.Doc()
  const handlers: Record<string, ((m: any) => void)[]> = {}
  const sent: { event: string; payload: any }[] = []
  const state = { role, fail: null as string | null }
  h.socket = {
    connected: true,
    on: (e: string, f: any) => { (handlers[e] ??= []).push(f) },
    off: (e: string, f: any) => { handlers[e] = (handlers[e] ?? []).filter(x => x !== f) },
    emit: (event: string, payload: any, ack?: (a: any) => void) => {
      sent.push({ event, payload })
      if (event === 'doc:join' || event === 'doc:sync') ack?.(state.fail ? { ok: false, error: state.fail } : { ok: true, role: state.role, update: Y.encodeStateAsUpdate(doc, payload.stateVector), stateVector: Y.encodeStateVector(doc) })
      if (event === 'doc:update') {
        if (state.fail) { ack?.({ ok: false, error: state.fail }); return }
        Y.applyUpdate(doc, payload.update)
        ack?.({ ok: true })
      }
    },
  }
  return { doc, sent, state, fire: (e: string, m?: any) => (handlers[e] ?? []).forEach(f => f(m)), count: () => Object.values(handlers).flat().length }
}

describe('DocProvider', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('recebe o conteúdo ao entrar e envia o que é escrito', () => {
    const s = fakeServer()
    s.doc.getText('t').insert(0, 'olá')
    const p = new DocProvider('p1', 'tok', () => {})
    expect(p.status).toBe('synced')
    expect(p.doc.getText('t').toString()).toBe('olá')
    p.doc.getText('t').insert(3, ' mundo')
    expect(s.doc.getText('t').toString()).toBe('olá mundo')
    expect(p.pending).toBe(0)
    p.destroy()
  })

  it('o que foi escrito sem conexão sobe ao reconectar', () => {
    const s = fakeServer()
    const p = new DocProvider('p1', 'tok', () => {})
    h.socket.connected = false
    s.fire('disconnect')
    expect(p.status).toBe('offline')
    p.doc.getText('t').insert(0, 'offline')
    expect(s.doc.getText('t').toString()).toBe('')
    h.socket.connected = true
    s.fire('connect')
    expect(s.doc.getText('t').toString()).toBe('offline')
    expect(p.status).toBe('synced')
    expect(p.pending).toBe(0)
    p.destroy()
  })

  it('recusa por excesso não perde texto: reenvia na sincronização', () => {
    const s = fakeServer()
    const p = new DocProvider('p1', 'tok', () => {})
    s.state.fail = 'rate_limited'
    p.doc.getText('t').insert(0, 'rápido demais')
    expect(p.pending).toBe(1)
    s.state.fail = null
    vi.advanceTimersByTime(2000)
    expect(s.doc.getText('t').toString()).toBe('rápido demais')
    expect(p.pending).toBe(0)
    p.destroy()
  })

  it('recusa definitiva não fica tentando para sempre', () => {
    const s = fakeServer()
    const p = new DocProvider('p1', 'tok', () => {})
    s.state.fail = 'too_large'
    p.doc.getText('t').insert(0, 'enorme')
    const sent = s.sent.length
    vi.advanceTimersByTime(20_000)
    expect(p.rejected).toBe(true)
    expect(s.sent.length).toBe(sent)
    p.destroy()
  })

  it('leitor não envia nada ao sincronizar', () => {
    const s = fakeServer('viewer')
    const p = new DocProvider('p1', 'tok', () => {})
    expect(p.role).toBe('viewer')
    expect(s.sent.some(x => x.event === 'doc:update')).toBe(false)
    p.destroy()
  })

  it('perda de acesso encerra; troca de papel entra de novo', () => {
    const s = fakeServer()
    const p = new DocProvider('p1', 'tok', () => {})
    s.state.role = 'viewer'
    s.fire('doc:revoked', { pageId: 'p1', reason: 'role' })
    expect([p.status, p.role]).toEqual(['synced', 'viewer'])
    s.fire('doc:revoked', { pageId: 'outra', reason: 'deleted' })
    expect(p.status).toBe('synced')
    s.fire('doc:revoked', { pageId: 'p1', reason: 'deleted' })
    expect(p.status).toBe('revoked')
    p.destroy()
    expect(s.count()).toBe(0)
  })

  it('cor da pessoa é estável', () => {
    expect(caretColor('u1')).toBe(caretColor('u1'))
    expect(caretColor('u1')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
