import { Router } from 'express'
import { ssoLogin, ssoCallback, ssoLogout } from '../controllers/authSso'

const router = Router()

// O Azure redireciona para /acs via GET (Authorization Code Flow padrão,
// query string ?code=&state=). O caminho é o Redirect URI cadastrado no
// Entra ID: mudar aqui exige mudar lá.
router.get('/login', ssoLogin)
router.get('/acs', ssoCallback)
router.get('/logout', ssoLogout)
router.post('/logout', ssoLogout)

export default router
