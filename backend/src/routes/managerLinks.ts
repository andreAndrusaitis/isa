import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { ManagerLinksController } from '../controllers/managerLinks'

const router = Router()

router.use(authenticate)

// Vínculos e "todas as empresas": só o admin. Nenhuma tela usa a escrita; um
// gerente com acesso aqui ligava manager_global em si mesmo e via todas as empresas.
router.get('/orgs',           requireCap('org_chart.links.view'), ManagerLinksController.listOrgLinks)
router.post('/orgs',          requireCap('system.admin'), ManagerLinksController.createOrgLink)
router.delete('/orgs/:id',    requireCap('system.admin'), ManagerLinksController.deleteOrgLink)
router.patch('/orgs/:id/global',     requireCap('system.admin'), ManagerLinksController.setOrgGlobal)
router.patch('/analysts/:id/global', requireCap('system.admin'), ManagerLinksController.setAnalystGlobal)

// Manager/supervisor: read own scope
router.get('/my/orgs',     requireCap('scope.view_own'), ManagerLinksController.getManagerOrgs)
router.get('/my/analysts', requireCap('scope.view_own'), ManagerLinksController.getManagerAnalysts)

export default router
