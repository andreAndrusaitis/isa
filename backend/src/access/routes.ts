import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from './middleware'
import { CAPABILITIES, CAPABILITY_KEYS } from './capabilities'

const router = Router()

/**
 * Catálogo de capacidades para a tela (ficha de usuário, menu): nome, grupo,
 * cargos que já recebem e a área que libera. A tela não mantém cópia própria.
 */
// Quem edita fichas (users.edit: equipe); cliente final não precisa do mapa.
router.get('/catalog', authenticate, requireCap('users.edit'), (_req, res) => {
  res.json({ data: CAPABILITY_KEYS.map(key => ({ key, ...CAPABILITIES[key] })) })
})

export default router
