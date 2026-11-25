import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { DashboardController } from '../controllers/dashboard'

const router = Router()

router.use(authenticate)
router.use(requireCap('dashboard.view'))

router.get('/shift',         DashboardController.shift)
router.get('/portfolio',     DashboardController.portfolio)
router.get('/overview',      DashboardController.overview)
router.get('/productivity',  DashboardController.productivity)
router.get('/management',    DashboardController.management)
router.get('/corporations',  DashboardController.corporations)
router.get('/inactivity',    DashboardController.inactivity)
router.get('/sla-expiring',  DashboardController.slaExpiring)
router.get('/channels',      DashboardController.channels)

export default router
