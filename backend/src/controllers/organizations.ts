import { Request, Response, NextFunction } from 'express'
import { can } from '../access/can'
import { z } from 'zod'
import * as orgService from '../services/organizations'
import { getAuditInfo } from '../utils/audit'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { getEffectiveScope, assertOrgInScope, getOrgServedBy } from '../services/scope'
import { blockedCategoryIdsForOrg } from '../services/orgCategoryAccess'

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!
    let orgs: any[]
    
    // Carteira não é burlada por permissão de tela; só quem gerencia webhooks (filtro por empresa) vê todas.
    if (can(user, 'orgs.read_all')) {
      orgs = await orgService.listOrganizations()
    } else if (['manager', 'supervisor', 'agent'].includes(user.role)) {
      const scope = await getEffectiveScope(user.sub, user.role)
      orgs = await orgService.listOrganizations(scope)
    } else if (user.orgId) {
      const org = await orgService.getOrganizationById(user.orgId)
      orgs = [org]
    } else {
      orgs = []
    }

    res.json({ data: orgs })
  } catch (err) { next(err) }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string
    const user = req.user!

    await assertOrgInScope(user, id)

    const org = await orgService.getOrganizationById(id)
    res.json({ data: org })
  } catch (err) { next(err) }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = orgService.orgSchema.parse(req.body)
    const audit = getAuditInfo(req)
    const org = await orgService.createOrganization(data, audit)
    res.status(201).json({ data: org })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string
    const user = req.user!

    await assertOrgInScope(user, id)

    const data = orgService.orgSchema.partial().parse(req.body)
    const audit = getAuditInfo(req)
    const org = await orgService.updateOrganization(id, data, audit)
    res.json({ data: org })
  } catch (err) { next(err) }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await assertOrgInScope(req.user!, req.params.id as string)
    const audit = getAuditInfo(req)
    await orgService.deleteOrganization(req.params.id as string, audit)
    res.status(204).end()
  } catch (err) { next(err) }
}

export async function getQueueAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string
    const user = req.user!

    await assertOrgInScope(user, id)

    const access = await prisma.orgQueueAccess.findMany({
      where: { org_id: id },
      include: { queue: true },
    })
    res.json({ data: access })
  } catch (err) { next(err) }
}

export async function upsertQueueAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = String(req.params.id)
    await assertOrgInScope(req.user!, orgId)
    const entries = z.array(z.object({
      queue_id: z.string(),
    })).parse(req.body)

    const results = await Promise.all(entries.map(entry =>
      prisma.orgQueueAccess.upsert({
        where: { org_id_queue_id: { org_id: orgId, queue_id: entry.queue_id } },
        create: {
          org_id: orgId,
          queue_id: entry.queue_id,
        },
        update: {},
        include: { queue: true },
      })
    ))
    res.json({ data: results })
  } catch (err) { next(err) }
}

// ── Quem atende (carteira vista pela empresa) ──────────────────────────────
export async function getServedBy(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string
    await assertOrgInScope(req.user!, id)
    res.json({ data: await getOrgServedBy(id) })
  } catch (err) { next(err) }
}

// Só admin (rota): adicionar a empresa à carteira de um gerente pela tela da empresa.
export async function addServedBy(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.id as string
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body)
    const target = await prisma.user.findFirst({ where: { id: userId, deleted_at: null }, select: { role: true, manager_global: true, name: true } })
    if (!target || target.role !== 'manager') {
      throw new AppError(400, 'Pela empresa só é possível adicionar gerentes. Analistas e Ticket Managers herdam do gerente — ajuste a carteira deles no cadastro do usuário.', 'NOT_A_MANAGER')
    }
    if (target.manager_global) {
      throw new AppError(400, `${target.name} já atende todas as empresas (inclusive novas).`, 'ALREADY_ALL')
    }
    await prisma.userOrgScope.createMany({ data: [{ user_id: userId, org_id: orgId }], skipDuplicates: true })
    res.status(201).json({ data: await getOrgServedBy(orgId) })
  } catch (err) { next(err) }
}

export async function removeServedBy(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.id as string
    const userId = req.params.userId as string
    await prisma.userOrgScope.deleteMany({ where: { user_id: userId, org_id: orgId } })
    res.json({ data: await getOrgServedBy(orgId) })
  } catch (err) { next(err) }
}

// Categorias desligadas para a empresa — o seletor de recategorização as esconde.
export async function getBlockedCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string
    await assertOrgInScope(req.user!, id)
    res.json({ data: [...await blockedCategoryIdsForOrg(id)] })
  } catch (err) { next(err) }
}
