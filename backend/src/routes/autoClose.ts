import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as ctrl from '../controllers/autoClose'

const router = Router()

router.use(authenticate)

router.get('/config',   requireCap('auto_close.manage'), ctrl.getConfig)
router.patch('/config', requireCap('auto_close.manage'), ctrl.updateConfig)
router.get('/logs',     requireCap('auto_close.manage'), ctrl.listLogs)
router.post('/trigger', requireCap('auto_close.manage'), ctrl.triggerManual)

export default router
