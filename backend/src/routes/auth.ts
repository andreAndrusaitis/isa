import { Router } from 'express'
import { login, refresh, logout, me, teamsSsoLogin } from '../controllers/auth'
import { authenticate } from '../middlewares/auth'
import { loginRateLimit, loginAccountRateLimit, refreshRateLimit } from '../middlewares/rateLimiter'

const router = Router()

router.post('/login',   loginRateLimit, loginAccountRateLimit, login)
router.post('/teams',   loginRateLimit, teamsSsoLogin)
router.post('/refresh', refreshRateLimit, refresh)
router.post('/logout',  logout)
router.get('/me',       authenticate, me)

export default router
