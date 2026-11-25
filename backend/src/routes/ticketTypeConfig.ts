import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as ctrl from '../controllers/ticketTypeConfig'

const router = Router()

router.use(authenticate)

// Leitura liberada a qualquer usuário autenticado — agentes precisam saber
// quais tipos estão habilitados para filtrar o modal de troca de tipo.
// Alteração permitida para admin ou com permissão ticket_types.
router.get('/',        ctrl.list)
router.patch('/:type', requireCap('ticket_types.manage'), ctrl.update)

export default router
