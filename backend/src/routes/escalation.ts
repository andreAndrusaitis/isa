import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { EscalationController } from '../controllers/escalation'

const router = Router()
router.use(authenticate)

// CRUD de regras: Admin, Supervisor, Manager ou permissão escalation
router.get('/',    requireCap('tickets.work'), EscalationController.list)
router.post('/',   requireCap('escalation.manage'), EscalationController.create)
router.patch('/:id', requireCap('escalation.manage'), EscalationController.update)
router.delete('/:id', requireCap('escalation.manage'), EscalationController.remove)

export default router
