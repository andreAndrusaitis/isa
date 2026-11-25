import { Router } from 'express'
import { apiKeyRateLimit } from '../middlewares/rateLimiter'
import { authenticateApiKey, requireScope } from '../middlewares/apiKeyAuth'
import { ExternalApiController } from '../controllers/externalApi'

// Rota PÚBLICA da API externa de integração — autenticada por API key
// (não usa JWT). Montada em /api/integrations/v1.
const router = Router()

router.use(authenticateApiKey, apiKeyRateLimit)

router.get('/tickets', requireScope('read_tickets'), ExternalApiController.listTickets)
router.get('/tickets/:id', requireScope('read_tickets'), ExternalApiController.getTicket)
router.post('/tickets', requireScope('create_ticket'), ExternalApiController.createTicket)
router.patch('/tickets/:id', requireScope('update_ticket'), ExternalApiController.updateTicket)
router.post('/tickets/:id/attachments', requireScope('create_ticket'), ExternalApiController.addTicketAttachment)
router.post('/tickets/:id/closure', requireScope('close_ticket'), ExternalApiController.closeTicket)
router.get('/tickets/:id/messages', requireScope('read_messages'), ExternalApiController.listTicketMessages)
router.post('/tickets/:id/messages', requireScope('create_message'), ExternalApiController.createTicketMessage)
router.post('/users', requireScope('create_user'), ExternalApiController.createUser)
router.patch('/users/:idOrEmail', requireScope('update_user'), ExternalApiController.updateUser)
router.get('/categories', requireScope('read_categories'), ExternalApiController.listCategories)
router.get('/subcategories', requireScope('read_subcategories'), ExternalApiController.listSubcategories)
router.get('/queues', requireScope('read_queues'), ExternalApiController.listQueues)
router.get('/organizations', requireScope('read_organizations'), ExternalApiController.listOrganizations)

export default router
