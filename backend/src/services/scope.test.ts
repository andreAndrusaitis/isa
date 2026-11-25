import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  userOrgScope: { createMany: vi.fn() },
  organization: { findUnique: vi.fn(), findMany: vi.fn() },
}))
vi.mock('../config/prisma', () => ({ default: prismaMock }))

import {
  computeScope, getEffectiveScope, canSeeOrg, canSeeQueue, scopeTicketWhere,
  addOrgToCreatorChain, validateCarteiraAgainstChief, getOrgServedBy, isInSubtree, type ChainNode,
} from './scope'

const node = (p: Partial<ChainNode>): ChainNode => ({
  id: 'x', role: 'agent', manager_id: null, manager_global: false, queues: [], org_scopes: [], ...p,
})
const scopes = (...ids: string[]) => ids.map(org_id => ({ org_id }))
const chainMock = (nodes: ChainNode[]) => {
  const byId = new Map(nodes.map(n => [n.id, n]))
  prismaMock.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(byId.get(where.id) ?? null))
}

beforeEach(() => vi.clearAllMocks())

describe('computeScope', () => {
  it('nada configurado na cadeia → nenhuma empresa', () => {
    expect(computeScope([node({}), node({ role: 'manager' })])).toEqual({ scopeAll: false, orgIds: [] })
  })
  it('gerente Todas → todas', () => {
    expect(computeScope([node({ role: 'manager', manager_global: true })])).toEqual({ scopeAll: true, orgIds: [] })
  })
  it('analista herda do gerente selecionado', () => {
    const r = computeScope([node({}), node({ role: 'manager', org_scopes: scopes('A', 'B') })])
    expect(r.scopeAll).toBe(false)
    expect(r.orgIds.sort()).toEqual(['A', 'B'])
  })
  it('interseção analista ∩ TM ∩ gerente', () => {
    const r = computeScope([
      node({ org_scopes: scopes('A', 'B', 'C') }),
      node({ role: 'supervisor', org_scopes: scopes('A', 'B') }),
      node({ role: 'manager', org_scopes: scopes('B', 'C') }),
    ])
    expect(r).toEqual({ scopeAll: false, orgIds: ['B'] })
  })
  it('restrição do TM vale para o analista que herda (não pula o TM)', () => {
    const r = computeScope([
      node({}),
      node({ role: 'supervisor', org_scopes: scopes('A') }),
      node({ role: 'manager', manager_global: true }),
    ])
    expect(r).toEqual({ scopeAll: false, orgIds: ['A'] })
  })
  it('Todas é neutro na interseção', () => {
    const r = computeScope([node({ org_scopes: scopes('A') }), node({ role: 'manager', manager_global: true })])
    expect(r).toEqual({ scopeAll: false, orgIds: ['A'] })
  })
})

describe('getEffectiveScope', () => {
  it('admin → tudo, sem filtro de fila', async () => {
    expect(await getEffectiveScope('a', 'admin')).toEqual({ scopeAll: true, orgIds: [], queueIds: [], enforceQueues: false })
  })
  it('analista carrega a cadeia e aplica filas', async () => {
    chainMock([
      node({ id: 'ag', manager_id: 'mg', queues: ['q1'] }),
      node({ id: 'mg', role: 'manager', org_scopes: scopes('A') }),
    ])
    expect(await getEffectiveScope('ag', 'agent')).toEqual({ scopeAll: false, orgIds: ['A'], queueIds: ['q1'], enforceQueues: true })
  })
  it('usuário inexistente → nada', async () => {
    chainMock([])
    expect(await getEffectiveScope('zz', 'manager')).toEqual({ scopeAll: false, orgIds: [], queueIds: [], enforceQueues: false })
  })
  it('ciclo de manager_id não trava', async () => {
    chainMock([
      node({ id: 'a', manager_id: 'b', org_scopes: scopes('A') }),
      node({ id: 'b', role: 'supervisor', manager_id: 'a' }),
    ])
    expect((await getEffectiveScope('a', 'agent')).orgIds).toEqual(['A'])
  })
})

describe('helpers', () => {
  const agent = { scopeAll: false, orgIds: ['A'], queueIds: ['q1'], enforceQueues: true }
  it('canSeeOrg', () => {
    expect(canSeeOrg(agent, 'A')).toBe(true)
    expect(canSeeOrg(agent, 'B')).toBe(false)
    expect(canSeeOrg(agent, null)).toBe(false)
    expect(canSeeOrg({ ...agent, scopeAll: true }, null)).toBe(true)
  })
  it('canSeeQueue: analista sem fila não vê nada; fila null visível a quem tem fila', () => {
    expect(canSeeQueue(agent, 'q1')).toBe(true)
    expect(canSeeQueue(agent, 'q2')).toBe(false)
    expect(canSeeQueue(agent, null)).toBe(true)
    expect(canSeeQueue({ ...agent, queueIds: [] }, null)).toBe(false)
    expect(canSeeQueue({ ...agent, enforceQueues: false, queueIds: [] }, 'q9')).toBe(true)
  })
  it('scopeTicketWhere: lista vazia vira filtro que não casa nada', () => {
    expect(scopeTicketWhere({ scopeAll: false, orgIds: [], queueIds: [], enforceQueues: false }))
      .toEqual({ AND: [{ org_id: { in: [] } }] })
    expect(scopeTicketWhere({ scopeAll: true, orgIds: [], queueIds: [], enforceQueues: false })).toEqual({})
    expect(scopeTicketWhere({ scopeAll: true, orgIds: [], queueIds: [], enforceQueues: true }))
      .toEqual({ AND: [{ id: { in: [] } }] })
  })
})

describe('addOrgToCreatorChain', () => {
  it('adiciona a quem tem carteira Selecionadas e pula Todas/Herdar', async () => {
    chainMock([
      node({ id: 'sup', role: 'supervisor', manager_id: 'mg' }),
      node({ id: 'mg', role: 'manager', org_scopes: scopes('A') }),
    ])
    await addOrgToCreatorChain('sup', 'NEW')
    expect(prismaMock.userOrgScope.createMany).toHaveBeenCalledWith({ data: [{ user_id: 'mg', org_id: 'NEW' }], skipDuplicates: true })
  })
  it('topo sem carteira recebe a empresa (senão o criador a perderia)', async () => {
    chainMock([node({ id: 'mg', role: 'manager' })])
    await addOrgToCreatorChain('mg', 'NEW')
    expect(prismaMock.userOrgScope.createMany).toHaveBeenCalledWith({ data: [{ user_id: 'mg', org_id: 'NEW' }], skipDuplicates: true })
  })
  it('gerente Todas → nada a fazer', async () => {
    chainMock([node({ id: 'mg', role: 'manager', manager_global: true })])
    await addOrgToCreatorChain('mg', 'NEW')
    expect(prismaMock.userOrgScope.createMany).not.toHaveBeenCalled()
  })
})

describe('validateCarteiraAgainstChief', () => {
  it('rejeita empresa fora da carteira do chefe, citando o nome', async () => {
    chainMock([node({ id: 'mg', role: 'manager', org_scopes: scopes('A') })])
    prismaMock.organization.findMany.mockResolvedValue([{ name: 'Beta SA' }])
    await expect(validateCarteiraAgainstChief('mg', ['A', 'B'])).rejects.toMatchObject({ statusCode: 400, code: 'CARTEIRA_OUTSIDE_CHIEF' })
    await expect(validateCarteiraAgainstChief('mg', ['A', 'B'])).rejects.toThrow(/Beta SA/)
  })
  it('aceita subconjunto e chefe Todas', async () => {
    chainMock([node({ id: 'mg', role: 'manager', org_scopes: scopes('A', 'B') }), node({ id: 'all', role: 'manager', manager_global: true })])
    await expect(validateCarteiraAgainstChief('mg', ['A'])).resolves.toBeUndefined()
    await expect(validateCarteiraAgainstChief('all', ['Z'])).resolves.toBeUndefined()
  })
})

describe('getOrgServedBy', () => {
  it('separa gerentes (Todas/Selecionada) e equipe com acesso efetivo', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { ...node({ id: 'm1', role: 'manager', manager_global: true }), name: 'M1', email: 'm1@x' },
      { ...node({ id: 'm2', role: 'manager', org_scopes: scopes('A') }), name: 'M2', email: 'm2@x' },
      { ...node({ id: 'm3', role: 'manager', org_scopes: scopes('B') }), name: 'M3', email: 'm3@x' },
      { ...node({ id: 'a1', manager_id: 'm2', queues: ['q1'] }), name: 'A1', email: 'a1@x' },
      { ...node({ id: 'a2', manager_id: 'm3' }), name: 'A2', email: 'a2@x' },
    ])
    const r = await getOrgServedBy('A')
    expect(r.managers.map(m => [m.id, m.mode])).toEqual([['m1', 'all'], ['m2', 'selected']])
    expect(r.team.map(t => [t.id, t.mode])).toEqual([['a1', 'inherit']])
  })
})

// B4: Gerente e TM só mexem em quem está abaixo deles no organograma.
describe('isInSubtree', () => {
  beforeEach(() => chainMock([
    node({ id: 'a1', manager_id: 'tm1' }),
    node({ id: 'tm1', role: 'supervisor', manager_id: 'g1' }),
    node({ id: 'g1', role: 'manager' }),
    node({ id: 'g2', role: 'manager' }),
    node({ id: 'solto' }),
  ]))

  it('chefe direto e chefe do chefe estão acima', async () => {
    expect(await isInSubtree('tm1', 'a1')).toBe(true)
    expect(await isInSubtree('g1', 'a1')).toBe(true)
  })
  it('outro gerente, a própria pessoa e subordinado não estão acima', async () => {
    expect(await isInSubtree('g2', 'a1')).toBe(false)
    expect(await isInSubtree('a1', 'a1')).toBe(false)
    expect(await isInSubtree('a1', 'g1')).toBe(false)
  })
  it('pessoa sem chefe não está na equipe de ninguém', async () => {
    expect(await isInSubtree('g1', 'solto')).toBe(false)
  })
})
