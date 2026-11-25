import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as templatesService from '../services/templates'

const router = Router()

router.use(authenticate, requireCap('projects.use')) // módulo efetivo (carteira do gerente)

router.get('/', async (req, res, next) => {
  try {
    const scope = req.query.scope as 'project' | 'task' | undefined
    const templates = await templatesService.listTemplates(scope)
    res.json({ data: templates })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = templatesService.createTemplateSchema.parse(req.body)
    const template = await templatesService.createTemplate(req.user!.sub, data)
    res.status(201).json({ data: template })
  } catch (err) { next(err) }
})

export default router
