import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'

import * as userController from '../controllers/users'

const router = Router()

router.use(authenticate)

router.get('/',    requireCap('users.edit'), userController.list)
router.patch('/me', userController.updateMe)
router.patch('/me/password', userController.changeMyPassword)

router.post('/',   requireCap('users.edit'), userController.create)
router.get('/:id/scope', requireCap('users.delete'), userController.getScope)
router.get('/:id', requireCap('users.edit'), userController.getById)
router.patch('/:id', requireCap('users.edit'), userController.update)
router.delete('/:id', requireCap('users.delete'), userController.remove)

export default router
