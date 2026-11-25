import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { camelizeResponses } from '../utils/serialize'
import * as McpTokensController from '../controllers/mcpTokens'

const router = Router()

router.use(authenticate, requireCap('projects.use')) // módulo efetivo (carteira do gerente)
router.use(camelizeResponses)

router.get('/', McpTokensController.list)
router.post('/', McpTokensController.create)
router.delete('/:tokenId', McpTokensController.revoke)

export default router
