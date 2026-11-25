import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap, ticketsAsRequester } from '../access/middleware'
import { TicketController } from '../controllers/tickets'
import { EscalationController } from '../controllers/escalation'
import { SurveyController } from '../controllers/survey'
import * as Trash from '../controllers/trash'

const router = Router()

router.use(authenticate)
router.use(ticketsAsRequester)

router.get('/',    TicketController.list)
router.get('/counts',   TicketController.counts)
router.get('/counts/grouped', TicketController.groupedCounts)
router.get('/activity', TicketController.activity)

// Lixeira: área 'trash' (admin sempre; demais só se o admin conceder).
// Retenção é só do admin. Antes de '/:id' para não virar um id.
router.get('/trash', requireCap('trash.manage'), Trash.list)
router.get('/trash/config', requireCap('trash.manage'), Trash.getConfig)
router.put('/trash/config', requireCap('system.admin'), Trash.updateConfig)
router.post('/:id/restore', requireCap('trash.manage'), Trash.restore)
router.delete('/:id/permanent', requireCap('trash.manage'), Trash.purge)
router.post('/', requireCap('tickets.create'), TicketController.create)
router.get('/:id', TicketController.getById)

router.patch('/:id', requireCap('tickets.work'), TicketController.update)
router.delete('/:id', requireCap('tickets.work'), TicketController.remove)

router.post('/:id/reopen',   TicketController.reopen)
router.post('/:id/confirm',  TicketController.confirm)
router.post('/:id/escalate', requireCap('tickets.work'), EscalationController.execute)
router.post('/:id/escalation/revert', requireCap('tickets.work'), EscalationController.revert)
router.get('/:id/family', EscalationController.family)
router.post('/:id/join', requireCap('tickets.join'), EscalationController.join)
router.post('/:id/messages', TicketController.addMessage)
router.get('/:id/messages',  TicketController.getMessages)
router.patch('/:id/messages/:messageId', TicketController.updateMessage)
router.delete('/:id/messages/:messageId', TicketController.deleteMessage)
router.get('/:id/survey-link', SurveyController.getSurveyLinkForTicket)

export default router
