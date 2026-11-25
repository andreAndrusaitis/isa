import type { Request, Response } from 'express'
import { createAuditLog } from '../../services/audit'
import { knowledgeGaps } from './gaps'
import * as service from './service'

const audit = (req: Request, action: string, article: { id: string; title: string }) =>
  createAuditLog({
    userId: req.user!.sub,
    action: `KNOWLEDGE_ARTICLE_${action}`,
    resource: 'KNOWLEDGE_ARTICLE',
    details: { articleId: article.id, title: article.title },
    ip: req.ip,
    userAgent: req.get('user-agent'),
  })

const articleId = (req: Request) => String(req.params.id)

export async function create(req: Request, res: Response) {
  const data = await service.createArticle(req.body, req.user!.sub)
  await audit(req, 'CREATE', data)
  res.status(201).json({ data })
}

export async function importFile(req: Request, res: Response) {
  const data = await service.importArticle(req.body, req.user!.sub)
  await audit(req, 'IMPORT', data)
  res.status(201).json({ data })
}

export async function list(_req: Request, res: Response) {
  res.json(await service.listArticles(res.locals.query))
}

export async function gaps(_req: Request, res: Response) {
  res.json({ data: await knowledgeGaps(res.locals.query.days) })
}

export async function get(req: Request, res: Response) {
  res.json({ data: await service.getArticle(articleId(req)) })
}

export async function update(req: Request, res: Response) {
  const data = await service.updateArticle(articleId(req), req.body, req.user!.sub)
  await audit(req, 'UPDATE', data)
  res.json({ data })
}

export async function publish(req: Request, res: Response) {
  const data = await service.publishArticle(articleId(req), req.user!.sub)
  await audit(req, 'PUBLISH', data)
  res.json({ data })
}

export async function unpublish(req: Request, res: Response) {
  const data = await service.unpublishArticle(articleId(req), req.user!.sub)
  await audit(req, 'UNPUBLISH', data)
  res.json({ data })
}

export async function remove(req: Request, res: Response) {
  const article = await service.deleteArticle(articleId(req), req.user!.sub)
  await audit(req, 'DELETE', article)
  res.status(204).end()
}
