import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { TicketService } from './tickets'
import { listSlaConfigs, createSlaConfig, setPlanCategories } from './sla'

const SUFFIX = `contract-${Date.now()}`
let orgExpiredId: string
let orgActiveId: string
let orgNoExpiryId: string
let requesterExpiredId: string
let requesterActiveId: string
let requesterNoExpiryId: string
let categoryId: string

beforeAll(async () => {
  // Criar categoria
  const cat = await prisma.category.create({
    data: { name: `Cat ${SUFFIX}` }
  })
  categoryId = cat.id

  // Criar organização com contrato expirado
  const orgExpired = await prisma.organization.create({
    data: {
      name: `Org Expired ${SUFFIX}`,
      expires_at: new Date(Date.now() - 3600000), // 1 hora atrás
      expiry_message: 'Seu plano de suporte expirou.',
      tier: 'bronze'
    }
  })
  orgExpiredId = orgExpired.id

  // Criar organização com contrato ativo (futuro)
  const orgActive = await prisma.organization.create({
    data: {
      name: `Org Active ${SUFFIX}`,
      expires_at: new Date(Date.now() + 86400000), // amanhã
      tier: 'bronze'
    }
  })
  orgActiveId = orgActive.id

  // Criar organização sem expiração
  const orgNoExpiry = await prisma.organization.create({
    data: {
      name: `Org No Expiry ${SUFFIX}`,
      tier: 'bronze'
    }
  })
  orgNoExpiryId = orgNoExpiry.id

  // Criar solicitantes
  const [reqExp, reqAct, reqNoExp] = await Promise.all([
    prisma.user.create({ data: { name: `Req Exp ${SUFFIX}`, email: `reqexp-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgExpiredId } }),
    prisma.user.create({ data: { name: `Req Act ${SUFFIX}`, email: `reqact-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgActiveId } }),
    prisma.user.create({ data: { name: `Req NoExp ${SUFFIX}`, email: `reqnoexp-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgNoExpiryId } }),
  ])
  requesterExpiredId = reqExp.id
  requesterActiveId = reqAct.id
  requesterNoExpiryId = reqNoExp.id
})

afterAll(async () => {
  // Limpeza
  await prisma.ticket.deleteMany({ where: { user_id: { in: [requesterExpiredId, requesterActiveId, requesterNoExpiryId] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [requesterExpiredId, requesterActiveId, requesterNoExpiryId] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: { in: [orgExpiredId, orgActiveId, orgNoExpiryId] } } }).catch(() => {})
  await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('Validação de Vencimento de Contrato no Plano de SLA', () => {
  it('bloqueia a criação de chamados se a sustentação estiver vencida', async () => {
    await expect(
      TicketService.createTicket({
        title: 'Chamado bloqueado',
        description: 'Deve falhar',
        category_id: categoryId,
        priority: 'medium',
        org_id: orgExpiredId,
        user_id: requesterExpiredId
      }, requesterExpiredId)
    ).rejects.toThrowError(/Seu plano de suporte expirou/i)
  })

  it('permite a criação de chamados se a sustentação estiver ativa (futuro)', async () => {
    const t = await TicketService.createTicket({
      title: 'Chamado ativo',
      description: 'Deve funcionar',
      category_id: categoryId,
      priority: 'medium',
      org_id: orgActiveId,
      user_id: requesterActiveId
    }, requesterActiveId)
    
    expect(t.id).toBeTruthy()
    expect(t.title).toBe('Chamado ativo')
  })

  it('permite a criação de chamados se a sustentação não possuir data de vencimento', async () => {
    const t = await TicketService.createTicket({
      title: 'Chamado sem vencimento',
      description: 'Deve funcionar',
      category_id: categoryId,
      priority: 'medium',
      org_id: orgNoExpiryId,
      user_id: requesterNoExpiryId
    }, requesterNoExpiryId)
    
    expect(t.id).toBeTruthy()
    expect(t.title).toBe('Chamado sem vencimento')
  })
})

describe('Configuração de Planos de SLA com Categorias (N:N)', () => {
  it('permite criar um plano e vincular várias categorias', async () => {
    const tierName = `test-tier-${Date.now()}`

    // Criar o plano base (filas precisam existir no cadastro)
    const queue = await prisma.queue.create({ data: { id: `q-${tierName}`, name: `Fila ${tierName}` } as any })
    const sla = await createSlaConfig({
      tier: tierName,
      incident_first_response_hours: 8,
      incident_resolution_hours: 48,
      default_queue: queue.id,
      escalation_queue: queue.id,
      color: '#ff00ff',
    })
    expect(sla.tier).toBe(tierName)

    // Vincular categoria(s) ao plano (N:N)
    const cats = await setPlanCategories(sla.id, [categoryId])
    expect(cats.map(c => c.id)).toContain(categoryId)

    // Ler as configurações e verificar se as categorias vêm juntas
    const list = await listSlaConfigs()
    const found = list.find(s => s.tier === tierName)
    expect(found).toBeTruthy()
    expect(found?.categories?.map((c: any) => c.name)).toContain(`Cat ${SUFFIX}`)

    // Limpar o plano criado (cascade remove os vínculos plan_categories)
    await prisma.slaConfig.delete({ where: { tier: tierName } }).catch(() => {})
  })
})
