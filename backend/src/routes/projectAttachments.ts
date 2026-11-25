import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { requireProjectRole } from '../middlewares/projectAuthorize'
import * as attachmentsService from '../services/projectAttachments'
import { camelizeResponses } from '../utils/serialize'

const router = Router({ mergeParams: true })

router.use(authenticate, requireCap('projects.use')) // módulo efetivo (carteira do gerente)
router.use(camelizeResponses)

router.get('/', requireProjectRole('owner', 'manager', 'member', 'viewer'), async (req, res, next) => {
  try {
    const type = req.query.type as string | undefined
    const taskId = req.query.taskId as string | undefined // sempre limitado ao :projectId
    const attachments = await attachmentsService.listAttachments(req.params.projectId as string, { type, taskId })
    res.json({ data: attachments })
  } catch (err) { next(err) }
})

router.post('/', requireProjectRole('owner', 'manager', 'member'), async (req, res, next) => {
  try {
    const data = attachmentsService.createAttachmentSchema.parse(req.body)
    const attachment = await attachmentsService.createAttachment(req.params.projectId as string, req.user!.sub, data)
    res.status(201).json({ data: attachment })
  } catch (err) { next(err) }
})

export default router
