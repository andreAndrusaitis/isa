import { Router } from 'express'
import * as macroController from '../controllers/macros'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'

const router = Router()

router.use(authenticate)
router.get('/', requireCap('tickets.work'), macroController.list)
router.get('/variables', requireCap('tickets.work'), macroController.variables)
router.post('/render', requireCap('tickets.work'), macroController.render)
router.post('/', requireCap('macros.manage'), macroController.create)
router.patch('/:id', requireCap('macros.manage'), macroController.update)
router.delete('/:id', requireCap('macros.manage'), macroController.remove)

export default router
