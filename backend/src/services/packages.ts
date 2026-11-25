/**
 * Pacotes Adicionais (feature 196)
 *
 * Permite que um Admin aloque pacotes adicionais (complementos) a planos
 * existentes (SlaConfig), sem alterar o plano base. A criação/gestão do
 * catálogo de pacotes está fora do escopo — aqui apenas listamos o catálogo
 * e gerenciamos os vínculos plano ↔ pacote.
 */
import prisma from '../config/prisma'
import { z } from 'zod'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from './audit'

export const setPlanPackagesSchema = z.object({
  packageIds: z.array(z.string().uuid()),
})

export const packageSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  active: z.boolean().optional(),
})

/** Catálogo de pacotes adicionais ativos disponíveis para alocação. */
export async function listAdditionalPackages() {
  return prisma.additionalPackage.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
  })
}

/** Catálogo completo (inclui inativos) — usado pela tela de gestão. */
export async function listAllPackages() {
  return prisma.additionalPackage.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  })
}

/** Cadastra um novo pacote adicional no catálogo. */
export async function createPackage(data: z.infer<typeof packageSchema>, actorId?: string) {
  const name = data.name.trim()
  const exists = await prisma.additionalPackage.findUnique({ where: { name } })
  if (exists) throw new AppError(409, 'Já existe um pacote adicional com esse nome', 'CONFLICT')

  const pkg = await prisma.additionalPackage.create({
    data: { name, description: data.description?.trim() || null, active: data.active ?? true },
  })

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'CREATE_PACKAGE',
      resource: 'SLA',
      details: { packageId: pkg.id, name: pkg.name },
    })
  }
  return pkg
}

/**
 * Atualiza um pacote do catálogo (nome/descrição/ativo). Desativar um pacote
 * (active: true -> false) o remove das alocações dos planos — um pacote inativo
 * deixa de compor planos e não fica mais disponível para novas alocações.
 */
export async function updatePackage(id: string, data: Partial<z.infer<typeof packageSchema>>, actorId?: string) {
  const existing = await prisma.additionalPackage.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Pacote adicional não encontrado', 'NOT_FOUND')

  const updateData: { name?: string; description?: string | null; active?: boolean } = {}
  if (data.name !== undefined) {
    const name = data.name.trim()
    if (name !== existing.name) {
      const dup = await prisma.additionalPackage.findUnique({ where: { name } })
      if (dup) throw new AppError(409, 'Já existe um pacote adicional com esse nome', 'CONFLICT')
    }
    updateData.name = name
  }
  if (data.description !== undefined) updateData.description = data.description?.trim() || null
  if (data.active !== undefined) updateData.active = data.active

  const deactivating = data.active === false && existing.active === true

  let pkg
  if (deactivating) {
    const [updated] = await prisma.$transaction([
      prisma.additionalPackage.update({ where: { id }, data: updateData }),
      prisma.planAdditionalPackage.deleteMany({ where: { package_id: id } }),
    ])
    pkg = updated
  } else {
    pkg = await prisma.additionalPackage.update({ where: { id }, data: updateData })
  }

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'UPDATE_PACKAGE',
      resource: 'SLA',
      details: { packageId: id, changes: updateData, removedAllocations: deactivating },
    })
  }
  return pkg
}

/** Pacotes adicionais atualmente alocados a um plano (por id do SlaConfig). */
async function getPlanPackages(slaConfigId: string) {
  const links = await prisma.planAdditionalPackage.findMany({
    where: { sla_config_id: slaConfigId },
    include: { package: true },
    orderBy: { package: { name: 'asc' } },
  })
  return links.map(l => l.package)
}

/**
 * Define o conjunto de pacotes adicionais alocados a um plano (identificado
 * pelo id). Substitui a alocação atual: ids enviados passam a estar
 * vinculados; os omitidos são desvinculados. O plano base não é alterado.
 */
export async function setPlanPackages(id: string, packageIds: string[], actorId?: string) {
  const plan = await prisma.slaConfig.findUnique({ where: { id } })
  if (!plan) throw new AppError(404, 'Plano não encontrado', 'NOT_FOUND')

  const uniqueIds = [...new Set(packageIds)]

  if (uniqueIds.length > 0) {
    const found = await prisma.additionalPackage.findMany({
      where: { id: { in: uniqueIds }, active: true },
      select: { id: true },
    })
    if (found.length !== uniqueIds.length) {
      throw new AppError(400, 'Um ou mais pacotes adicionais são inválidos ou estão inativos', 'VALIDATION_ERROR')
    }
  }

  await prisma.$transaction([
    prisma.planAdditionalPackage.deleteMany({ where: { sla_config_id: plan.id } }),
    ...(uniqueIds.length > 0
      ? [prisma.planAdditionalPackage.createMany({
          data: uniqueIds.map(package_id => ({ sla_config_id: plan.id, package_id })),
        })]
      : []),
  ])

  if (actorId) {
    await createAuditLog({
      userId: actorId,
      action: 'SET_PLAN_PACKAGES',
      resource: 'SLA',
      details: { id, tier: plan.tier, packageIds: uniqueIds },
    })
  }

  return getPlanPackages(plan.id)
}
