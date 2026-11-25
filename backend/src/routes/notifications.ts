import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { getUnread, markRead, markTicketRead, markAllRead, getUnreadTasks, markAllTasksRead } from '../controllers/notifications'

const router = Router()

router.use(authenticate)

router.get('/',                          getUnread)
router.patch('/read-all',               markAllRead)
router.get('/tasks',                     getUnreadTasks)
router.patch('/tasks/read-all',         markAllTasksRead)
router.patch('/:id/read',               markRead)
router.patch('/ticket/:ticketId/read',  markTicketRead)

export default router
