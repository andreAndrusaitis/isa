import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  ticketParticipant: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() },
  queue: { findUnique: vi.fn() },
}))
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import { assertValidAssignee, getTicketAccess, socketsByTicketAccess, ticketVisibilityWhere } from './ticketAccess'

const agentNode = (over: any = {}) => ({ id: 'ag', role: 'agent', manager_id: 'mg', manager_global: false, queues: ['q1'], org_scopes: [], ...over })
const mgrNode = (over: any = {}) => ({ id: 'mg', role: 'manager', manager_id: null, manager_global: false, queues: [], org_scopes: [{ org_id: 'A' }], ...over })
const ticket = (over: any = {}) => ({ id: 't1', user_id: 'cust', org_id: 'A', queue: 'q1', assigned_to_id: null, collab_queue: null, escalated: false, ...over })
const agent = { sub: 'ag', role: 'agent' }
const chain = (ag: any, mg: any) =>
  prismaMock.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.id === 'ag' ? ag : where.id === 'mg' ? mg : null))

beforeEach(() => {
  vi.clearAllMocks()
  chain(agentNode(), mgrNode())
  prismaMock.ticketParticipant.findUnique.mockResolvedValue(null)
  prismaMock.organization.findUnique.mockResolvedValue({ name: 'Acme' })
  prismaMock.queue.findUnique.mockResolvedValue({ name: 'Fila N2' })
})

describe('getTicketAccess', () => {
  it('carteira + fila → permite', async () => {
    expect(await getTicketAccess(ticket(), agent)).toEqual({ allowed: true, via: 'scope' })
  })
  it('empresa fora da carteira → ORG_OUT_OF_SCOPE com nome', async () => {
    const r = await getTicketAccess(ticket({ org_id: 'B' }), agent)
    expect(r).toMatchObject({ allowed: false, code: 'ORG_OUT_OF_SCOPE' })
    expect((r as any).message).toContain('Acme')
  })
  it('fila que não é dele → QUEUE_NOT_ASSIGNED com nome da fila', async () => {
    const r = await getTicketAccess(ticket({ queue: 'q9' }), agent)
    expect(r).toMatchObject({ allowed: false, code: 'QUEUE_NOT_ASSIGNED' })
    expect((r as any).message).toContain('Fila N2')
  })
  it('analista sem fila → NO_QUEUES', async () => {
    chain(agentNode({ queues: [] }), mgrNode())
    expect(await getTicketAccess(ticket(), agent)).toMatchObject({ allowed: false, code: 'NO_QUEUES' })
  })
  it('sem carteira na cadeia → SCOPE_NOT_CONFIGURED', async () => {
    chain(agentNode(), mgrNode({ org_scopes: [] }))
    expect(await getTicketAccess(ticket(), agent)).toMatchObject({ allowed: false, code: 'SCOPE_NOT_CONFIGURED' })
  })
  it('analista solicitante acessa o próprio chamado mesmo fora da carteira', async () => {
    expect(await getTicketAccess(ticket({ org_id: 'B', queue: 'q9', user_id: 'ag' }), agent)).toEqual({ allowed: true, via: 'requester' })
  })
  it('solicitante que também tem a carteira não cai no via requester (vê como equipe)', async () => {
    expect(await getTicketAccess(ticket({ user_id: 'ag' }), agent)).toEqual({ allowed: true, via: 'scope' })
    expect(await getTicketAccess(ticket({ org_id: 'B', queue: 'q9', user_id: 'ag', assigned_to_id: 'ag' }), agent)).toEqual({ allowed: true, via: 'assigned' })
  })
  it('responsável acessa mesmo fora da carteira', async () => {
    expect(await getTicketAccess(ticket({ org_id: 'B', queue: 'q9', assigned_to_id: 'ag' }), agent)).toEqual({ allowed: true, via: 'assigned' })
  })
  it('colaborador ativo acessa mesmo fora da carteira e da fila', async () => {
    prismaMock.ticketParticipant.findUnique.mockResolvedValue({ active: true, role: 'collaborator' })
    expect(await getTicketAccess(ticket({ org_id: 'B', queue: 'q9' }), agent)).toEqual({ allowed: true, via: 'collaborator' })
  })
  it('fila colaboradora dá acesso ao analista', async () => {
    expect(await getTicketAccess(ticket({ org_id: 'B', queue: 'q9', collab_queue: 'q1' }), agent)).toEqual({ allowed: true, via: 'collab_queue' })
  })
  it('escalonado para a fila dá acesso ao analista', async () => {
    expect(await getTicketAccess(ticket({ org_id: 'B', queue: 'q1', escalated: true }), agent)).toEqual({ allowed: true, via: 'escalated_queue' })
  })
  it('fila de gestor (só notificação) não abre acesso fora da carteira', async () => {
    prismaMock.user.findUnique.mockResolvedValue(mgrNode({ queues: ['q1'] }))
    const r = await getTicketAccess(ticket({ org_id: 'B', queue: 'q1', escalated: true }), { sub: 'mg', role: 'manager' })
    expect(r).toMatchObject({ allowed: false, code: 'ORG_OUT_OF_SCOPE' })
  })
  it('usuário final só o próprio', async () => {
    expect(await getTicketAccess(ticket(), { sub: 'cust', role: 'user' })).toEqual({ allowed: true, via: 'requester' })
    expect(await getTicketAccess(ticket(), { sub: 'other', role: 'user' })).toMatchObject({ allowed: false, code: 'NOT_OWN_TICKET' })
  })
})

describe('assertValidAssignee', () => {
  const alive = { name: 'Ana', active: true, deleted_at: null, module_tickets: true, module_projects: false }
  beforeEach(() => {
    prismaMock.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.id === 'ag' ? { ...agentNode(), ...alive } : mgrNode()))
  })
  it('ter aberto o chamado não dá direito a assumi-lo fora da carteira', async () => {
    await expect(assertValidAssignee(ticket({ org_id: 'B', queue: 'q9', user_id: 'ag' }), 'ag')).rejects.toMatchObject({ code: 'ASSIGNEE_OUT_OF_SCOPE' })
  })
  it('analista da carteira assume o próprio chamado', async () => {
    await expect(assertValidAssignee(ticket({ user_id: 'ag' }), 'ag')).resolves.toBeUndefined()
  })
})

describe('socketsByTicketAccess', () => {
  const live = { active: true, deleted_at: null, session_invalidated_at: null }
  const sock = (data: any) => ({ data, rooms: new Set<string>(), emit: vi.fn(), disconnect: vi.fn() })
  const ioWith = (...sockets: any[]) => ({ in: () => ({ fetchSockets: async () => sockets }) })
  const dbUsers = (...users: any[]) => prismaMock.user.findMany.mockResolvedValue(users)

  it('vale o cargo do banco: admin rebaixado depois de conectar não passa mais como admin', async () => {
    const stale = sock({ userId: 'ag', role: 'admin' })
    dbUsers({ id: 'ag', role: 'agent', ...live })
    const r = await socketsByTicketAccess(ioWith(stale), ['role:admin'], ticket({ org_id: 'B' }))
    expect(r.allowed).toEqual([])
    expect(r.denied).toEqual([stale])
  })

  it('analista rebaixado a cliente perde a carteira na hora', async () => {
    const stale = sock({ userId: 'ag', role: 'agent' })
    dbUsers({ id: 'ag', role: 'user', ...live })
    expect((await socketsByTicketAccess(ioWith(stale), ['ticket:t1'], ticket())).denied).toEqual([stale])
  })

  it('sessão revogada depois do handshake derruba o socket, e um token novo da pessoa segue', async () => {
    const old = sock({ userId: 'ag', role: 'agent', token: { iat_ms: 1000 } })
    const fresh = sock({ userId: 'ag', role: 'agent', token: { iat_ms: 3000 } })
    dbUsers({ id: 'ag', role: 'agent', ...live, session_invalidated_at: new Date(2000) })
    const r = await socketsByTicketAccess(ioWith(old, fresh), ['ticket:t1'], ticket())
    expect(old.disconnect).toHaveBeenCalledWith(true)
    expect(r.denied).toEqual([old])
    expect(fresh.disconnect).not.toHaveBeenCalled()
    expect(r.allowed).toEqual([fresh])
  })

  it('conta desativada ou apagada não recebe', async () => {
    const off = sock({ userId: 'ag', role: 'agent' })
    dbUsers({ id: 'ag', role: 'agent', ...live, active: false })
    expect((await socketsByTicketAccess(ioWith(off), ['ticket:t1'], ticket())).allowed).toEqual([])
    dbUsers()
    expect((await socketsByTicketAccess(ioWith(off), ['ticket:t1'], ticket())).allowed).toEqual([])
  })

  it('equipe que só chega como solicitante vê como cliente; com a carteira vê como equipe', async () => {
    const s = sock({ userId: 'ag', role: 'agent' })
    dbUsers({ id: 'ag', role: 'agent', ...live })
    const outside = await socketsByTicketAccess(ioWith(s), ['ticket:t1'], ticket({ org_id: 'B', user_id: 'ag' }))
    expect(outside.allowed).toEqual([s])
    expect(outside.requesterView.has(s as any)).toBe(true)
    const inside = await socketsByTicketAccess(ioWith(s), ['ticket:t1'], ticket({ user_id: 'ag' }))
    expect(inside.requesterView.has(s as any)).toBe(false)
  })

  it('uma consulta de usuários por entrega, mesmo com várias abas', async () => {
    const tabs = [sock({ userId: 'ag' }), sock({ userId: 'ag' })]
    dbUsers({ id: 'ag', role: 'agent', ...live })
    await socketsByTicketAccess(ioWith(...tabs), ['ticket:t1'], ticket())
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1)
  })

  it('sala vazia não consulta o banco', async () => {
    await socketsByTicketAccess(ioWith(), ['ticket:t1'], ticket())
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
  })
})

describe('ticketVisibilityWhere', () => {
  it('scopeAll sem fila → sem filtro', () => {
    expect(ticketVisibilityWhere('u', { scopeAll: true, orgIds: [], queueIds: [], enforceQueues: false })).toEqual({})
  })
  it('analista → OR carteira | solicitante | responsável | colaborador | fila colaboradora | escalonado', () => {
    const w: any = ticketVisibilityWhere('ag', { scopeAll: false, orgIds: ['A'], queueIds: ['q1'], enforceQueues: true })
    expect(w.OR).toHaveLength(6)
    expect(w.OR).toContainEqual({ user_id: 'ag' })
    expect(w.OR).toContainEqual({ assigned_to_id: 'ag' })
    expect(w.OR).toContainEqual({ collab_queue: { in: ['q1'] } })
    expect(w.OR).toContainEqual({ escalated: true, queue: { in: ['q1'] } })
  })
  it('sem ator → só a carteira (nunca um OR que casaria tudo)', () => {
    const scope = { scopeAll: false, orgIds: ['A'], queueIds: ['q1'], enforceQueues: true }
    expect(ticketVisibilityWhere(undefined, scope)).toEqual({ AND: [{ org_id: { in: ['A'] } }, { OR: [{ queue: null }, { queue: { in: ['q1'] } }] }] })
  })
  it('gestor restrito → OR carteira | solicitante | responsável | colaborador', () => {
    const w: any = ticketVisibilityWhere('mg', { scopeAll: false, orgIds: ['A'], queueIds: [], enforceQueues: false })
    expect(w.OR).toHaveLength(4)
  })
})
