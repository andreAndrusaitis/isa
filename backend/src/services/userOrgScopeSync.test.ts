import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { updateUser } from './users'

const SUFFIX = `uoss-${Date.now()}`
let orgAId: string, orgBId: string, userId: string

beforeAll(async () => {
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: `OrgA ${SUFFIX}` } }),
    prisma.organization.create({ data: { name: `OrgB ${SUFFIX}` } }),
  ])
  orgAId = orgA.id; orgBId = orgB.id
  const u = await prisma.user.create({ data: { name: `Agt ${SUFFIX}`, email: `agt-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgAId } })
  userId = u.id
})

afterAll(async () => {
  await prisma.userOrgScope.deleteMany({ where: { user_id: userId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => {})
  await prisma.$disconnect()
})

describe.sequential('updateUser sincroniza carteira de empresas (UserOrgScope)', () => {
  it('define as empresas e depois substitui pelo novo conjunto', async () => {
    await updateUser(userId, { org_scope_ids: [orgAId, orgBId] })
    let scopes = await prisma.userOrgScope.findMany({ where: { user_id: userId }, select: { org_id: true } })
    expect(scopes.map(s => s.org_id).sort()).toEqual([orgAId, orgBId].sort())

    // substitui pelo conjunto reduzido (remove orgB)
    await updateUser(userId, { org_scope_ids: [orgAId] })
    scopes = await prisma.userOrgScope.findMany({ where: { user_id: userId }, select: { org_id: true } })
    expect(scopes.map(s => s.org_id)).toEqual([orgAId])
  })

  it('lista vazia limpa a carteira', async () => {
    await updateUser(userId, { org_scope_ids: [] })
    const scopes = await prisma.userOrgScope.findMany({ where: { user_id: userId } })
    expect(scopes.length).toBe(0)
  })
})
