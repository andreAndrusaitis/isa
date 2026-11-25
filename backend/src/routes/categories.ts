import { Router } from 'express'
import * as categoryController from '../controllers/categories'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'

const router = Router()


router.use(authenticate)
// Rota literal antes de qualquer '/:param' para não ser capturada por outra.
router.get('/available', categoryController.listAvailable)
router.get('/org-summary', requireCap('categories.manage'), categoryController.orgSummary)
router.get('/', categoryController.list)
router.post('/', requireCap('categories.manage'), categoryController.create)
router.patch('/:id', requireCap('categories.manage'), categoryController.update)
router.delete('/:id', requireCap('categories.manage'), categoryController.remove)

// Empresas com acesso à categoria (Categorias › Empresas).
router.get('/:id/orgs', requireCap('categories.manage'), categoryController.listOrgs)
router.put('/:id/orgs', requireCap('categories.manage'), categoryController.setOrgs)

router.post('/sub', requireCap('categories.manage'), categoryController.createSub)
router.patch('/sub/:id', requireCap('categories.manage'), categoryController.updateSub)
router.delete('/sub/:id', requireCap('categories.manage'), categoryController.removeSub)

export default router
