import { Request, Response } from 'express'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from '../services/audit'
import { getAuditInfo } from '../utils/audit'
import { getEffectiveScope, scopeOrgWhere } from '../services/scope'

function audit(req: Request, action: string, details: Record<string, unknown>) {
  const { actorId, ip, userAgent } = getAuditInfo(req)
  return createAuditLog({ userId: actorId, action, resource: 'manager_links', details, ip, userAgent })
}

export const ManagerLinksController = {
  // Org links
  async listOrgLinks(req: Request, res: Response) {
    const scope = await getEffectiveScope(req.user!.sub, req.user!.role)
    const links = await prisma.orgManagerLink.findMany({
      where: { org: scopeOrgWhere(scope) },
      include: {
        org: { select: { id: true, name: true, tier: true, manager_global: true } },
        manager: { select: { id: true, name: true } }
      },
      orderBy: { created_at: 'desc' }
    })
    res.json({ data: links })
  },

  async createOrgLink(req: Request, res: Response) {
    const { orgId, managerId } = req.body
    if (!orgId || !managerId) throw new AppError(400, 'orgId e managerId são obrigatórios', 'VALIDATION_ERROR')

    const link = await prisma.orgManagerLink.upsert({
      where: { org_id_manager_id: { org_id: orgId, manager_id: managerId } },
      create: { org_id: orgId, manager_id: managerId },
      update: {},
      include: {
        org: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } }
      }
    })
    await audit(req, 'MANAGER_LINK_CREATED', { orgId, managerId })
    res.status(201).json({ data: link })
  },

  async deleteOrgLink(req: Request, res: Response) {
    const id = req.params.id as string
    const link = await prisma.orgManagerLink.delete({ where: { id } })
    await audit(req, 'MANAGER_LINK_DELETED', { linkId: id, orgId: link.org_id, managerId: link.manager_id })
    res.json({ data: { deleted: true } })
  },

  // Org global flag
  async setOrgGlobal(req: Request, res: Response) {
    const id = req.params.id as string
    const { managerGlobal } = req.body
    const org = await prisma.organization.update({
      where: { id },
      data: { manager_global: Boolean(managerGlobal) },
      select: { id: true, name: true, manager_global: true }
    })
    await audit(req, 'ORG_MANAGER_GLOBAL_SET', { orgId: id, managerGlobal: org.manager_global })
    res.json({ data: org })
  },

  // Analyst global flag
  async setAnalystGlobal(req: Request, res: Response) {
    const id = req.params.id as string
    const { managerGlobal } = req.body
    const user = await prisma.user.update({
      where: { id },
      data: { manager_global: Boolean(managerGlobal) },
      select: { id: true, name: true, manager_global: true }
    })
    await audit(req, 'USER_MANAGER_GLOBAL_SET', { userId: id, managerGlobal: user.manager_global })
    res.json({ data: user })
  },

  // List all orgs accessible by a manager (for the manager's own view)
  async getManagerOrgs(req: Request, res: Response) {
    const managerId = req.user!.sub
    // Vínculos são legado: nunca mostram empresa fora da carteira efetiva.
    const inScope = scopeOrgWhere(await getEffectiveScope(managerId, req.user!.role))
    const [globalOrgs, linkedOrgs] = await Promise.all([
      prisma.organization.findMany({
        where: { ...inScope, manager_global: true, active: true, deleted_at: null },
        select: { id: true, name: true, tier: true, manager_global: true }
      }),
      prisma.orgManagerLink.findMany({
        where: { manager_id: managerId, org: inScope },
        include: { org: { select: { id: true, name: true, tier: true, manager_global: true } } }
      })
    ])
    const seen = new Set<string>()
    const orgs: any[] = []
    for (const o of globalOrgs) {
      seen.add(o.id); orgs.push({ ...o, linkType: 'global' })
    }
    for (const l of linkedOrgs) {
      if (!seen.has(l.org.id)) { seen.add(l.org.id); orgs.push({ ...l.org, linkType: 'specific', linkId: l.id }) }
    }
    res.json({ data: orgs })
  },

  // List all analysts accessible by a manager
  async getManagerAnalysts(req: Request, res: Response) {
    const managerId = req.user!.sub
    const analysts = await prisma.user.findMany({
      where: {
        active: true, deleted_at: null,
        role: { in: ['agent', 'supervisor'] },
        OR: [{ manager_global: true }, { manager_id: managerId }]
      },
      select: { id: true, name: true, avatar: true, role: true, manager_global: true, manager_id: true }
    })
    res.json({ data: analysts })
  }
}
