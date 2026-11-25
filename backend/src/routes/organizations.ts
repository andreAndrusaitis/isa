import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'

import * as orgController from '../controllers/organizations'
import * as authorizedDomainsController from '../controllers/authorizedDomains'

const router = Router()

router.use(authenticate)

router.get('/',     requireCap('orgs.edit'), orgController.list)
router.post('/',    requireCap('orgs.manage'), orgController.create)
router.get('/:id',  requireCap('orgs.view'), orgController.getById)
router.patch('/:id', requireCap('orgs.edit'), orgController.update)
router.delete('/:id', requireCap('orgs.manage'), orgController.remove)

router.get('/:id/queue-access',  requireCap('orgs.edit'), orgController.getQueueAccess)
router.post('/:id/queue-access', requireCap('orgs.manage'), orgController.upsertQueueAccess)

router.get('/:id/served-by',            requireCap('orgs.manage'), orgController.getServedBy)
// Carteira do gerente (quem atende a empresa) é decisão do admin, como "todas as empresas".
router.post('/:id/served-by',           requireCap('system.admin'), orgController.addServedBy)
router.delete('/:id/served-by/:userId', requireCap('system.admin'), orgController.removeServedBy)
router.get('/:id/blocked-categories', requireCap('orgs.edit'), orgController.getBlockedCategories)

router.get('/:id/authorized-domains',                requireCap('orgs.edit'), authorizedDomainsController.list)
router.post('/:id/authorized-domains',               requireCap('orgs.edit'), authorizedDomainsController.create)
router.patch('/:id/authorized-domains/:domainId',    requireCap('orgs.edit'), authorizedDomainsController.update)
router.delete('/:id/authorized-domains/:domainId',   requireCap('orgs.edit'), authorizedDomainsController.remove)

export default router
