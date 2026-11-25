import { Server, Socket } from 'socket.io'
import { Server as HttpServer } from 'http'
import jwt from 'jsonwebtoken'
import { Pool } from 'pg'
import { createAdapter } from '@socket.io/postgres-adapter'
import { env } from './env'
import prisma from './prisma'
import { can, ticketRole } from '../access/can'
import { effectiveProjectRole } from '../services/projectAccess'
import { getEffectiveModules } from '../services/moduleAccess'
import { getTicketAccess, socketSessionAlive } from '../services/ticketAccess'
import { issuedBeforeInvalidation } from '../middlewares/auth'
import { initDocsRealtime, registerDocHandlers } from '../realtime/docs'

let io: Server

/**
 * Cargo atual de quem pede para entrar numa sala. A conexão pode ser bem mais antiga
 * que a última mudança da pessoa; entrar em sala é raro, então a consulta não pesa.
 * Sessão revogada derruba o socket.
 */
async function liveUser(socket: Socket): Promise<{ role: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: socket.data.userId },
    select: { role: true, active: true, deleted_at: true, session_invalidated_at: true },
  })
  if (user && socketSessionAlive(user, socket.data.token)) return user
  socket.disconnect(true)
  return null
}

export function initSocket(httpServer: HttpServer): Server {
  const origins = env.CORS_ORIGIN.includes(',') ? env.CORS_ORIGIN.split(',') : env.CORS_ORIGIN

  io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
    transports: ['websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
  })

  // Adapter Postgres: sincroniza salas/broadcast entre as instâncias do Web App
  // via LISTEN/NOTIFY, reusando o banco existente (custo zero). Sem ele, um emit
  // numa instância não alcança clientes conectados na outra (salas in-memory por
  // processo). Não habilitado em testes para não deixar handles abertos no Vitest.
  if (env.NODE_ENV !== 'test') {
    const connectionString = env.DIRECT_URL || env.DATABASE_URL_DIRECT || env.DATABASE_URL
    const pool = new Pool({
      connectionString,
      // sslmode=require → criptografa sem verificar a CA (semântica do "require").
      ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
      max: 4,
    })
    pool.on('error', (err) => console.error('[Socket][pg] pool error:', err.message))

    // Tabela auxiliar exigida pelo adapter para payloads acima de ~8KB (limite do
    // NOTIFY). Idempotente — só cria se ainda não existir.
    pool.query(`
      CREATE TABLE IF NOT EXISTS socket_io_attachments (
        id         bigserial UNIQUE,
        created_at timestamptz DEFAULT NOW(),
        payload    bytea
      );
    `)
      .then(() => {
        io.adapter(createAdapter(pool))
        console.log('[Socket] Postgres adapter ativo — broadcast cross-instance via LISTEN/NOTIFY')
      })
      .catch((err) => {
        console.error('[Socket] Falha ao iniciar Postgres adapter, usando in-memory:', err.message)
      })
  }

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return next(new Error('Unauthorized'))
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; iat?: number; iat_ms?: number }

      // CWE-613: mesma checagem de revogação de sessão do middleware `authenticate`
      // HTTP — sem isso, um access token invalidado por logout ainda abre socket.
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { active: true, deleted_at: true, session_invalidated_at: true, must_change_password: true },
      })
      if (
        !user ||
        !user.active ||
        user.deleted_at ||
        user.must_change_password ||
        issuedBeforeInvalidation(payload, user.session_invalidated_at)
      ) {
        return next(new Error('Unauthorized'))
      }

      socket.data.userId = payload.sub
      // Para reconferir a revogação depois do handshake (o socket vive mais que o token).
      socket.data.token = { iat: payload.iat, iat_ms: payload.iat_ms }
      next()
    } catch {
      next(new Error('Unauthorized'))
    }
  })

  initDocsRealtime(io)

  io.on('connection', async (socket) => {
    const userId: string = socket.data.userId
    socket.join(`user:${userId}`)
    // Antes de qualquer await: o cliente já entra na página assim que conecta.
    registerDocHandlers(socket, userId, async () => !!(await liveUser(socket)))

    // Agentes e supervisores entram nas salas das suas filas para receber notificações
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, queues: true },
      })
      if (user) {
        // Chamados desligado: a conexão recebe chamados como solicitante (só os
        // que a pessoa abriu) e não entra nas salas de fila.
        socket.data.role = await ticketRole(userId, user.role)
        const ticketsOn = socket.data.role === user.role
        socket.join(`role:${user.role}`)
        if (['agent', 'supervisor', 'manager', 'admin'].includes(user.role)) {
          socket.join('users:staff')
        }
        if (ticketsOn && ['agent', 'supervisor', 'manager', 'admin'].includes(user.role)) {
          user.queues.forEach(queueId => socket.join(`queue:${queueId}`))
        }
      }
    } catch { /* não crítico */ }

    // CWE-862: exige a mesma checagem de acesso usada no REST (getTicketAccess)
    // antes de admitir o socket na room do ticket — sem isso, qualquer usuário
    // autenticado podia entrar na room de qualquer ticket e receber os broadcasts
    // (ticket:created/updated) com dados de outra organização.
    socket.on('ticket:join', async (ticketId: string, ack?: (res: { ok: boolean; code?: string; error?: string }) => void) => {
      try {
        if (typeof ticketId !== 'string' || !ticketId) {
          ack?.({ ok: false })
          return
        }
        const user = await liveUser(socket)
        if (!user) {
          ack?.({ ok: false })
          return
        }
        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: { id: true, user_id: true, org_id: true, assigned_to_id: true, queue: true, collab_queue: true, escalated: true, deleted_at: true },
        })
        if (!ticket || ticket.deleted_at) {
          ack?.({ ok: false })
          return
        }
        const access = await getTicketAccess(ticket, { sub: userId, role: user.role })
        if (!access.allowed) {
          ack?.({ ok: false, code: access.code, error: access.message })
          return
        }
        socket.join(`ticket:${ticketId}`)
        ack?.({ ok: true })
      } catch {
        ack?.({ ok: false })
      }
    })

    socket.on('ticket:leave', (ticketId: string) => {
      if (typeof ticketId === 'string' && ticketId) {
        socket.leave(`ticket:${ticketId}`)
      }
    })

    // Módulo de Projetos: mesma regra do ticket:join — exige o módulo
    // (requireCap('projects.use') do REST) e ProjectMember antes de admitir o
    // socket na room do projeto.
    socket.on('project:join', async (projectId: string, ack?: (res: { ok: boolean }) => void) => {
      try {
        if (typeof projectId !== 'string' || !projectId) {
          ack?.({ ok: false })
          return
        }
        const user = await liveUser(socket)
        if (!user || !can({ role: user.role, modules: await getEffectiveModules(userId, user.role) }, 'projects.use')) {
          ack?.({ ok: false })
          return
        }
        if (!(await effectiveProjectRole(projectId, userId))) {
          ack?.({ ok: false })
          return
        }
        socket.join(`project:${projectId}`)
        ack?.({ ok: true })
      } catch {
        ack?.({ ok: false })
      }
    })

    socket.on('project:leave', (projectId: string) => {
      if (typeof projectId === 'string' && projectId) {
        socket.leave(`project:${projectId}`)
      }
    })
  })

  return io
}

export function getIo(): Server | undefined {
  return io
}

/**
 * As salas `queue:*` só são montadas na conexão: quando as filas de um usuário
 * mudam (cadastro do usuário ou tela de Filas), ajusta os sockets já abertos
 * dele — em todas as instâncias, via adapter — sem exigir reconexão.
 */
export function syncUserQueueRooms(userId: string, before: string[], after: string[]): void {
  if (!io) return
  const removed = before.filter(q => !after.includes(q)).map(q => `queue:${q}`)
  const added = after.filter(q => !before.includes(q)).map(q => `queue:${q}`)
  if (removed.length) io.in(`user:${userId}`).socketsLeave(removed)
  if (added.length) io.in(`user:${userId}`).socketsJoin(added)
}

/**
 * Derruba na hora os sockets da pessoa, em todas as instâncias. Para quem revoga
 * sessão ou troca o cargo: as salas `role:*`, `queue:*` e `users:staff` são montadas
 * na conexão e só uma nova conexão as refaz a partir do banco.
 */
export function revokeUserSockets(userId: string): void {
  io?.in(`user:${userId}`).disconnectSockets(true)
}

/** Tira a pessoa da sala do projeto ao perder o acesso: os eventos de task saem direto para a sala. */
export function leaveProjectRoom(userId: string, projectId: string): void {
  io?.in(`user:${userId}`).socketsLeave(`project:${projectId}`)
}
