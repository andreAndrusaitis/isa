/** Configurações do sistema editadas pelo admin, e a parte pública que o login precisa. */
import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { getAuditInfo } from '../utils/audit'
import { getAppearance, resetAppearance, updateAppearance } from '../services/appearance'
import { describeSso, getSsoConfig, resetSso, updateSso } from '../services/ssoSettings'
import { testOidc } from '../services/oidc'
import { getSystemHealth } from '../services/systemHealth'
import { describeAi, resetAi, testAi, updateAi } from '../ai/core/provider'

const router = Router()

// Pública: cores e quais logins existem. Nada além disso.
router.get('/public', async (_req, res) => {
  const [appearance, sso] = await Promise.all([getAppearance(), getSsoConfig()])
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: { appearance, login: { microsoft: Boolean(sso) } } })
})

router.use(authenticate)
router.use(requireCap('system.admin'))

router.get('/health', async (_req, res) => { res.json({ data: await getSystemHealth() }) })

router.put('/appearance', async (req, res) => { res.json({ data: await updateAppearance(req.body, getAuditInfo(req)) }) })
router.delete('/appearance', async (req, res) => { res.json({ data: await resetAppearance(getAuditInfo(req)) }) })

router.get('/sso', async (_req, res) => { res.json({ data: await describeSso() }) })
router.put('/sso', async (req, res) => { res.json({ data: await updateSso(req.body, getAuditInfo(req)) }) })
router.delete('/sso', async (req, res) => { res.json({ data: await resetSso(getAuditInfo(req)) }) })
router.post('/sso/test', async (_req, res) => {
  const config = await getSsoConfig()
  res.json({ data: config ? await testOidc(config) : { ok: false, message: 'Salve e ligue o login Microsoft antes de testar.' } })
})

router.get('/ai', async (_req, res) => { res.json({ data: await describeAi() }) })
router.put('/ai', async (req, res) => { res.json({ data: await updateAi(req.body, getAuditInfo(req)) }) })
router.delete('/ai', async (req, res) => { res.json({ data: await resetAi(getAuditInfo(req)) }) })
router.post('/ai/test', async (req, res) => { res.json({ data: await testAi(req.body) }) })

export default router
