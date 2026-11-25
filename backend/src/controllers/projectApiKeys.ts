import { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { getAuditInfo } from '../utils/audit'
import { createAuditLog } from '../services/audit'
import { assertCanTarget } from './projectCollab'
import * as keys from '../services/projectApiKeys'

/**
 * Painel "API" de Projetos. Mesma regra de dono dos webhooks do módulo: cada
 * um vê e mexe só nas chaves que criou (admin vê todas); global só admin; as
 * demais só para projetos em que quem cria é dono/gerente.
 */
const ownKey = (req: Request) => (req.user!.role === 'admin' ? {} : { created_by: req.user!.sub })

function present<T extends { projects: Array<{ project_id: string }> }>(key: T) {
  const { projects, ...rest } = key
  return { ...rest, projectIds: projects.map((p) => p.project_id) }
}

async function ownedOr404(req: Request) {
  const key = await prisma.projectApiKey.findFirst({ where: { id: req.params.keyId as string, ...ownKey(req) }, select: keys.SAFE_SELECT })
  if (!key) throw new AppError(404, 'Chave não encontrada', 'NOT_FOUND')
  return key
}

function audit(req: Request, action: string, details: Record<string, unknown>) {
  const info = getAuditInfo(req)
  return createAuditLog({ userId: info.actorId, action, resource: 'PROJECT_API_KEY', details, ip: info.ip, userAgent: info.userAgent })
}

export function listScopes(_req: Request, res: Response) {
  res.json({ data: keys.PROJECT_API_SCOPES })
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await prisma.projectApiKey.findMany({ where: ownKey(req), select: { ...keys.SAFE_SELECT, _count: { select: { requests: true } } }, orderBy: { created_at: 'desc' } })
    res.json({ data: rows.map(({ _count, ...k }) => ({ ...present(k), requestsCount: _count.requests })) })
  } catch (err) { next(err) }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = keys.projectApiKeySchema.parse(req.body)
    await assertCanTarget(req, data.projectIds)
    const key = await keys.createProjectApiKey(req.user!.sub, data)
    await audit(req, 'CREATE_PROJECT_API_KEY', { keyId: key.id, name: key.name, scopes: key.scopes, projectIds: data.projectIds })
    res.status(201).json({ data: { ...present(key), key: key.key } })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = keys.projectApiKeySchema.partial().parse(req.body)
    const existing = await ownedOr404(req)
    // Sem projectIds no corpo, reconfere os atuais: quem deixou de gerir o projeto não edita mais a chave.
    await assertCanTarget(req, data.projectIds ?? existing.projects.map((p) => p.project_id))
    const key = await keys.updateProjectApiKey(existing.id, data)
    await audit(req, 'UPDATE_PROJECT_API_KEY', { keyId: key.id, changes: Object.keys(data) })
    res.json({ data: present(key) })
  } catch (err) { next(err) }
}

export async function regenerate(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await ownedOr404(req)
    await assertCanTarget(req, existing.projects.map((p) => p.project_id))
    const key = await keys.regenerateProjectApiKey(existing.id)
    await audit(req, 'REGENERATE_PROJECT_API_KEY', { keyId: key.id })
    res.json({ data: { ...present(key), key: key.key } })
  } catch (err) { next(err) }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await ownedOr404(req)
    await keys.deleteProjectApiKey(existing.id)
    await audit(req, 'DELETE_PROJECT_API_KEY', { keyId: existing.id, name: existing.name })
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function listRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await ownedOr404(req)
    const page = Math.max(1, Number(req.query.page) || 1)
    res.json(await keys.listProjectApiKeyRequests(existing.id, page))
  } catch (err) { next(err) }
}
