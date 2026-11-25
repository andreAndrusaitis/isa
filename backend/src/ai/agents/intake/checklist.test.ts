import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../../../config/prisma'
import { loadChecklist } from './checklist'

const SUFFIX = `aichk-${Date.now()}`
let catId: string, subId: string, K: (k: string) => string
const itemIds: string[] = []

beforeAll(async () => {
  catId = (await prisma.category.create({ data: { name: `Cat ${SUFFIX}` } })).id
  subId = (await prisma.subcategory.create({ data: { name: `Sub ${SUFFIX}`, category_id: catId } })).id
  K = k => `${k}_${SUFFIX}`
  // Tipo 'problem' sem seed: todas as linhas são deste teste.
  const base = { type: 'problem' as const, criterion: 'c' }
  for (const d of [
    { key: K('a'), label: 'A', question: 'A do tipo?', sort: 1, subcategory_id: null },
    { key: K('b'), label: 'B', question: 'B do tipo?', sort: 2, subcategory_id: null },
    { key: K('a'), label: 'A', question: 'A da sub?', sort: 5, subcategory_id: subId },
    { key: K('extra'), label: 'Extra', question: 'Extra?', sort: 50, subcategory_id: subId },
    { key: K('inativo'), label: 'Inativo', question: 'Inativo?', sort: 60, subcategory_id: subId, active: false },
  ]) itemIds.push((await prisma.intakeChecklistItem.create({ data: { ...base, ...d } })).id)
})

afterAll(async () => {
  await prisma.intakeChecklistItem.deleteMany({ where: { id: { in: itemIds } } })
  await prisma.subcategory.deleteMany({ where: { id: subId } })
  await prisma.category.deleteMany({ where: { id: catId } })
  await prisma.$disconnect()
})

describe('loadChecklist', () => {
  const mine = async (sub: string | null) =>
    (await loadChecklist('problem', sub)).filter(i => i.key.endsWith(SUFFIX))

  it('subcategoria substitui item do tipo com a mesma key, soma extras e ignora inativos', async () => {
    const items = await mine(subId)
    expect(items.map(i => i.key)).toEqual([K('b'), K('a'), K('extra')])
    expect(items.find(i => i.key === K('a'))?.question).toBe('A da sub?')
  })

  it('sem subcategoria: só os itens do tipo, em ordem', async () => {
    expect((await mine(null)).map(i => i.key)).toEqual([K('a'), K('b')])
  })
})
