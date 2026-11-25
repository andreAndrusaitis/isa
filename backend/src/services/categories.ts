import prisma from '../config/prisma'
import { Prisma } from '@prisma/client'
import { AppError } from '../middlewares/errorHandler'
import { z } from 'zod'
import { createAuditLog } from './audit'
import { AuditInfo } from '../utils/audit'
import { blockedCategoryIdsForOrg } from './orgCategoryAccess'

export const categorySchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional().default(''),
  color: z.string().optional().default('#0f73ac'),
  description: z.string().optional(),
  image_url: z.string().optional().or(z.literal('')),
  active: z.boolean().default(true),
})

export const specialFormOptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(255),
})

export const specialFormFieldSchema = z.object({
  key: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/, 'Chave deve ser snake_case (ex: nome_completo)'),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'date', 'email', 'select']),
  required: z.boolean().default(true),
  multiple: z.boolean().default(false),
  options: z.array(specialFormOptionSchema).optional(),
}).superRefine((field, ctx) => {
  if (field.type !== 'select') return

  if (!field.options?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Lista precisa de ao menos uma opção', path: ['options'] })
    return
  }

  if (new Set(field.options.map(option => option.value)).size !== field.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valores das opções devem ser únicos', path: ['options'] })
  }
})

export const subcategorySchema = z.object({
  name: z.string().min(1),
  category_id: z.string().min(1),
  active: z.boolean().default(true),
  description: z.string().optional(),
  icon: z.string().optional().default(''),
  image_url: z.string().optional().or(z.literal('')),
  is_special: z.boolean().optional().default(false),
  special_form_schema: z.array(specialFormFieldSchema).optional().nullable(),
  special_title_template: z.string().optional().nullable(),
})

function assertValidSpecialConfig(data: Partial<z.infer<typeof subcategorySchema>>) {
  if (!data.is_special) return
  const fields = data.special_form_schema ?? []
  if (fields.length === 0) {
    throw new AppError(400, 'Chamados especiais precisam de ao menos um campo no formulário', 'SPECIAL_FORM_EMPTY')
  }
  const keys = fields.map(f => f.key)
  if (new Set(keys).size !== keys.length) {
    throw new AppError(400, 'Chaves de campo do formulário especial devem ser únicas', 'SPECIAL_FORM_DUPLICATE_KEY')
  }
}

export async function listCategories() {
  return prisma.category.findMany({
    include: { subcategories: true },
    orderBy: { name: 'asc' },
  })
}

/**
 * Categorias que o usuário pode acessar/abrir chamados: as do plano (tier) da
 * sua empresa, menos as desligadas para ela (org_category_blocks). Se o plano
 * estiver vencido (org.expires_at no passado), bloqueia com 403 SLA_PLAN_EXPIRED.
 */
export async function getAvailableCategoriesForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { org: true },
  })
  if (!user?.org) return []

  if (user.org.expires_at && user.org.expires_at < new Date()) {
    throw new AppError(
      403,
      user.org.expiry_message || 'Plano de SLA vencido: acesso às categorias e abertura de chamados bloqueados.',
      'SLA_PLAN_EXPIRED',
    )
  }

  return getAvailableCategoriesForOrg(user.org.id)
}

/**
 * Categorias do plano (tier) da empresa, ativas e não desligadas para ela, com as
 * subcategorias ativas. Sem a checagem de vencimento: a triagem IA classifica o
 * chamado que já foi aberto e não deve falhar por plano vencido (quem bloqueia a
 * abertura é getAvailableCategoriesForUser). Sem empresa ou sem plano = [].
 */
export async function getAvailableCategoriesForOrg(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { tier: true } })
  if (!org) return []
  const cfg = await prisma.slaConfig.findUnique({
    where: { tier: org.tier },
    include: {
      plan_categories: {
        include: { category: { include: { subcategories: { where: { active: true } } } } },
      },
    },
  })
  if (!cfg) return []

  const blocked = await blockedCategoryIdsForOrg(orgId)
  return cfg.plan_categories
    .map(pc => pc.category)
    .filter(c => c.active && !blocked.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function createCategory(data: z.infer<typeof categorySchema>, audit?: AuditInfo) {
  const cat = await prisma.category.create({ data })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'CREATE_CATEGORY',
      resource: 'CATEGORY',
      details: { categoryId: cat.id, name: cat.name },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }
  return cat
}

export async function updateCategory(id: string, data: Partial<z.infer<typeof categorySchema>>, audit?: AuditInfo) {
  const cat = await prisma.category.update({
    where: { id },
    data,
  })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'UPDATE_CATEGORY',
      resource: 'CATEGORY',
      details: { categoryId: id, changes: data },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }
  return cat
}

export async function deleteCategory(id: string, audit?: AuditInfo) {
  // Check if has subcategories or tickets
  const cat = await prisma.category.findUnique({
    where: { id },
    include: { sla_configs: { select: { tier: true } }, subcategories: { select: { id: true } } },
  })
  if (!cat) throw new AppError(404, 'Categoria não encontrada')

  // Lista todos os vínculos que impedem a exclusão, com contagem, em vez de um 400 genérico.
  const subIds = cat.subcategories.map(s => s.id)
  const ticketWhere = { OR: [{ category_id: id }, ...(subIds.length ? [{ subcategory_id: { in: subIds } }] : [])] }
  const [tickets, trashed] = await Promise.all([
    prisma.ticket.count({ where: ticketWhere }),
    prisma.ticket.count({ where: { ...ticketWhere, deleted_at: { not: null } } }),
  ])
  const blockers: string[] = []
  if (tickets > 0) blockers.push(`${tickets} chamado(s)${trashed ? ` (${trashed} na lixeira)` : ''}`)
  if (cat.sla_configs.length) blockers.push(`plano(s) de SLA: ${cat.sla_configs.map(p => p.tier).join(', ')}`)
  if (blockers.length) {
    throw new AppError(400, `Não é possível excluir a categoria "${cat.name}": vinculada a ${blockers.join(' e ')}. Mova os chamados para outra categoria e desvincule do SLA antes de excluir.`, 'CATEGORY_IN_USE', { tickets, trashed, slaPlans: cat.sla_configs.map(p => p.tier) })
  }
  
  await prisma.subcategory.deleteMany({ where: { category_id: id } })
  const result = await prisma.category.delete({ where: { id } })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'DELETE_CATEGORY',
      resource: 'CATEGORY',
      details: { categoryId: id, name: cat.name },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }
  return result
}

export async function createSubcategory(data: z.infer<typeof subcategorySchema>, audit?: AuditInfo) {
  assertValidSpecialConfig(data)
  const sub = await prisma.subcategory.create({
    data: {
      ...data,
      special_form_schema: data.special_form_schema === null ? Prisma.DbNull : data.special_form_schema ?? undefined,
    },
  })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'CREATE_SUBCATEGORY',
      resource: 'CATEGORY',
      details: { subcategoryId: sub.id, name: sub.name, categoryId: sub.category_id },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }
  return sub
}

export async function updateSubcategory(id: string, data: Partial<z.infer<typeof subcategorySchema>>, audit?: AuditInfo) {
  assertValidSpecialConfig(data)
  const sub = await prisma.subcategory.update({
    where: { id },
    data: {
      ...data,
      special_form_schema: data.special_form_schema === null ? Prisma.DbNull : data.special_form_schema ?? undefined,
    },
  })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'UPDATE_SUBCATEGORY',
      resource: 'CATEGORY',
      details: { subcategoryId: id, changes: data },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }
  return sub
}

export async function deleteSubcategory(id: string, audit?: AuditInfo) {
  const sub = await prisma.subcategory.findUnique({
    where: { id },
    include: { _count: { select: { tickets: true } } },
  })
  if (!sub) throw new AppError(404, 'Subcategoria não encontrada')
  if (sub._count.tickets > 0) {
    const trashed = await prisma.ticket.count({ where: { subcategory_id: id, deleted_at: { not: null } } })
    throw new AppError(400, `Não é possível excluir a subcategoria "${sub.name}": vinculada a ${sub._count.tickets} chamado(s)${trashed ? ` (${trashed} na lixeira)` : ''}. Mova os chamados para outra subcategoria antes de excluir.`, 'SUBCATEGORY_IN_USE', { tickets: sub._count.tickets, trashed })
  }

  const result = await prisma.subcategory.delete({ where: { id } })
  if (audit?.actorId) {
    createAuditLog({
      userId: audit.actorId,
      action: 'DELETE_SUBCATEGORY',
      resource: 'CATEGORY',
      details: { subcategoryId: id, name: sub.name },
      ip: audit.ip,
      userAgent: audit.userAgent
    })
  }
  return result
}
