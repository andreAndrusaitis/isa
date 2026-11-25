import { afterAll, beforeAll, expect, it } from 'vitest'
// Grava em banco real: rodar só contra o banco descartável (127.0.0.1:5434).
import prisma from '../config/prisma'
import { deleteCategory, deleteSubcategory } from './categories'

const tag = `catdel-${Date.now()}`
let userId = ''
const catIds: string[] = []
const ticketIds: string[] = []
let slaId = ''

async function mkTicket(data: Record<string, unknown>) {
  const id = `${tag}-${ticketIds.length}`
  await prisma.ticket.create({ data: { id, title: 't', description: 'd', user_id: userId, display_number: `ISA-${id}`, sla_deadline: new Date(Date.now() + 864e5), ...data } as any })
  ticketIds.push(id)
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: tag, email: `${tag}@t.local`, role: 'user', auth_provider: 'local', active: true } })).id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
  if (slaId) await prisma.slaConfig.deleteMany({ where: { id: slaId } })
  await prisma.subcategory.deleteMany({ where: { category_id: { in: catIds } } })
  await prisma.category.deleteMany({ where: { id: { in: catIds } } })
  await prisma.user.deleteMany({ where: { id: userId } })
})

it('categoria com chamados (inclusive na lixeira e via subcategoria) diz quantos e por quê', async () => {
  const cat = await prisma.category.create({ data: { name: `Cat ${tag}` } })
  catIds.push(cat.id)
  const sub = await prisma.subcategory.create({ data: { name: 'Sub', category_id: cat.id } })
  await mkTicket({ category_id: cat.id })
  await mkTicket({ subcategory_id: sub.id, deleted_at: new Date() })
  await expect(deleteCategory(cat.id)).rejects.toMatchObject({ statusCode: 400, code: 'CATEGORY_IN_USE', message: expect.stringContaining('2 chamado(s) (1 na lixeira)') })
  await expect(deleteSubcategory(sub.id)).rejects.toMatchObject({ code: 'SUBCATEGORY_IN_USE', message: expect.stringContaining('1 chamado(s) (1 na lixeira)') })
})

it('categoria vinculada a plano de SLA cita o plano em vez de 409 genérico', async () => {
  const cat = await prisma.category.create({ data: { name: `CatSla ${tag}` } })
  catIds.push(cat.id)
  slaId = (await prisma.slaConfig.create({ data: { tier: `tier-${tag}`, incident_first_response_hours: 1, incident_resolution_hours: 1, request_first_response_hours: 1, request_resolution_hours: 1, category_id: cat.id } as any })).id
  await expect(deleteCategory(cat.id)).rejects.toMatchObject({ code: 'CATEGORY_IN_USE', message: expect.stringContaining(`tier-${tag}`) })
})

it('categoria livre é excluída', async () => {
  const cat = await prisma.category.create({ data: { name: `Livre ${tag}` } })
  await deleteCategory(cat.id)
  expect(await prisma.category.findUnique({ where: { id: cat.id } })).toBeNull()
})
