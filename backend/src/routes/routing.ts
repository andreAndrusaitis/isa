import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'

import * as routingController from '../controllers/routing'

const router = Router()

router.use(authenticate)

router.get('/schema', requireCap('routing.manage'), routingController.schema)
router.get('/project-targets', requireCap('routing.manage'), routingController.projectTargets)
router.post('/test', requireCap('routing.manage'), routingController.test)
router.get('/',     requireCap('routing.manage'), routingController.list)
router.post('/',    requireCap('routing.manage'), routingController.create)
router.patch('/:id', requireCap('routing.manage'), routingController.update)
router.delete('/:id', requireCap('routing.manage'), routingController.remove)
router.post('/reorder', requireCap('routing.manage'), routingController.reorder)

export default router
