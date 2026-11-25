import { Request, Response, NextFunction } from 'express'
import * as routingService from '../services/routing'
import { z } from 'zod'

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const rules = await routingService.listRoutingRules()
    res.json({ data: rules })
  } catch (err) { next(err) }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = routingService.routingRuleSchema.parse(req.body)
    const rule = await routingService.createRoutingRule(data, req.user?.sub, req.user)
    res.status(201).json({ data: rule })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = routingService.routingRulePatchSchema.parse(req.body)
    const rule = await routingService.updateRoutingRule(req.params.id as string, data, req.user?.sub, req.user)
    res.json({ data: rule })
  } catch (err) { next(err) }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await routingService.deleteRoutingRule(req.params.id as string, req.user?.sub)
    res.status(204).end()
  } catch (err) { next(err) }
}

export async function reorder(req: Request, res: Response, next: NextFunction) {
  try {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body)
    await routingService.reorderRoutingRules(ids, req.user?.sub)
    res.status(204).end()
  } catch (err) { next(err) }
}

export function schema(_req: Request, res: Response) {
  res.json({ data: routingService.getRoutingSchema() })
}

export async function test(req: Request, res: Response, next: NextFunction) {
  try {
    const { rule, ticket } = z.object({ rule: routingService.routingRuleSchema, ticket: z.string().min(1, 'Informe o chamado') }).parse(req.body)
    res.json({ data: await routingService.testRoutingRule(rule, ticket, req.user) })
  } catch (err) { next(err) }
}

// Opções das ações "criar/vincular task": só projetos onde quem configura edita.
export async function projectTargets(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await routingService.listProjectTargets(req.user!.sub) })
  } catch (err) { next(err) }
}
