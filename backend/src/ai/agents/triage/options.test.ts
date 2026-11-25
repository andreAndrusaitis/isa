import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../../../config/prisma'
import { loadTypeOptions, loadCategoryOptions, loadSubcategoryOptions, loadQuestions, priorityFrom } from './options'

const SUFFIX = `aiopt-${Date.now()}`
let activeCat: string, inactiveCat: string, sub: string, inactiveSub: string
let outsideCat: string, sla: string, orgId: string
let changeBefore: { enabled: boolean } | null

beforeAll(async () => {
  activeCat = (await prisma.category.create({ data: { name: `Ativa ${SUFFIX}`, description: 'Descrição ativa' } })).id
  inactiveCat = (await prisma.category.create({ data: { name: `Inativa ${SUFFIX}`, active: false } })).id
  sub = (await prisma.subcategory.create({ data: { name: `Sub ${SUFFIX}`, category_id: activeCat } })).id
  inactiveSub = (await prisma.subcategory.create({ data: { name: `SubOff ${SUFFIX}`, category_id: activeCat, active: false } })).id
  // Empresa cujo plano tem só activeCat: outsideCat (ativa) fica fora do plano.
  outsideCat = (await prisma.category.create({ data: { name: `Fora ${SUFFIX}` } })).id
  const tier = `t-${SUFFIX}`
  sla = (await prisma.slaConfig.create({ data: { tier, incident_first_response_hours: 1, incident_resolution_hours: 4 } })).id
  await prisma.planCategory.create({ data: { sla_config_id: sla, category_id: activeCat } })
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}`, tier } })).id
  changeBefore = await prisma.ticketTypeConfig.findUnique({ where: { type: 'change' } })
  await prisma.ticketTypeConfig.upsert({ where: { type: 'change' }, update: { enabled: false }, create: { type: 'change', enabled: false } })
})

afterAll(async () => {
  if (changeBefore) await prisma.ticketTypeConfig.update({ where: { type: 'change' }, data: { enabled: changeBefore.enabled } })
  else await prisma.ticketTypeConfig.delete({ where: { type: 'change' } })
  await prisma.subcategory.deleteMany({ where: { id: { in: [sub, inactiveSub] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.slaConfig.deleteMany({ where: { id: sla } })
  await prisma.category.deleteMany({ where: { id: { in: [activeCat, inactiveCat, outsideCat] } } })
  await prisma.$disconnect()
})

describe('options', () => {
  it('tipos: só os habilitados em ticket_type_configs', async () => {
    const values = (await loadTypeOptions()).map(o => o.value)
    expect(values).not.toContain('change')
    expect(values).toContain('incident')
    expect(values).toContain('request')
  })

  it('categorias: só ativas, com descrição', async () => {
    const opts = await loadCategoryOptions()
    expect(opts.find(o => o.value === activeCat)).toEqual({ value: activeCat, label: `Ativa ${SUFFIX}`, description: `Descrição ativa — inclui: Sub ${SUFFIX}` })
    expect(opts.find(o => o.value === inactiveCat)).toBeUndefined()
  })

  it('categorias: com a empresa do chamado, só as do plano dela; sem empresa, todas as ativas', async () => {
    const scoped = await loadCategoryOptions(orgId)
    expect(scoped.map(o => o.value)).toEqual([activeCat])
    expect(scoped[0].description).toBe(`Descrição ativa — inclui: Sub ${SUFFIX}`)
    for (const all of [await loadCategoryOptions(), await loadCategoryOptions(null)]) {
      expect(all.map(o => o.value)).toEqual(expect.arrayContaining([activeCat, outsideCat]))
    }
    const qs = await loadQuestions(orgId)
    expect(qs[1].options.map(o => o.value)).toEqual([activeCat, '__none__'])
  })

  it('subcategorias: só ativas da categoria pedida', async () => {
    const opts = await loadSubcategoryOptions(activeCat)
    expect(opts.map(o => o.value)).toEqual([sub])
  })

  it('perguntas: categoria é às cegas, tipo/urgência/impacto veem a escolha do cliente', async () => {
    const qs = await loadQuestions()
    expect(qs.map(q => [q.key, q.blind])).toEqual([['type', false], ['category', true], ['urgency', false], ['impact', false]])
    expect(qs[1].options.at(-1)?.value).toBe('__none__')
  })

  it('matriz urgência × impacto', () => {
    expect(priorityFrom('high', 'high')).toBe('high')
    expect(priorityFrom('high', 'low')).toBe('high')
    expect(priorityFrom('medium', 'medium')).toBe('medium')
    expect(priorityFrom('low', 'medium')).toBe('low')
    expect(priorityFrom('low', 'high')).toBe('medium')
  })
})
