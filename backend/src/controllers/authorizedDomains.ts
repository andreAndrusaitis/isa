import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { AuthorizedDomainService } from '../services/authorizedDomains'
import { getAuditInfo } from '../utils/audit'
import { assertOrgInScope } from '../services/scope'

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.id as string
    await assertOrgInScope(req.user!, orgId)
    const domains = await AuthorizedDomainService.listByOrg(orgId)
    res.json({ data: domains })
  } catch (err) { next(err) }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.id as string
    await assertOrgInScope(req.user!, orgId)
    const { domain } = z.object({ domain: z.string().min(1) }).parse(req.body)
    const audit = getAuditInfo(req)
    const created = await AuthorizedDomainService.create(orgId, domain, audit)
    res.status(201).json({ data: created })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.id as string
    const id = req.params.domainId as string
    await assertOrgInScope(req.user!, orgId)
    const { active } = z.object({ active: z.boolean() }).parse(req.body)
    const audit = getAuditInfo(req)
    const updated = await AuthorizedDomainService.setActive(orgId, id, active, audit)
    res.json({ data: updated })
  } catch (err) { next(err) }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.id as string
    const id = req.params.domainId as string
    await assertOrgInScope(req.user!, orgId)
    const audit = getAuditInfo(req)
    await AuthorizedDomainService.delete(orgId, id, audit)
    res.status(204).end()
  } catch (err) { next(err) }
}
