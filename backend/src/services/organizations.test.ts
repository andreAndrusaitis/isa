import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { listOrganizations } from './organizations'

const SUFFIX = `orgsvc-${Date.now()}`
let orgAId: string, orgBId: string, agentId: string

beforeAll(async () => {
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: `OrgA ${SUFFIX}` } }),
    prisma.organization.create({ data: { name: `OrgB ${SUFFIX}` } }),
  ])
  orgAId = orgA.id; orgBId = orgB.id
  const agent = await prisma.user.create({ data: { name: `Agt ${SUFFIX}`, email: `agt-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })
  agentId = agent.id
  await prisma.userOrgScope.create({ data: { user_id: agentId, org_id: orgAId } })
})

afterAll(async () => {
  await prisma.userOrgScope.deleteMany({ where: { user_id: agentId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: agentId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => {})
  await prisma.$disconnect()
})

describe('listOrganizations com escopo', () => {
  it('admin (scopeAll) vê as duas orgs', async () => {
    const list = await listOrganizations({ scopeAll: true, orgIds: [], queueIds: [], enforceQueues: false })
    const ids = list.map(o => o.id)
    expect(ids).toContain(orgAId)
    expect(ids).toContain(orgBId)
  })

  it('analista com atribuição vê só a org do seu escopo', async () => {
    const list = await listOrganizations({ scopeAll: false, orgIds: [orgAId], queueIds: [], enforceQueues: false })
    const ids = list.map(o => o.id)
    expect(ids).toContain(orgAId)
    expect(ids).not.toContain(orgBId)
  })

  it('fail-closed: escopo vazio (sem carteira) não vê nenhuma', async () => {
    const list = await listOrganizations({ scopeAll: false, orgIds: [], queueIds: [], enforceQueues: false })
    const ids = list.map(o => o.id)
    expect(ids).not.toContain(orgAId)
    expect(ids).not.toContain(orgBId)
  })
})
