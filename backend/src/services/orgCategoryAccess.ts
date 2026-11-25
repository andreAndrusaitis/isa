import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from './audit'
import { scopeOrgWhere, type EffectiveScope } from './scope'
import type { AuditInfo } from '../utils/audit'

/**
 * Acesso de empresa a categoria. A empresa herda as categorias do plano (tier);
 * cada linha de org_category_blocks desliga uma delas só para aquela empresa.
 * Validação de abertura/recategorização/triagem olha só o bloqueio explícito —
 * quem filtra pelo plano é o wizard (getAvailableCategoriesForUser).
 */

export async function blockedCategoryIdsForOrg(orgId: string): Promise<Set<string>> {
  const rows = await prisma.orgCategoryBlock.findMany({ where: { org_id: orgId }, select: { category_id: true } })
  return new Set(rows.map(r => r.category_id))
}

/** 400 CATEGORY_NOT_AVAILABLE se a categoria (ou a da subcategoria) está desligada para a empresa. */
export async function assertCategoryNotBlocked(
  orgId: string | null | undefined,
  categoryId: string | null | undefined,
  subcategoryId?: string | null,
): Promise<void> {
  if (!orgId) return
  let catId = categoryId ?? null
  if (!catId && subcategoryId) {
    const sub = await prisma.subcategory.findUnique({ where: { id: subcategoryId }, select: { category_id: true } })
    catId = sub?.category_id ?? null
  }
  if (!catId) return
  const block = await prisma.orgCategoryBlock.findUnique({
    where: { org_id_category_id: { org_id: orgId, category_id: catId } },
    select: { id: true },
  })
  if (block) {
    throw new AppError(400, 'Esta categoria não está disponível para a empresa do chamado. Escolha outra categoria.', 'CATEGORY_NOT_AVAILABLE')
  }
}

export interface CategoryOrgRow { id: string; name: string; tier: string; enabled: boolean }

/** Empresas visíveis no escopo: as do plano que inclui a categoria (com status) e as demais. */
export async function listCategoryOrgs(categoryId: string, scope: EffectiveScope) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { plan_categories: { select: { sla_config: { select: { tier: true } } } } },
  })
  if (!category) throw new AppError(404, 'Categoria não encontrada', 'CATEGORY_NOT_FOUND')
  const tiers = new Set(category.plan_categories.map(pc => pc.sla_config.tier))
  const orgs = await prisma.organization.findMany({
    where: { deleted_at: null, ...scopeOrgWhere(scope) },
    select: { id: true, name: true, tier: true, category_blocks: { where: { category_id: categoryId }, select: { id: true } } },
    orderBy: { name: 'asc' },
  })
  const inPlan: CategoryOrgRow[] = []
  const outOfPlan: Omit<CategoryOrgRow, 'enabled'>[] = []
  for (const o of orgs) {
    if (tiers.has(o.tier)) inPlan.push({ id: o.id, name: o.name, tier: o.tier, enabled: o.category_blocks.length === 0 })
    else outOfPlan.push({ id: o.id, name: o.name, tier: o.tier })
  }
  return { inPlan, outOfPlan }
}

/**
 * Habilita (apaga bloqueios) ou desabilita (cria bloqueios) em lote.
 * Desabilitar só vale para empresas do plano no escopo; habilitar vale para qualquer empresa do escopo
 * (remover restrição não amplia nada, e permite limpar bloqueio antigo de quem saiu do plano). Resto → skipped.
 */
export async function setCategoryOrgs(
  categoryId: string, orgIds: string[], enabled: boolean, scope: EffectiveScope, audit?: AuditInfo,
) {
  const { inPlan, outOfPlan } = await listCategoryOrgs(categoryId, scope)
  const eligible = new Set((enabled ? [...inPlan, ...outOfPlan] : inPlan).map(o => o.id))
  const ids = [...new Set(orgIds)]
  const target = ids.filter(id => eligible.has(id))
  const skipped = ids.filter(id => !eligible.has(id)).map(id => ({ id, reason: 'OUT_OF_PLAN_OR_SCOPE' as const }))
  if (target.length) {
    if (enabled) {
      await prisma.orgCategoryBlock.deleteMany({ where: { category_id: categoryId, org_id: { in: target } } })
    } else {
      await prisma.orgCategoryBlock.createMany({
        data: target.map(org_id => ({ org_id, category_id: categoryId, created_by: audit?.actorId ?? null })),
        skipDuplicates: true,
      })
    }
  }
  if (audit?.actorId && target.length) {
    // Aguardado (createAuditLog já engole erro): o registro existe quando a resposta sai.
    await createAuditLog({
      userId: audit.actorId,
      action: enabled ? 'ENABLE_ORG_CATEGORY' : 'DISABLE_ORG_CATEGORY',
      resource: 'CATEGORY',
      details: { categoryId, orgIds: target },
      ip: audit.ip,
      userAgent: audit.userAgent,
    })
  }
  return { updated: target.length, skipped }
}

/** Contador dos cards: por categoria, empresas no escopo cujo plano a inclui (total) e quantas estão ativas. */
export async function categoryOrgSummary(scope: EffectiveScope): Promise<Record<string, { enabled: number; total: number }>> {
  const [plans, orgs, blocks] = await Promise.all([
    prisma.planCategory.findMany({ select: { category_id: true, sla_config: { select: { tier: true } } } }),
    prisma.organization.findMany({ where: { deleted_at: null, ...scopeOrgWhere(scope) }, select: { id: true, tier: true } }),
    prisma.orgCategoryBlock.findMany({ select: { org_id: true, category_id: true } }),
  ])
  const orgsByTier = new Map<string, string[]>()
  for (const o of orgs) {
    const list = orgsByTier.get(o.tier)
    if (list) list.push(o.id)
    else orgsByTier.set(o.tier, [o.id])
  }
  const blocked = new Set(blocks.map(b => `${b.org_id}:${b.category_id}`))
  const out: Record<string, { enabled: number; total: number }> = {}
  for (const pc of plans) {
    const s = (out[pc.category_id] ??= { enabled: 0, total: 0 })
    for (const orgId of orgsByTier.get(pc.sla_config.tier) ?? []) {
      s.total++
      if (!blocked.has(`${orgId}:${pc.category_id}`)) s.enabled++
    }
  }
  return out
}
