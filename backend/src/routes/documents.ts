import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { requireProjectRole } from '../middlewares/projectAuthorize'
import * as documentsService from '../services/documents'
import { scopeParamsToProject } from '../middlewares/projectScope'
import { camelizeResponses } from '../utils/serialize'

const router = Router({ mergeParams: true })
scopeParamsToProject(router)

router.use(authenticate, requireCap('projects.use')) // módulo efetivo (carteira do gerente)
// Montado antes do router de projetos (app.ts): sem isto as respostas saíam em snake_case.
router.use(camelizeResponses)

router.get('/', requireProjectRole('owner', 'manager', 'member', 'viewer'), async (req, res, next) => {
  try {
    const documents = await documentsService.listDocuments(req.params.projectId as string)
    res.json({ data: documents })
  } catch (err) { next(err) }
})

router.post('/', requireProjectRole('owner', 'manager', 'member'), async (req, res, next) => {
  try {
    const data = documentsService.createDocumentSchema.parse(req.body)
    const document = await documentsService.createDocument(req.params.projectId as string, req.user!.sub, data)
    res.status(201).json({ data: document })
  } catch (err) { next(err) }
})

router.get('/:documentId', requireProjectRole('owner', 'manager', 'member', 'viewer'), async (req, res, next) => {
  try {
    const document = await documentsService.getDocument(req.params.documentId as string)
    res.json({ data: document })
  } catch (err) { next(err) }
})

router.patch('/:documentId', requireProjectRole('owner', 'manager', 'member'), async (req, res, next) => {
  try {
    const data = documentsService.updateDocumentSchema.parse(req.body)
    const document = await documentsService.updateDocument(req.params.documentId as string, req.user!.sub, data)
    res.json({ data: document })
  } catch (err) { next(err) }
})

export default router
