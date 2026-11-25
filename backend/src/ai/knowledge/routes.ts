/**
 * Base de conhecimento (admin).
 * POST   /api/knowledge               cria rascunho
 * POST   /api/knowledge/import        cria rascunho de um arquivo (PDF, DOCX, TXT, Markdown) em data URI
 * GET    /api/knowledge               lista (page, pageSize, status, categoryId), sem o conteúdo
 * GET    /api/knowledge/gaps          perguntas mais frequentes sem resposta (days, padrão 30)
 * GET    /api/knowledge/:id           artigo completo
 * PUT    /api/knowledge/:id           edita; publicado com texto novo é reindexado
 * POST   /api/knowledge/:id/publish   publica e indexa; exige categoria ativa e IA configurada
 * POST   /api/knowledge/:id/unpublish volta para rascunho e remove os pedaços
 * DELETE /api/knowledge/:id           exclusão lógica; remove os pedaços
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import type { ZodTypeAny } from 'zod'
import { authenticate } from '../../middlewares/auth'
import { requireCap } from '../../access/middleware'
import { AppError } from '../../middlewares/errorHandler'
import * as controller from './controller'
import { createSchema, gapsSchema, importSchema, listSchema, updateSchema } from './schemas'

const body = (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
  req.body = schema.parse(req.body)
  next()
}

// req.query é somente leitura no Express 5.
const query = (schema: ZodTypeAny) => (req: Request, res: Response, next: NextFunction) => {
  res.locals.query = schema.parse(req.query)
  next()
}

const router = Router()
router.use(authenticate, requireCap('system.admin'))

router.post('/', body(createSchema), controller.create)
router.post('/import', body(importSchema), controller.importFile)
router.get('/', query(listSchema), controller.list)
router.get('/gaps', query(gapsSchema), controller.gaps)
router.get('/:id', controller.get)
router.put('/:id', body(updateSchema), controller.update)
router.post('/:id/publish', controller.publish)
router.post('/:id/unpublish', controller.unpublish)
router.delete('/:id', controller.remove)

// O errorHandler global tira `details` em produção; aqui é orientação ao admin, não dado técnico.
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError && err.details) return res.status(err.statusCode).json({ error: err.message, code: err.code, details: err.details })
  return next(err)
})

export default router
