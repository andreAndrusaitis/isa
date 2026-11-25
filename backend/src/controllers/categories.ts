import { Request, Response, NextFunction } from 'express'
import * as categoryService from '../services/categories'
import { getAuditInfo } from '../utils/audit'
import { z } from 'zod'
import * as orgCategoryAccess from '../services/orgCategoryAccess'
import { getEffectiveScope } from '../services/scope'

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await categoryService.listCategories()
    res.json({ data: categories })
  } catch (err) { next(err) }
}

// Categorias disponíveis ao usuário logado, filtradas pelo plano da sua empresa.
// Retorna 403 SLA_PLAN_EXPIRED se o plano estiver vencido.
export async function listAvailable(req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await categoryService.getAvailableCategoriesForUser(req.user!.sub)
    res.json({ data: categories })
  } catch (err) { next(err) }
}


export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = categoryService.categorySchema.parse(req.body)
    const audit = getAuditInfo(req)
    const category = await categoryService.createCategory(data, audit)
    res.status(201).json({ data: category })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = categoryService.categorySchema.partial().parse(req.body)
    const audit = getAuditInfo(req)
    const category = await categoryService.updateCategory(req.params.id as string, data, audit)
    res.json({ data: category })
  } catch (err) { next(err) }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const audit = getAuditInfo(req)
    await categoryService.deleteCategory(req.params.id as string, audit)
    res.status(204).end()
  } catch (err) { next(err) }
}

export async function createSub(req: Request, res: Response, next: NextFunction) {
  try {
    const data = categoryService.subcategorySchema.parse(req.body)
    const audit = getAuditInfo(req)
    const sub = await categoryService.createSubcategory(data, audit)
    res.status(201).json({ data: sub })
  } catch (err) { next(err) }
}

export async function updateSub(req: Request, res: Response, next: NextFunction) {
  try {
    const data = categoryService.subcategorySchema.partial().parse(req.body)
    const audit = getAuditInfo(req)
    const sub = await categoryService.updateSubcategory(req.params.id as string, data, audit)
    res.json({ data: sub })
  } catch (err) { next(err) }
}

export async function removeSub(req: Request, res: Response, next: NextFunction) {
  try {
    const audit = getAuditInfo(req)
    await categoryService.deleteSubcategory(req.params.id as string, audit)
    res.status(204).end()
  } catch (err) { next(err) }
}

const setOrgsSchema = z.object({ orgIds: z.array(z.string().min(1)).max(5000), enabled: z.boolean() })

// Contador dos cards: empresas ativas/total por categoria, dentro da carteira de quem pede.
export async function orgSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getEffectiveScope(req.user!.sub, req.user!.role)
    res.json({ data: await orgCategoryAccess.categoryOrgSummary(scope) })
  } catch (err) { next(err) }
}

export async function listOrgs(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getEffectiveScope(req.user!.sub, req.user!.role)
    res.json({ data: await orgCategoryAccess.listCategoryOrgs(req.params.id as string, scope) })
  } catch (err) { next(err) }
}

export async function setOrgs(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgIds, enabled } = setOrgsSchema.parse(req.body)
    const scope = await getEffectiveScope(req.user!.sub, req.user!.role)
    res.json({ data: await orgCategoryAccess.setCategoryOrgs(req.params.id as string, orgIds, enabled, scope, getAuditInfo(req)) })
  } catch (err) { next(err) }
}
