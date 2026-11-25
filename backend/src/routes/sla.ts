import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as slaController from '../controllers/sla'

const router = Router()

router.use(authenticate)

router.get('/',    requireCap('tickets.work'), slaController.list)
router.post('/',   requireCap('sla.manage'), slaController.create)

// Pacotes adicionais (feature 196): catálogo e alocação a planos.
// Configuração para Admin ou usuários com permissão packages/sla.
router.get('/packages', requireCap('packages.manage'), slaController.listPackages)
router.post('/packages', requireCap('packages.manage'), slaController.createPackage)
router.patch('/packages/:id', requireCap('packages.manage'), slaController.updatePackage)
router.put('/:id/packages', requireCap('packages.manage'), slaController.setPlanPackages)
router.put('/:id/categories', requireCap('packages.manage'), slaController.setPlanCategories)

router.patch('/:id', requireCap('sla.manage'), slaController.update)
router.delete('/:id', requireCap('sla.manage'), slaController.remove)


export default router
