import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { getAvailableCategoriesForUser } from './categories'

const SUFFIX = `catav-${Date.now()}`
let catOn: string, catOff: string, sla: string, orgId: string, userId: string

beforeAll(async () => {
  const tier = `t-${SUFFIX}`
  catOn = (await prisma.category.create({ data: { name: `On ${SUFFIX}` } })).id
  catOff = (await prisma.category.create({ data: { name: `Off ${SUFFIX}` } })).id
  sla = (await prisma.slaConfig.create({ data: { tier, incident_first_response_hours: 1, incident_resolution_hours: 4 } })).id
  await prisma.planCategory.createMany({ data: [{ sla_config_id: sla, category_id: catOn }, { sla_config_id: sla, category_id: catOff }] })
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}`, tier } })).id
  userId = (await prisma.user.create({ data: { name: `U ${SUFFIX}`, email: `u-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  await prisma.orgCategoryBlock.create({ data: { org_id: orgId, category_id: catOff } })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.slaConfig.deleteMany({ where: { id: sla } })
  await prisma.category.deleteMany({ where: { id: { in: [catOn, catOff] } } })
  await prisma.$disconnect()
})

describe('getAvailableCategoriesForUser', () => {
  it('esconde a categoria do plano desligada para a empresa', async () => {
    const ids = (await getAvailableCategoriesForUser(userId)).map(c => c.id)
    expect(ids).toContain(catOn)
    expect(ids).not.toContain(catOff)
  })
})
