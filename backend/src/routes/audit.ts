import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { listAuditLogs } from '../controllers/audit'

const router = Router()

// Admins, managers e supervisores (ou quem tem permissão audit) podem ver logs de auditoria
router.use(authenticate)
router.use(requireCap('audit.view'))

router.get('/', listAuditLogs)

export default router
