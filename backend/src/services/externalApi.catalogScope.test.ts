import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { listCategories, listSubcategories } from './externalApi'
import type { ApiKeyContext } from '../middlewares/apiKeyAuth'

// Catálogo da API externa filtrado pelo plano da empresa que receberia o
// chamado (mesma regra do portal: categorias do plano menos as bloqueadas).
const SUFFIX = `catscope-${Date.now()}`
const tier = `plano-${SUFFIX}`
const domain = `${SUFFIX}.example.com`
const expiredDomain = `${SUFFIX}-vencida.example.com`

const ids = {} as Record<'inPlan' | 'outPlan' | 'blocked' | 'sub' | 'special' | 'outSub' | 'org' | 'expiredOrg' | 'plan', string>

const multi: ApiKeyContext = { id: `multi-${SUFFIX}`, scopes: ['read_categories', 'read_subcategories'], org_id: null }
const locked = (): ApiKeyContext => ({ id: `locked-${SUFFIX}`, scopes: ['read_categories', 'read_subcategories'], org_id: ids.org })

beforeAll(async () => {
  ids.inPlan = (await prisma.category.create({ data: { name: `No plano ${SUFFIX}` } })).id
  ids.outPlan = (await prisma.category.create({ data: { name: `Fora do plano ${SUFFIX}` } })).id
  ids.blocked = (await prisma.category.create({ data: { name: `Bloqueada ${SUFFIX}` } })).id
  ids.sub = (await prisma.subcategory.create({ data: { name: `B Sub ${SUFFIX}`, category_id: ids.inPlan } })).id
  ids.special = (await prisma.subcategory.create({
    data: {
      name: `A Especial ${SUFFIX}`, category_id: ids.inPlan, is_special: true,
      special_form_schema: [{ key: 'nome', label: 'Nome', type: 'text', required: true }],
      special_title_template: 'Admissão — {nome}',
    },
  })).id
  ids.outSub = (await prisma.subcategory.create({ data: { name: `Sub fora ${SUFFIX}`, category_id: ids.outPlan } })).id

  const plan = await prisma.slaConfig.create({
    data: {
      tier, incident_first_response_hours: 4, incident_resolution_hours: 24,
      plan_categories: { create: [{ category_id: ids.inPlan }, { category_id: ids.blocked }] },
    },
  })
  ids.plan = plan.id

  ids.org = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}`, domains: [domain], tier } })).id
  ids.expiredOrg = (await prisma.organization.create({
    data: { name: `Org vencida ${SUFFIX}`, domains: [expiredDomain], tier, expires_at: new Date('2020-01-01'), expiry_message: 'Contrato vencido' },
  })).id
  await prisma.orgCategoryBlock.create({ data: { org_id: ids.org, category_id: ids.blocked } })
})

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.expiredOrg] } } }).catch(() => undefined)
  await prisma.slaConfig.deleteMany({ where: { id: ids.plan } }).catch(() => undefined)
  await prisma.subcategory.deleteMany({ where: { id: { in: [ids.sub, ids.special, ids.outSub] } } }).catch(() => undefined)
  await prisma.category.deleteMany({ where: { id: { in: [ids.inPlan, ids.outPlan, ids.blocked] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe.sequential('externalApi — catálogo por empresa', () => {
  it('sem empresa informada devolve o catálogo inteiro (compatível com integrações antigas)', async () => {
    const categories = await listCategories(multi, {})
    expect(categories.map(c => c.id)).toEqual(expect.arrayContaining([ids.inPlan, ids.outPlan, ids.blocked]))
  })

  it('filtra pelo plano da empresa do domínio de requester_email, sem as categorias bloqueadas', async () => {
    const categories = await listCategories(multi, { requester_email: `ana@${domain}` })
    expect(categories).toEqual([{ id: ids.inPlan, name: `No plano ${SUFFIX}`, description: null, icon: '', color: '#0f73ac', image_url: null }])
  })

  it('filtra por organization_id e pela empresa da key travada', async () => {
    expect((await listCategories(multi, { organization_id: ids.org })).map(c => c.id)).toEqual([ids.inPlan])
    expect((await listCategories(locked(), {})).map(c => c.id)).toEqual([ids.inPlan])
  })

  it('subcategorias seguem o mesmo plano e mantêm os campos do formulário especial', async () => {
    const subcategories = await listSubcategories(undefined, multi, { requester_email: `ana@${domain}` })

    expect(subcategories.map(s => s.id)).toEqual([ids.special, ids.sub])
    expect(subcategories[0]).toEqual({
      id: ids.special, name: `A Especial ${SUFFIX}`, category_id: ids.inPlan, description: null, icon: null, image_url: null, is_special: true,
      special_form_schema: [{ key: 'nome', label: 'Nome', type: 'text', required: true }],
      special_title_template: 'Admissão — {nome}',
    })
    expect(await listSubcategories(ids.outPlan, locked(), {})).toEqual([])
  })

  it('plano vencido bloqueia o catálogo com a mensagem da empresa', async () => {
    await expect(listCategories(multi, { requester_email: `ana@${expiredDomain}` }))
      .rejects.toMatchObject({ statusCode: 403, code: 'SLA_PLAN_EXPIRED', message: 'Contrato vencido' })
  })

  it('domínio sem empresa responde API_ORG_NOT_FOUND', async () => {
    await expect(listCategories(multi, { requester_email: 'ana@dominio-desconhecido.example.com' }))
      .rejects.toMatchObject({ code: 'API_ORG_NOT_FOUND' })
  })
})
