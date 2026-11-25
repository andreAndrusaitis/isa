import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as ctrl from '../controllers/inactivitySettings'

const router = Router()

router.use(authenticate)

router.get('/config',        requireCap('inactivity.manage'), ctrl.getConfig)
router.patch('/config',      requireCap('inactivity.manage'), ctrl.updateConfig)
router.get('/logs',          requireCap('inactivity.logs.view'), ctrl.listLogs)
router.post('/trigger',      requireCap('inactivity.manage'), ctrl.triggerManual)

export default router
