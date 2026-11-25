import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  connection: undefined as undefined | ((socket: any) => Promise<void>),
  roomOps: { disconnectSockets: vi.fn(), socketsLeave: vi.fn(), socketsJoin: vi.fn() },
  inRoom: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn() },
    ticket: { findUnique: vi.fn() },
    ticketParticipant: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    queue: { findUnique: vi.fn() },
  },
  modules: vi.fn(),
  projectRole: vi.fn(),
}))

vi.mock('socket.io', () => ({
  Server: class {
    use() {}
    on(_ev: string, fn: any) { h.connection = fn }
    in(room: string) { h.inRoom(room); return h.roomOps }
  },
}))
vi.mock('./prisma', () => ({ default: h.prisma }))
vi.mock('./env', () => ({ env: { NODE_ENV: 'test', CORS_ORIGIN: 'http://x', JWT_SECRET: 'test-secret-with-at-least-32-chars' } }))
vi.mock('../services/moduleAccess', () => ({ getEffectiveModules: h.modules }))
vi.mock('../services/projectAccess', () => ({ effectiveProjectRole: h.projectRole }))

import { initSocket, leaveProjectRoom, revokeUserSockets } from './socket'

const TICKET = { id: 't1', user_id: 'cust', org_id: 'org-b', queue: null, assigned_to_id: null, collab_queue: null, escalated: false, deleted_at: null }
const ALIVE = { active: true, deleted_at: null, session_invalidated_at: null }

// Socket já conectado: `data.role` é o que ficou da conexão, antes da mudança.
async function connected() {
  const handlers: Record<string, (...args: any[]) => any> = {}
  const socket = {
    data: { userId: 'u1', token: { iat_ms: 1000 } } as Record<string, any>,
    join: vi.fn(),
    leave: vi.fn(),
    disconnect: vi.fn(),
    on: (ev: string, fn: any) => { handlers[ev] = fn },
  }
  await h.connection!(socket)
  socket.join.mockClear()
  return { socket, emit: (ev: string, id: string) => new Promise<any>(res => handlers[ev](id, res)) }
}

// Conexão e checagens seguintes leem o mesmo `user`; a cadeia da carteira vem do mesmo findUnique.
const dbUser = (user: Record<string, unknown>) => h.prisma.user.findUnique.mockResolvedValue({
  ...ALIVE, queues: ['q1'], manager_id: null, manager_global: false, org_scopes: [{ org_id: 'org-a' }], ...user,
})

beforeEach(() => {
  vi.clearAllMocks()
  initSocket({} as any)
  h.modules.mockResolvedValue({ tickets: true, projects: true, documents: false })
  h.projectRole.mockResolvedValue('member')
  h.prisma.ticket.findUnique.mockResolvedValue(TICKET)
  h.prisma.ticketParticipant.findUnique.mockResolvedValue(null)
  h.prisma.organization.findUnique.mockResolvedValue({ name: 'Org B' })
})

describe('ticket:join usa o estado atual da pessoa, não o da conexão', () => {
  it('admin rebaixado depois de conectar não entra em chamado fora da carteira', async () => {
    dbUser({ role: 'admin' })
    const { socket, emit } = await connected()
    expect(socket.data.role).toBe('admin')

    dbUser({ role: 'agent' })
    expect(await emit('ticket:join', 't1')).toMatchObject({ ok: false, code: 'ORG_OUT_OF_SCOPE' })
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('sessão revogada depois de conectar derruba o socket', async () => {
    dbUser({ role: 'agent' })
    const { socket, emit } = await connected()

    dbUser({ role: 'agent', session_invalidated_at: new Date(2000) })
    expect(await emit('ticket:join', 't1')).toEqual({ ok: false })
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('quem tem acesso continua entrando', async () => {
    dbUser({ role: 'agent', org_scopes: [{ org_id: 'org-b' }] })
    const { socket, emit } = await connected()
    expect(await emit('ticket:join', 't1')).toEqual({ ok: true })
    expect(socket.join).toHaveBeenCalledWith('ticket:t1')
  })
})

describe('project:join segue o requireCap do REST', () => {
  it('membro com Projetos desligado não entra na sala', async () => {
    dbUser({ role: 'agent' })
    const { socket, emit } = await connected()

    h.modules.mockResolvedValue({ tickets: true, projects: false, documents: false })
    expect(await emit('project:join', 'p1')).toEqual({ ok: false })
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('membro com o módulo ligado entra', async () => {
    dbUser({ role: 'agent' })
    const { socket, emit } = await connected()
    expect(await emit('project:join', 'p1')).toEqual({ ok: true })
    expect(socket.join).toHaveBeenCalledWith('project:p1')
  })

  it('quem não é membro não entra, mesmo com o módulo', async () => {
    dbUser({ role: 'agent' })
    const { socket, emit } = await connected()
    h.projectRole.mockResolvedValue(null)
    expect(await emit('project:join', 'p1')).toEqual({ ok: false })
    expect(socket.join).not.toHaveBeenCalled()
  })
})

describe('revogação direcionada', () => {
  it('revokeUserSockets derruba só os sockets da pessoa', () => {
    revokeUserSockets('u9')
    expect(h.inRoom).toHaveBeenCalledWith('user:u9')
    expect(h.roomOps.disconnectSockets).toHaveBeenCalledWith(true)
  })

  it('leaveProjectRoom tira a pessoa só daquela sala', () => {
    leaveProjectRoom('u9', 'p1')
    expect(h.inRoom).toHaveBeenCalledWith('user:u9')
    expect(h.roomOps.socketsLeave).toHaveBeenCalledWith('project:p1')
  })
})
