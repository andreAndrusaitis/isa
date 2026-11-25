import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { WebhookController } from '../controllers/webhooks'

// Área administrativa de webhooks — liberada para admin ou com permissão explícita.
const router = Router()

router.use(authenticate)
router.use(requireCap('integrations.manage'))

// Lista canônica de eventos (para a UI montar a seleção)
router.get('/events', WebhookController.listEvents)
router.get('/events/:event/example', WebhookController.getEventExample)
router.get('/events/:event/schema', WebhookController.getEventSchema)

// Outbound — endpoints de saída
router.get('/endpoints', WebhookController.listEndpoints)
router.post('/endpoints', WebhookController.createEndpoint)
router.patch('/endpoints/:id', WebhookController.updateEndpoint)
router.delete('/endpoints/:id', WebhookController.deleteEndpoint)
router.post('/endpoints/:id/regenerate-secret', WebhookController.regenerateSecret)
router.post('/endpoints/:id/test', WebhookController.testEndpoint)
router.get('/endpoints/:id/deliveries', WebhookController.listDeliveries)
router.post('/deliveries/:id/retry', WebhookController.retryDelivery)

export default router
