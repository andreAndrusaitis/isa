import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as ctrl from '../controllers/reopenSla'

const router = Router()

router.use(authenticate)

router.get('/config',   requireCap('reopen_sla.manage'), ctrl.getConfig)
router.patch('/config', requireCap('reopen_sla.manage'), ctrl.updateConfig)

export default router
