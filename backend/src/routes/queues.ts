import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { QueueController } from '../controllers/queues'

const router = Router()

router.use(authenticate)

router.get('/', QueueController.list)
router.post('/', requireCap('queues.manage'), QueueController.create)
router.patch('/:id', requireCap('queues.manage'), QueueController.update)
router.delete('/:id', requireCap('queues.manage'), QueueController.delete)

router.get('/:id/agents', requireCap('queues.manage'), QueueController.listAgents)
router.post('/:id/agents', requireCap('queues.manage'), QueueController.addAgents)
router.delete('/:id/agents/:userId', requireCap('queues.manage'), QueueController.removeAgent)

export default router
