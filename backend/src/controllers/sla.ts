import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import * as slaService from '../services/sla'
import * as packageService from '../services/packages'

const setPlanCategoriesSchema = z.object({ categoryIds: z.array(z.string()) })

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const configs = await slaService.listSlaConfigs()
    res.json({ data: configs })
  } catch (err) { next(err) }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = slaService.slaSchema.parse(req.body)
    const config = await slaService.createSlaConfig(data, req.user?.sub)
    res.status(201).json({ data: config })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = slaService.slaSchema.partial().parse(req.body)
    const config = await slaService.updateSlaConfig(req.params.id as string, data, req.user?.sub)
    res.json({ data: config })
  } catch (err) { next(err) }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await slaService.deleteSlaConfig(req.params.id as string, req.user?.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

// ── Pacotes adicionais (feature 196) ─────────────────────────────────────────

export async function listPackages(req: Request, res: Response, next: NextFunction) {
  try {
    const includeInactive = req.query.include_inactive === 'true'
    const packages = includeInactive
      ? await packageService.listAllPackages()
      : await packageService.listAdditionalPackages()
    res.json({ data: packages })
  } catch (err) { next(err) }
}

export async function createPackage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = packageService.packageSchema.parse(req.body)
    const pkg = await packageService.createPackage(data, req.user?.sub)
    res.status(201).json({ data: pkg })
  } catch (err) { next(err) }
}

export async function updatePackage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = packageService.packageSchema.partial().parse(req.body)
    const pkg = await packageService.updatePackage(req.params.id as string, data, req.user?.sub)
    res.json({ data: pkg })
  } catch (err) { next(err) }
}

export async function setPlanPackages(req: Request, res: Response, next: NextFunction) {
  try {
    const { packageIds } = packageService.setPlanPackagesSchema.parse(req.body)
    const packages = await packageService.setPlanPackages(req.params.id as string, packageIds, req.user?.sub)
    res.json({ data: packages })
  } catch (err) { next(err) }
}

// ── Categorias vinculadas ao plano (N:N) ─────────────────────────────────────

export async function setPlanCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const { categoryIds } = setPlanCategoriesSchema.parse(req.body)
    const categories = await slaService.setPlanCategories(req.params.id as string, categoryIds, req.user?.sub)
    res.json({ data: categories })
  } catch (err) { next(err) }
}

