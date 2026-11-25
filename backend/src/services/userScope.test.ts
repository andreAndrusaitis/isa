import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { listUsers } from './users'

const SUFFIX = `usrscope-${Date.now()}`
let mgrId: string, supId: string, agtId: string, otherId: string

beforeAll(async () => {
  const mgr = await prisma.user.create({ data: { name: `Mgr ${SUFFIX}`, email: `mgr-${SUFFIX}@t.com`, password: 'x', role: 'manager' } })
  mgrId = mgr.id
  const sup = await prisma.user.create({ data: { name: `Sup ${SUFFIX}`, email: `sup-${SUFFIX}@t.com`, password: 'x', role: 'supervisor', manager_id: mgrId } })
  supId = sup.id
  const agt = await prisma.user.create({ data: { name: `Agt ${SUFFIX}`, email: `agt-${SUFFIX}@t.com`, password: 'x', role: 'agent', manager_id: supId } })
  agtId = agt.id
  const other = await prisma.user.create({ data: { name: `Other ${SUFFIX}`, email: `oth-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })
  otherId = other.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [agtId, supId, mgrId, otherId] } } }).catch(() => {})
  await prisma.$disconnect()
})

describe('listUsers com sub-árvore', () => {
  it('gerente vê a si + supervisor + analista, mas não o "other"', async () => {
    const list = await listUsers({ managerScopeRootId: mgrId })
    const ids = list.map(u => u.id)
    expect(ids).toEqual(expect.arrayContaining([mgrId, supId, agtId]))
    expect(ids).not.toContain(otherId)
  })

  it('sem managerScopeRootId (admin) lista todos, incluindo o "other"', async () => {
    const list = await listUsers({})
    const ids = list.map(u => u.id)
    expect(ids).toContain(otherId)
  })
})
