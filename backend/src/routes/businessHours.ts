import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as ctrl from '../controllers/businessHours'

const router = Router()

router.use(authenticate)

// Leitura liberada a todo autenticado: o contador de SLA de qualquer perfil depende dela.
router.get('/', ctrl.get)
router.patch('/', requireCap('business_hours.manage'), ctrl.update)

export default router
