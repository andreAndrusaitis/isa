import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { ApiKeyController } from '../controllers/apiKeys'

// Área administrativa das API keys de integração — liberada para admin ou com permissão webhooks.
const router = Router()

router.use(authenticate)
router.use(requireCap('integrations.manage'))

router.get('/scopes', ApiKeyController.listScopes)
router.get('/', ApiKeyController.list)
router.post('/', ApiKeyController.create)
router.patch('/:id', ApiKeyController.update)
router.delete('/:id', ApiKeyController.remove)
router.post('/:id/regenerate', ApiKeyController.regenerate)
router.get('/:id/requests', ApiKeyController.listRequests)

export default router
