import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import type { Socket } from 'socket.io-client'
import { connectSocket } from '@/services/socketService'
import type { SpaceRole } from '@/types/docs'

export type DocStatus = 'connecting' | 'synced' | 'offline' | 'revoked'
type Bytes = ArrayBuffer | Uint8Array
const bytes = (v: Bytes) => (v instanceof Uint8Array ? v : new Uint8Array(v))
interface Ack { ok: boolean; role?: SpaceRole; update?: Bytes; stateVector?: Bytes; error?: string }

const RESYNC_MS = 30_000
const RETRY_MS = 1_500
const PERMANENT = new Set(['too_large', 'invalid', 'forbidden'])

/**
 * Liga um documento Yjs ao servidor pelo socket do app. O que for escrito sem conexão
 * (ou recusado por excesso) fica no documento local e sobe na próxima sincronização:
 * o servidor diz o que já tem e o cliente manda só a diferença.
 */
export class DocProvider {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  status: DocStatus = 'connecting'
  role: SpaceRole | undefined
  /** Há texto local que o servidor ainda não confirmou. */
  pending = 0
  /** O servidor recusou de vez (texto grande demais, sem permissão): insistir não adianta. */
  rejected = false
  private readonly socket: Socket
  private joined = false
  private destroyed = false
  private readonly timer: ReturnType<typeof setInterval>
  private retry: ReturnType<typeof setTimeout> | undefined
  /** Clientes Yjs de cada socket: quando ele sai, o cursor some. */
  private readonly peers = new Map<string, Set<number>>()

  constructor(private readonly pageId: string, token: string, private readonly onChange: () => void) {
    this.socket = connectSocket(token)
    this.socket.on('connect', this.join)
    this.socket.on('disconnect', this.onDisconnect)
    this.socket.on('doc:update', this.onRemoteUpdate)
    this.socket.on('doc:awareness', this.onRemoteAwareness)
    this.socket.on('doc:joined', this.onPeerJoined)
    this.socket.on('doc:left', this.onPeerLeft)
    this.socket.on('doc:revoked', this.onRevoked)
    this.doc.on('update', this.onLocalUpdate)
    this.awareness.on('update', this.onLocalAwareness)
    this.timer = setInterval(() => this.sync('doc:sync'), RESYNC_MS)
    if (this.socket.connected) this.join()
  }

  private set(status: DocStatus) {
    this.status = status
    this.onChange()
  }

  private join = () => {
    if (this.status !== 'revoked') this.sync('doc:join')
  }

  private sync(event: 'doc:join' | 'doc:sync') {
    if (this.destroyed || !this.socket.connected || (event === 'doc:sync' && !this.joined)) return
    this.socket.emit(event, { pageId: this.pageId, stateVector: Y.encodeStateVector(this.doc) }, (ack: Ack) => {
      if (this.destroyed) return
      if (!ack?.ok) {
        if (ack?.error === 'rate_limited') this.later(event)
        else if (ack?.error && PERMANENT.has(ack.error)) { this.rejected = true; this.onChange() }
      else if (ack?.error === 'not_joined') this.sync('doc:join')
        else this.set('revoked')
        return
      }
      this.role = ack.role
      this.joined = true
      if (ack.update) Y.applyUpdate(this.doc, bytes(ack.update), this)
      const missing = Y.encodeStateAsUpdate(this.doc, ack.stateVector ? bytes(ack.stateVector) : undefined)
      this.pending = 0
      this.rejected = false
      if (ack.role !== 'viewer' && missing.length > 2) this.send(missing)
      this.sendAwareness([this.doc.clientID])
      this.set('synced')
    })
  }

  private later(event: 'doc:join' | 'doc:sync') {
    clearTimeout(this.retry)
    this.retry = setTimeout(() => this.sync(event), RETRY_MS)
  }

  private send(update: Uint8Array) {
    this.pending++
    if (!this.joined || !this.socket.connected) { this.onChange(); return }
    this.socket.emit('doc:update', { pageId: this.pageId, update }, (ack: Ack) => {
      if (this.destroyed) return
      if (ack?.ok) { this.pending = Math.max(0, this.pending - 1); this.onChange() }
      else if (ack?.error && PERMANENT.has(ack.error)) { this.rejected = true; this.onChange() }
      else if (ack?.error === 'not_joined' || ack?.error === 'revoked') this.later('doc:join')
      else this.later('doc:sync')
    })
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => { if (origin !== this) this.send(update) }

  private onRemoteUpdate = (m: { pageId: string; update: Bytes }) => {
    if (m.pageId === this.pageId) Y.applyUpdate(this.doc, bytes(m.update), this)
  }

  private sendAwareness(clients: number[]) {
    if (this.joined && this.socket.connected) this.socket.emit('doc:awareness', { pageId: this.pageId, update: encodeAwarenessUpdate(this.awareness, clients) })
  }

  private onLocalAwareness = (c: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = [...c.added, ...c.updated, ...c.removed]
    // Só a própria presença: repassar a dos outros daria eco.
    if (origin !== this && changed.includes(this.doc.clientID)) this.sendAwareness([this.doc.clientID])
    if (c.added.length || c.removed.length) this.onChange()
  }

  private onRemoteAwareness = (m: { pageId: string; update: Bytes; socketId: string }) => {
    if (m.pageId !== this.pageId) return
    const before = new Set(this.awareness.getStates().keys())
    applyAwarenessUpdate(this.awareness, bytes(m.update), this)
    const mine = this.peers.get(m.socketId) ?? new Set<number>()
    for (const id of this.awareness.getStates().keys()) if (!before.has(id)) mine.add(id)
    this.peers.set(m.socketId, mine)
  }

  private onPeerJoined = (m: { pageId: string }) => { if (m.pageId === this.pageId) this.sendAwareness([this.doc.clientID]) }

  private onPeerLeft = (m: { pageId: string; socketId: string }) => {
    if (m.pageId !== this.pageId) return
    const ids = this.peers.get(m.socketId)
    if (ids) removeAwarenessStates(this.awareness, [...ids], this)
    this.peers.delete(m.socketId)
  }

  private clearPeers() {
    removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()].filter(id => id !== this.doc.clientID), this)
    this.peers.clear()
  }

  private onDisconnect = () => {
    this.joined = false
    this.clearPeers()
    if (this.status !== 'revoked') this.set('offline')
  }

  private onRevoked = (m: { pageId: string; reason: string }) => {
    if (m.pageId !== this.pageId) return
    this.joined = false
    this.clearPeers()
    // Papel trocado: entra de novo já com o papel novo.
    if (m.reason === 'role') this.sync('doc:join')
    else this.set('revoked')
  }

  destroy() {
    this.destroyed = true
    clearInterval(this.timer)
    clearTimeout(this.retry)
    if (this.joined) {
      removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
      this.socket.emit('doc:leave', { pageId: this.pageId })
    }
    this.joined = false
    this.socket.off('connect', this.join)
    this.socket.off('disconnect', this.onDisconnect)
    this.socket.off('doc:update', this.onRemoteUpdate)
    this.socket.off('doc:awareness', this.onRemoteAwareness)
    this.socket.off('doc:joined', this.onPeerJoined)
    this.socket.off('doc:left', this.onPeerLeft)
    this.socket.off('doc:revoked', this.onRevoked)
    this.awareness.destroy()
    this.doc.destroy()
  }
}

const CARET = ['#0f73ac', '#3a7f6b', '#a8761b', '#b3402a', '#5a6d9c', '#2f7f92', '#7a5c86', '#6b7f8a']
/** Cor estável por pessoa, para cursor e presença. */
export function caretColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CARET[h % CARET.length]
}
