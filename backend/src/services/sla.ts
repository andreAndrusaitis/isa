import prisma from '../config/prisma'
import { z } from 'zod'
import { createAuditLog } from './audit'
import { AppError } from '../middlewares/errorHandler'

export const slaSchema = z.object({
  tier: z.string().min(1),
  incident_first_response_hours: z.number().int().min(1),
  incident_resolution_hours: z.number().int().min(1),
  request_first_response_hours: z.number().int().min(1).optional(),
  request_resolution_hours: z.number().int().min(1).optional(),
  problem_first_response_hours: z.number().int().min(1).optional(),
  problem_resolution_hours: z.number().int().min(1).optional(),
  change_first_response_hours: z.number().int().min(1).optional(),
  change_resolution_hours: z.number().int().min(1).optional(),
  // Ids de filas cadastradas (Queue.id). Sem padrão fixo: 'geral' não existe em
  // produção e deixava todo chamado novo numa fila fantasma.
  default_queue: z.string().min(1, 'Escolha a fila padrão do plano'),
  escalation_queue: z.string().min(1, 'Escolha a fila de escalonamento do plano'),
  escalation_minutes: z.number().int().min(1).default(30),
  color: z.string().optional(),
  // category_ids é gerenciado por setPlanCategories (PUT /sla/:tier/categories),
  // não pelo update do plano base — aceito aqui apenas por compatibilidade.
  category_ids: z.array(z.string()).optional(),
})

/** Recusa fila que não existe no cadastro, explicando qual e onde corrigir. */
async function assertQueuesExist(ids: (string | undefined)[]) {
  for (const id of ids) {
    if (id === undefined) continue
    const queue = await prisma.queue.findUnique({ where: { id } })
    if (!queue) {
      throw new AppError(400, `A fila "${id}" não existe no cadastro de filas. Escolha uma fila cadastrada em Filas de Atendimento.`, 'QUEUE_NOT_FOUND')
    }
  }
}

export async function listSlaConfigs() {
  const configs = await prisma.slaConfig.findMany({
    orderBy: { tier: 'asc' },
    include: {
      packages: { include: { package: true }, orderBy: { package: { name: 'asc' } } },
      plan_categories: { include: { category: true } },
    },
  })
  // Achata os vínculos: expõe pacotes adicionais e categorias do plano (N:N).
  return configs.map(({ packages, plan_categories, ...config }) => ({
    ...config,
    packages: packages.map(p => p.package),
    categories: plan_categories.map(pc => pc.category),
  }))
}

export async function createSlaConfig(data: z.input<typeof slaSchema>, actorId?: string) {
  const parsed = slaSchema.parse(data)
  const { category_ids: _ignored, ...rest } = parsed
  await assertQueuesExist([rest.default_queue, rest.escalation_queue])

  const exists = await prisma.slaConfig.findUnique({ where: { tier: rest.tier } })
  if (exists) throw new AppError(409, 'Já existe um plano com esse nome de tier', 'CONFLICT')

  const config = await prisma.slaConfig.create({
    data: {
      tier: rest.tier,
      incident_first_response_hours: rest.incident_first_response_hours,
      incident_resolution_hours: rest.incident_resolution_hours,
      ...(rest.request_first_response_hours !== undefined ? { request_first_response_hours: rest.request_first_response_hours } : {}),
      ...(rest.request_resolution_hours !== undefined ? { request_resolution_hours: rest.request_resolution_hours } : {}),
      ...(rest.problem_first_response_hours !== undefined ? { problem_first_response_hours: rest.problem_first_response_hours } : {}),
      ...(rest.problem_resolution_hours !== undefined ? { problem_resolution_hours: rest.problem_resolution_hours } : {}),
      ...(rest.change_first_response_hours !== undefined ? { change_first_response_hours: rest.change_first_response_hours } : {}),
      ...(rest.change_resolution_hours !== undefined ? { change_resolution_hours: rest.change_resolution_hours } : {}),
      default_queue: rest.default_queue,
      escalation_queue: rest.escalation_queue,
      escalation_minutes: rest.escalation_minutes || 30,
      color: rest.color || '#0f73ac',
    },
  })

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'CREATE_SLA_CONFIG',
      resource: 'SLA',
      details: { id: config.id, tier: config.tier }
    })
  }

  return config
}

export async function updateSlaConfig(id: string, data: Partial<z.infer<typeof slaSchema>>, actorId?: string) {
  const { category_ids: _ignored, ...rest } = data

  const existing = await prisma.slaConfig.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Plano não encontrado', 'PLAN_NOT_FOUND')
  await assertQueuesExist([rest.default_queue, rest.escalation_queue])

  const config = await prisma.slaConfig.update({
    where: { id },
    data: { ...rest } as any,
  })

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'UPDATE_SLA_CONFIG',
      resource: 'SLA',
      details: { id, tier: config.tier, changes: data }
    })
  }

  return config
}

/**
 * Substitui o conjunto de categorias vinculadas a um plano (N:N). Um plano pode
 * liberar várias categorias; uma categoria pode estar em vários planos.
 */
export async function setPlanCategories(id: string, categoryIds: string[], actorId?: string) {
  const cfg = await prisma.slaConfig.findUnique({ where: { id } })
  if (!cfg) throw new AppError(404, 'Plano não encontrado', 'PLAN_NOT_FOUND')

  await prisma.$transaction([
    prisma.planCategory.deleteMany({ where: { sla_config_id: cfg.id } }),
    prisma.planCategory.createMany({
      data: categoryIds.map(category_id => ({ sla_config_id: cfg.id, category_id })),
      skipDuplicates: true,
    }),
  ])

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'SET_PLAN_CATEGORIES',
      resource: 'SLA',
      details: { id, tier: cfg.tier, categoryIds },
    })
  }

  const links = await prisma.planCategory.findMany({
    where: { sla_config_id: cfg.id },
    include: { category: true },
  })
  return links.map(l => l.category)
}

export async function deleteSlaConfig(id: string, actorId?: string) {
  const existing = await prisma.slaConfig.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Plano não encontrado', 'PLAN_NOT_FOUND')

  const result = await prisma.slaConfig.delete({
    where: { id }
  })

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'DELETE_SLA_CONFIG',
      resource: 'SLA',
      details: { id, tier: existing.tier }
    })
  }

  return result
}

