import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import {
  blockedCategoryIdsForOrg, assertCategoryNotBlocked, listCategoryOrgs, setCategoryOrgs, categoryOrgSummary,
} from './orgCategoryAccess'
import type { EffectiveScope } from './scope'

const SUFFIX = `oca-${Date.now()}`
const ALL: EffectiveScope = { scopeAll: true, orgIds: [], queueIds: [], enforceQueues: false }
const only = (...orgIds: string[]): EffectiveScope => ({ scopeAll: false, orgIds, queueIds: [], enforceQueues: false })
let catIn: string, catOther: string, subIn: string, slaA: string, slaB: string
let orgA1: string, orgA2: string, orgB: string, actorId: string

beforeAll(async () => {
  const tierA = `a-${SUFFIX}`, tierB = `b-${SUFFIX}`
  catIn = (await prisma.category.create({ data: { name: `In ${SUFFIX}` } })).id
  catOther = (await prisma.category.create({ data: { name: `Other ${SUFFIX}` } })).id
  subIn = (await prisma.subcategory.create({ data: { name: `Sub ${SUFFIX}`, category_id: catIn } })).id
  slaA = (await prisma.slaConfig.create({ data: { tier: tierA, incident_first_response_hours: 1, incident_resolution_hours: 4 } })).id
  slaB = (await prisma.slaConfig.create({ data: { tier: tierB, incident_first_response_hours: 1, incident_resolution_hours: 4 } })).id
  await prisma.planCategory.createMany({ data: [
    { sla_config_id: slaA, category_id: catIn },
    { sla_config_id: slaA, category_id: catOther },
    { sla_config_id: slaB, category_id: catOther },
  ] })
  orgA1 = (await prisma.organization.create({ data: { name: `A1 ${SUFFIX}`, tier: tierA } })).id
  orgA2 = (await prisma.organization.create({ data: { name: `A2 ${SUFFIX}`, tier: tierA } })).id
  orgB = (await prisma.organization.create({ data: { name: `B ${SUFFIX}`, tier: tierB } })).id
  actorId = (await prisma.user.create({ data: { name: `Actor ${SUFFIX}`, email: `${SUFFIX}@oca.test`, password: 'x', role: 'admin' } })).id
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { user_id: actorId } })
  await prisma.user.deleteMany({ where: { id: actorId } })
  // Cascata: org_category_blocks (org/categoria) e plan_categories (sla_config).
  await prisma.organization.deleteMany({ where: { id: { in: [orgA1, orgA2, orgB] } } })
  await prisma.slaConfig.deleteMany({ where: { id: { in: [slaA, slaB] } } })
  await prisma.subcategory.deleteMany({ where: { id: subIn } })
  await prisma.category.deleteMany({ where: { id: { in: [catIn, catOther] } } })
  await prisma.$disconnect()
})

describe('orgCategoryAccess', () => {
  // Os testes compartilham estado (bloqueios) e rodam em ordem.
  it('sem bloqueio: nada desligado e nada lança', async () => {
    expect((await blockedCategoryIdsForOrg(orgA1)).size).toBe(0)
    await expect(assertCategoryNotBlocked(orgA1, catIn)).resolves.toBeUndefined()
  })

  it('desabilitar em lote: só empresas cujo plano tem a categoria; resto vai para skipped', async () => {
    const r = await setCategoryOrgs(catIn, [orgA1, orgB], false, ALL)
    expect(r).toEqual({ updated: 1, skipped: [{ id: orgB, reason: 'OUT_OF_PLAN_OR_SCOPE' }] })
    expect([...await blockedCategoryIdsForOrg(orgA1)]).toEqual([catIn])
  })

  it('é idempotente', async () => {
    await setCategoryOrgs(catIn, [orgA1], false, ALL)
    expect(await prisma.orgCategoryBlock.count({ where: { org_id: orgA1 } })).toBe(1)
  })

  it('assert: bloqueia pela categoria ou pela subcategoria; outra empresa e sem empresa passam', async () => {
    await expect(assertCategoryNotBlocked(orgA1, catIn)).rejects.toMatchObject({ statusCode: 400, code: 'CATEGORY_NOT_AVAILABLE' })
    await expect(assertCategoryNotBlocked(orgA1, null, subIn)).rejects.toMatchObject({ code: 'CATEGORY_NOT_AVAILABLE' })
    await expect(assertCategoryNotBlocked(orgA2, catIn)).resolves.toBeUndefined()
    await expect(assertCategoryNotBlocked(null, catIn)).resolves.toBeUndefined()
    await expect(assertCategoryNotBlocked(orgA1, null)).resolves.toBeUndefined()
  })

  it('lista empresas da categoria: no plano com status, fora do plano à parte', async () => {
    const { inPlan, outOfPlan } = await listCategoryOrgs(catIn, ALL)
    expect(inPlan.find(o => o.id === orgA1)).toMatchObject({ enabled: false })
    expect(inPlan.find(o => o.id === orgA2)).toMatchObject({ enabled: true })
    expect(inPlan.find(o => o.id === orgB)).toBeUndefined()
    expect(outOfPlan.find(o => o.id === orgB)).toBeDefined()
  })

  it('respeita a carteira: lista e lote só dentro do escopo', async () => {
    const { inPlan } = await listCategoryOrgs(catIn, only(orgA2))
    expect(inPlan.map(o => o.id)).toEqual([orgA2])
    const r = await setCategoryOrgs(catIn, [orgA1], true, only(orgA2))
    expect(r.updated).toBe(0)
    expect(r.skipped).toEqual([{ id: orgA1, reason: 'OUT_OF_PLAN_OR_SCOPE' }])
  })

  it('habilitar remove bloqueio antigo de empresa fora do plano', async () => {
    await prisma.orgCategoryBlock.create({ data: { org_id: orgB, category_id: catIn } })
    const r = await setCategoryOrgs(catIn, [orgB], true, ALL)
    expect(r).toEqual({ updated: 1, skipped: [] })
    expect(await prisma.orgCategoryBlock.count({ where: { org_id: orgB } })).toBe(0)
  })

  it('resumo por categoria: ativas/total dentro do escopo', async () => {
    const s = await categoryOrgSummary(only(orgA1, orgA2, orgB))
    expect(s[catIn]).toEqual({ enabled: 1, total: 2 })
    expect(s[catOther]).toEqual({ enabled: 3, total: 3 })
  })

  it('habilitar remove o bloqueio e grava auditoria', async () => {
    await setCategoryOrgs(catIn, [orgA1], true, ALL, { actorId })
    expect((await blockedCategoryIdsForOrg(orgA1)).size).toBe(0)
    const log = await prisma.auditLog.findFirst({ where: { action: 'ENABLE_ORG_CATEGORY', user_id: actorId, details: { path: ['categoryId'], equals: catIn } }, orderBy: { created_at: 'desc' } })
    expect(log?.details).toMatchObject({ categoryId: catIn, orgIds: [orgA1] })
  })
})
