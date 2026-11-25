/**
 * Edição em tempo real das páginas de Documentos (Yjs sobre Socket.IO).
 *
 * Cada instância mantém o Y.Doc das páginas abertas nela e grava com atraso curto.
 * Os updates são comutativos: duas instâncias podem gravar a mesma página, e a trava
 * por página no banco garante que uma soma o que a outra gravou. Entre instâncias os
 * updates vão por serverSideEmit (adapter Postgres); cada uma repassa às suas conexões.
 */
import type { Server, Socket } from 'socket.io'
import * as Y from 'yjs'
import prisma from '../config/prisma'
import { logger } from '../utils/logger'
import { docActor, effectiveSpaceRole, pageRole, type DocRole } from '../services/docAccess'
import { MAX_UPDATE_BYTES, MAX_YDOC_BYTES, docFromState, encodeDoc, extractText, isValidUpdate, safeStateVector } from '../services/docContent'

const SAVE_DELAY_MS = 1200
const SAVE_MAX_WAIT_MS = 5000
const RETRY_MS = 5000
const BACKUP_MS = 10_000
const RECHECK_MS = 15_000
const SWEEP_MS = 60_000
const MAX_AWARENESS_BYTES = 16 * 1024
const MAX_PAGES_PER_SOCKET = 20
const VERSION_INTERVAL_MS = 10 * 60 * 1000
export const MAX_VERSIONS = 100

const pageRoom = (id: string) => `doc:${id}`
const spaceRoom = (id: string) => `docspace:${id}`

let io: Server | undefined

// ── Documento vivo ───────────────────────────────────────────────────────────

interface LiveDoc {
  pageId: string
  doc: Y.Doc
  /** Aceitos e ainda não gravados. */
  pending: { update: Uint8Array; userId: string | null }[]
  /** Recebeu edição de outra instância: confere depois se ela gravou (pode ter caído antes). */
  remote?: { userId: string | null }
  backup?: NodeJS.Timeout
  /** Teto do tamanho do estado codificado (recalculado só perto do limite). */
  size: number
  timer?: NodeJS.Timeout
  firstPendingAt: number
  chain: Promise<void>
}

const live = new Map<string, Promise<LiveDoc>>()
/** Quantos usos (conexões na página + operações REST) seguram cada documento na memória. */
const holds = new Map<string, number>()

async function load(pageId: string): Promise<LiveDoc> {
  const row = await prisma.docPage.findUnique({ where: { id: pageId }, select: { ydoc: true } })
  if (!row) throw new Error('página inexistente')
  return { pageId, doc: docFromState(row.ydoc), pending: [], size: row.ydoc?.length ?? 0, firstPendingAt: 0, chain: Promise.resolve() }
}

function acquire(pageId: string): Promise<LiveDoc> {
  let p = live.get(pageId)
  if (!p) {
    p = load(pageId)
    live.set(pageId, p)
    p.then(
      // Outra instância pode ter updates aceitos e ainda não gravados: ela responde com eles.
      () => cluster('docs:hello', pageId),
      () => { if (live.get(pageId) === p) live.delete(pageId) },
    )
  }
  return p
}

const retain = (pageId: string) => holds.set(pageId, (holds.get(pageId) ?? 0) + 1)

function release(pageId: string) {
  const n = (holds.get(pageId) ?? 0) - 1
  if (n > 0) holds.set(pageId, n)
  else {
    holds.delete(pageId)
    void settle(pageId)
  }
}

/** Sem ninguém usando: grava o que falta e tira da memória. */
async function settle(pageId: string) {
  const p = live.get(pageId)
  const l = await p?.catch(() => null)
  if (!p || !l) return
  await flush(l)
  if (holds.has(pageId) || l.pending.length || l.remote || live.get(pageId) !== p) return
  live.delete(pageId)
  clearTimeout(l.timer)
  clearTimeout(l.backup)
  l.doc.destroy()
}

/** Usa o documento vivo numa operação do servidor (REST), mesmo sem ninguém com a página aberta. */
async function withLive<T>(pageId: string, fn: (l: LiveDoc) => Promise<T>): Promise<T> {
  retain(pageId)
  try {
    return await fn(await acquire(pageId))
  } finally {
    release(pageId)
  }
}

function fits(l: LiveDoc, bytes: number): boolean {
  if (l.size + bytes <= MAX_YDOC_BYTES) return true
  l.size = Y.encodeStateAsUpdate(l.doc).length
  return l.size + bytes <= MAX_YDOC_BYTES
}

type ApplyResult = 'ok' | 'invalid' | 'too_large'

async function applyTo(l: LiveDoc, update: Uint8Array, userId: string | null): Promise<ApplyResult> {
  if (!isValidUpdate(update)) return 'invalid'
  if (!fits(l, update.length)) return 'too_large'
  try {
    Y.applyUpdate(l.doc, update)
  } catch (err) {
    // Passou na decodificação e quebrou na integração: refaz o documento do que é sabidamente bom.
    logger.warn('[Documentos] update recusado na integração', { pageId: l.pageId, err: String(err) })
    const row = await prisma.docPage.findUnique({ where: { id: l.pageId }, select: { ydoc: true } })
    const doc = docFromState(row?.ydoc)
    for (const p of l.pending) Y.applyUpdate(doc, p.update)
    l.doc.destroy()
    l.doc = doc
    return 'invalid'
  }
  accept(l, update, userId)
  return 'ok'
}

function accept(l: LiveDoc, update: Uint8Array, userId: string | null) {
  l.size += update.length
  if (!l.pending.length) l.firstPendingAt = Date.now()
  l.pending.push({ update, userId })
  schedule(l)
}

function schedule(l: LiveDoc, delay = SAVE_DELAY_MS) {
  clearTimeout(l.timer)
  const wait = Math.min(delay, Math.max(0, l.firstPendingAt + SAVE_MAX_WAIT_MS - Date.now()))
  l.timer = setTimeout(() => {
    void flush(l).then(() => { if (!holds.has(l.pageId)) void settle(l.pageId) })
  }, delay === RETRY_MS ? delay : wait)
  l.timer.unref?.()
}

function flush(l: LiveDoc): Promise<void> {
  l.chain = l.chain.then(async () => {
    if (!l.pending.length && !l.remote) return
    clearTimeout(l.timer)
    const batch = l.pending
    const remote = l.remote
    l.pending = []
    l.remote = undefined
    try {
      // Estado inteiro e não só o lote: cobre o que veio de uma instância que caiu antes de gravar.
      await persist(l.pageId, Y.encodeStateAsUpdate(l.doc), batch.at(-1)?.userId ?? remote?.userId ?? null)
    } catch (err) {
      l.pending = [...batch, ...l.pending]
      l.remote ??= remote
      schedule(l, RETRY_MS)
      logger.error('[Documentos] Falha ao gravar a página', { pageId: l.pageId, err: String(err) })
    }
  })
  return l.chain
}

/** Soma o estado ao que está no banco, sob a trava da página. */
async function persist(pageId: string, state: Uint8Array, userId: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`doc_page:${pageId}`}))`
    const row = await tx.docPage.findUnique({
      where: { id: pageId },
      select: { ydoc: true, title: true, updated_by_id: true, created_at: true },
    })
    if (!row) return // excluída de vez
    const doc = docFromState(row.ydoc)
    Y.applyUpdate(doc, state)
    const next = encodeDoc(doc)
    if (row.ydoc && row.ydoc.equals(next)) return
    const text = extractText(doc)
    doc.destroy()
    await tx.docPage.update({
      where: { id: pageId },
      data: { ydoc: next, content_text: text, updated_by_id: userId ?? undefined, revision: { increment: 1 } },
    })
    if (!row.ydoc || row.ydoc.length <= 2) return
    const last = await tx.docPageVersion.findFirst({ where: { page_id: pageId }, orderBy: { created_at: 'desc' }, select: { created_at: true } })
    if (Date.now() - (last?.created_at ?? row.created_at).getTime() <= VERSION_INTERVAL_MS) return
    // Guarda o estado de antes desta edição: é para ele que alguém quer voltar.
    await tx.docPageVersion.create({ data: { page_id: pageId, title: row.title, ydoc: row.ydoc, created_by_id: row.updated_by_id } })
    await pruneVersions(tx, pageId)
  }, { timeout: 20_000, maxWait: 10_000 })
}

type Tx = Pick<typeof prisma, 'docPageVersion'>

async function pruneVersions(tx: Tx, pageId: string) {
  const old = await tx.docPageVersion.findMany({ where: { page_id: pageId }, orderBy: { created_at: 'desc' }, skip: MAX_VERSIONS, select: { id: true } })
  if (old.length) await tx.docPageVersion.deleteMany({ where: { id: { in: old.map(v => v.id) } } })
}

/** Grava tudo o que está pendente (desligamento do processo, testes). */
export async function flushAllDocs(): Promise<void> {
  await Promise.all([...live.values()].map(p => p.then(flush, () => undefined)))
}

/** Estado atual da página, com o que ainda não foi gravado. */
export async function currentState(pageId: string): Promise<Buffer> {
  return withLive(pageId, async (l) => {
    await flush(l)
    return encodeDoc(l.doc)
  })
}

export async function saveVersion(pageId: string, userId: string, label: string | null) {
  const ydoc = await currentState(pageId)
  return prisma.$transaction(async (tx) => {
    const page = await tx.docPage.findUniqueOrThrow({ where: { id: pageId }, select: { title: true } })
    const version = await tx.docPageVersion.create({
      data: { page_id: pageId, title: page.title, label, ydoc, created_by_id: userId },
      select: { id: true, title: true, label: true, created_at: true, created_by: { select: { id: true, name: true, avatar: true } } },
    })
    await pruneVersions(tx, pageId)
    return version
  })
}

/**
 * Mudança de conteúdo feita pelo servidor (restaurar versão): aplica no documento vivo,
 * transmite a quem está editando e grava na hora. `false` = passaria do tamanho máximo.
 */
export async function mutateDoc(pageId: string, userId: string, cost: number, mutate: (doc: Y.Doc) => Uint8Array): Promise<boolean> {
  return withLive(pageId, async (l) => {
    if (!fits(l, cost)) return false
    const update = mutate(l.doc)
    accept(l, update, userId)
    publish(pageId, update, userId)
    await flush(l)
    return true
  })
}

/** Update vindo de um cliente já autorizado. */
async function receive(pageId: string, update: Uint8Array, userId: string, from: Socket): Promise<ApplyResult> {
  return withLive(pageId, async (l) => {
    const result = await applyTo(l, update, userId)
    if (result === 'ok') publish(pageId, update, userId, from)
    return result
  })
}

function publish(pageId: string, update: Uint8Array, userId: string | null, from?: Socket) {
  const payload = { pageId, update: Buffer.from(update), userId }
  if (from) from.local.to(pageRoom(pageId)).emit('doc:update', payload)
  else io?.local.to(pageRoom(pageId)).emit('doc:update', payload)
  cluster('docs:update', pageId, payload.update, userId)
}

/** Aviso às outras instâncias; sem adapter de cluster (testes, uma instância) não há a quem avisar. */
function cluster(event: string, ...args: unknown[]) {
  const adapter = io?.of('/').adapter as { doPublish?: unknown } | undefined
  if (typeof adapter?.doPublish === 'function') io!.serverSideEmit(event, ...args)
}

// ── Conexões ─────────────────────────────────────────────────────────────────

class Bucket {
  private tokens: number
  private last = Date.now()
  constructor(private readonly capacity: number, private readonly perSecond: number) { this.tokens = capacity }
  take(cost = 1): boolean {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond)
    this.last = now
    if (this.tokens < cost) return false
    this.tokens -= cost
    return true
  }
}

interface Joined { role: DocRole; spaceId: string; checkedAt: number }
interface Entry {
  socket: Socket
  userId: string
  pages: Map<string, Joined>
  spaces: Map<string, Joined>
  updates: Bucket
  bytes: Bucket
  awareness: Bucket
  joins: Bucket
  isAlive: () => Promise<boolean>
}

const entries = new Map<string, Entry>()

type Ack = ((res: Record<string, unknown>) => void) | undefined
const reply = (ack: unknown, res: Record<string, unknown>) => { if (typeof ack === 'function') (ack as NonNullable<Ack>)(res) }
const fail = (ack: unknown, error: string) => reply(ack, { ok: false, error })
const idOf = (payload: unknown, key: string): string | null => {
  const v = (payload as Record<string, unknown> | null | undefined)?.[key]
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null
}
const bytesOf = (payload: unknown): Uint8Array | null => {
  const v = (payload as Record<string, unknown> | null | undefined)?.update
  return v instanceof Uint8Array ? v : null
}

async function pageAccess(e: Entry, pageId: string) {
  if (!(await e.isAlive())) return null
  const actor = await docActor(e.userId)
  return actor ? pageRole(pageId, actor) : null
}

async function spaceAccess(e: Entry, spaceId: string): Promise<DocRole | null> {
  if (!(await e.isAlive())) return null
  const actor = await docActor(e.userId)
  return actor ? effectiveSpaceRole(spaceId, actor) : null
}

function leavePage(e: Entry, pageId: string) {
  if (!e.pages.delete(pageId)) return
  e.socket.to(pageRoom(pageId)).emit('doc:left', { pageId, socketId: e.socket.id, userId: e.userId })
  void e.socket.leave(pageRoom(pageId))
  release(pageId)
}

/** Reconfere o acesso de uma conexão à página; perdeu ou mudou de papel → sai da sala avisada. */
async function revalidatePage(e: Entry, pageId: string, reason = 'access') {
  const state = e.pages.get(pageId)
  if (!state) return
  const access = await pageAccess(e, pageId)
  if (e.pages.get(pageId) !== state) return
  if (access && access.role === state.role) {
    state.checkedAt = Date.now()
    state.spaceId = access.spaceId
    return
  }
  leavePage(e, pageId)
  // Papel trocado também sai: o cliente entra de novo já com o papel certo.
  e.socket.emit('doc:revoked', access ? { pageId, reason: 'role', role: access.role } : { pageId, reason })
}

async function revalidateSpace(e: Entry, spaceId: string) {
  const state = e.spaces.get(spaceId)
  if (!state) return
  const role = await spaceAccess(e, spaceId)
  if (e.spaces.get(spaceId) !== state) return
  if (role) {
    state.role = role
    state.checkedAt = Date.now()
    return
  }
  e.spaces.delete(spaceId)
  void e.socket.leave(spaceRoom(spaceId))
  e.socket.emit('docspace:revoked', { spaceId })
}

export interface RecheckFilter { spaceId?: string; pageIds?: string[]; userId?: string; reason?: 'access' | 'deleted' | 'archived' | 'moved' }

async function recheckLocal(f: RecheckFilter) {
  for (const e of [...entries.values()]) {
    if (f.userId && e.userId !== f.userId) continue
    try {
      for (const [pageId, s] of [...e.pages]) {
        if (f.pageIds ? f.pageIds.includes(pageId) : !f.spaceId || s.spaceId === f.spaceId) await revalidatePage(e, pageId, f.reason)
      }
      if (f.pageIds) continue
      for (const spaceId of [...e.spaces.keys()]) if (!f.spaceId || spaceId === f.spaceId) await revalidateSpace(e, spaceId)
    } catch (err) {
      logger.warn('[Documentos] Falha ao reconferir acesso', { err: String(err) })
    }
  }
}

/** Mudou quem pode ver: reconfere as conexões abertas, em todas as instâncias. */
export async function recheckDocAccess(f: RecheckFilter): Promise<void> {
  cluster('docs:recheck', f)
  await recheckLocal(f)
}

/** Barra lateral de quem está no espaço. */
export function emitTree(spaceId: string, type: string, extra: Record<string, unknown> = {}) {
  io?.to(spaceRoom(spaceId)).emit('doc:tree', { spaceId, type, ...extra })
}

/** Título/ícone para quem está com a página aberta. */
export function emitPageMeta(pageId: string, meta: { title: string; icon: string | null }) {
  io?.to(pageRoom(pageId)).emit('doc:meta', { pageId, ...meta })
}

/** A lista de espaços da pessoa mudou (entrou, saiu, papel novo). */
export function emitSpacesChanged(userId: string, spaceId: string) {
  io?.to(`user:${userId}`).emit('doc:spaces', { spaceId })
}

/** `isAlive` é a checagem de sessão do socket (derruba o socket se a sessão foi revogada). */
export function registerDocHandlers(socket: Socket, userId: string, isAlive: () => Promise<boolean>) {
  const e: Entry = {
    socket, userId, isAlive, pages: new Map(), spaces: new Map(),
    updates: new Bucket(200, 40), bytes: new Bucket(8 * 1024 * 1024, 1024 * 1024),
    awareness: new Bucket(100, 25), joins: new Bucket(40, 4),
  }
  entries.set(socket.id, e)

  const guarded = (event: string, fn: (payload: unknown, ack: unknown) => Promise<void>) => {
    socket.on(event, (payload: unknown, ack: unknown) => {
      fn(payload, ack).catch((err) => {
        logger.error(`[Documentos] Erro em ${event}`, { err: String(err) })
        fail(ack, 'internal')
      })
    })
  }

  guarded('doc:join', async (payload, ack) => {
    const pageId = idOf(payload, 'pageId')
    if (!pageId) return fail(ack, 'invalid')
    if (!e.joins.take()) return fail(ack, 'rate_limited')
    if (!e.pages.has(pageId) && e.pages.size >= MAX_PAGES_PER_SOCKET) return fail(ack, 'too_many_pages')
    const access = await pageAccess(e, pageId)
    if (!access) return fail(ack, 'not_found')
    if (!socket.connected) return // caiu enquanto conferia: o disconnect já limpou
    const isNew = !e.pages.has(pageId)
    if (isNew) retain(pageId)
    e.pages.set(pageId, { ...access, checkedAt: Date.now() })
    // Entra na sala antes de montar a resposta: nada do meio do caminho se perde.
    await socket.join(pageRoom(pageId))
    let l: LiveDoc
    try {
      l = await acquire(pageId)
    } catch (err) {
      leavePage(e, pageId)
      throw err
    }
    const sv = safeStateVector((payload as { stateVector?: unknown }).stateVector)
    reply(ack, {
      ok: true, role: access.role,
      update: Buffer.from(Y.encodeStateAsUpdate(l.doc, sv)),
      stateVector: Buffer.from(Y.encodeStateVector(l.doc)),
    })
    // Quem já está na página reenvia a própria presença para quem chegou.
    if (isNew) socket.to(pageRoom(pageId)).emit('doc:joined', { pageId, socketId: socket.id, userId })
  })

  guarded('doc:sync', async (payload, ack) => {
    const pageId = idOf(payload, 'pageId')
    const state = pageId ? e.pages.get(pageId) : undefined
    if (!pageId || !state) return fail(ack, 'not_joined')
    if (!e.joins.take()) return fail(ack, 'rate_limited')
    const l = await acquire(pageId)
    const sv = safeStateVector((payload as { stateVector?: unknown }).stateVector)
    reply(ack, {
      ok: true, role: state.role,
      update: Buffer.from(Y.encodeStateAsUpdate(l.doc, sv)),
      stateVector: Buffer.from(Y.encodeStateVector(l.doc)),
    })
  })

  guarded('doc:update', async (payload, ack) => {
    const pageId = idOf(payload, 'pageId')
    const update = bytesOf(payload)
    if (!pageId || !update || !update.length) return fail(ack, 'invalid')
    if (update.length > MAX_UPDATE_BYTES) return fail(ack, 'too_large')
    let state = e.pages.get(pageId)
    if (!state) return fail(ack, 'not_joined')
    if (!e.updates.take() || !e.bytes.take(update.length)) return fail(ack, 'rate_limited')
    if (Date.now() - state.checkedAt > RECHECK_MS) {
      await revalidatePage(e, pageId)
      state = e.pages.get(pageId)
      if (!state) return fail(ack, 'revoked')
    }
    if (state.role === 'viewer') return fail(ack, 'forbidden')
    const result = await receive(pageId, update, userId, socket)
    if (result === 'ok') reply(ack, { ok: true })
    else fail(ack, result)
  })

  guarded('doc:awareness', async (payload, ack) => {
    const pageId = idOf(payload, 'pageId')
    const update = bytesOf(payload)
    if (!pageId || !update) return fail(ack, 'invalid')
    if (update.length > MAX_AWARENESS_BYTES) return fail(ack, 'too_large')
    if (!e.pages.has(pageId)) return fail(ack, 'not_joined')
    if (!e.awareness.take()) return fail(ack, 'rate_limited')
    // userId e socketId são do servidor: quem recebe não depende do que o cliente declarou.
    socket.to(pageRoom(pageId)).emit('doc:awareness', { pageId, update, userId, socketId: socket.id })
    reply(ack, { ok: true })
  })

  guarded('doc:leave', async (payload, ack) => {
    const pageId = idOf(payload, 'pageId')
    if (pageId) leavePage(e, pageId)
    reply(ack, { ok: true })
  })

  guarded('docspace:join', async (payload, ack) => {
    const spaceId = idOf(payload, 'spaceId')
    if (!spaceId) return fail(ack, 'invalid')
    if (!e.joins.take()) return fail(ack, 'rate_limited')
    const role = await spaceAccess(e, spaceId)
    if (!role) return fail(ack, 'not_found')
    if (!socket.connected) return
    e.spaces.set(spaceId, { role, spaceId, checkedAt: Date.now() })
    await socket.join(spaceRoom(spaceId))
    reply(ack, { ok: true, role })
  })

  guarded('docspace:leave', async (payload, ack) => {
    const spaceId = idOf(payload, 'spaceId')
    if (spaceId && e.spaces.delete(spaceId)) await socket.leave(spaceRoom(spaceId))
    reply(ack, { ok: true })
  })

  socket.on('disconnect', () => {
    for (const pageId of [...e.pages.keys()]) leavePage(e, pageId)
    entries.delete(socket.id)
  })
}

/** Liga os avisos entre instâncias e a reconferência periódica. Chamar antes do io.on('connection'). */
export function initDocsRealtime(server: Server) {
  io = server
  server.on('docs:update', (pageId: string, update: Uint8Array, userId: string | null) => {
    if (!(update instanceof Uint8Array)) return
    server.local.to(pageRoom(pageId)).emit('doc:update', { pageId, update: Buffer.from(update), userId })
    // Já validado na origem, que também grava; aqui mantém o documento vivo em dia.
    live.get(pageId)?.then(l => {
      Y.applyUpdate(l.doc, update)
      l.size += update.length
      l.remote = { userId }
      clearTimeout(l.backup)
      l.backup = setTimeout(() => { void flush(l) }, BACKUP_MS)
      l.backup.unref()
    })
      .catch(err => logger.warn('[Documentos] update de outra instância falhou', { pageId, err: String(err) }))
  })
  server.on('docs:hello', (pageId: string) => {
    live.get(pageId)?.then(l => {
      if (l.pending.length) cluster('docs:update', pageId, Buffer.from(Y.mergeUpdates(l.pending.map(p => p.update))), null)
    }).catch(() => undefined)
  })
  server.on('docs:recheck', (f: RecheckFilter) => { void recheckLocal(f) })
  // Pega o que não passa por aqui: módulo desligado pelo gerente da cadeia, por exemplo.
  setInterval(() => { void recheckLocal({}) }, SWEEP_MS).unref()
}

/** Desligamento (deploy, Ctrl+C): grava o pendente antes de sair. */
export function flushDocsOnShutdown() {
  const stop = () => {
    const limit = new Promise(resolve => { setTimeout(resolve, 5000).unref() })
    Promise.race([flushAllDocs(), limit]).finally(() => process.exit(0))
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
