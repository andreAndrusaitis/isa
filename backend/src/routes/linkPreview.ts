/**
 * GET /api/link-preview — pública, sem login. Chamada pelo nginx do front quando um
 * leitor de prévia (Teams, Slack, WhatsApp…) abre um link de /projetos/...
 * Montada antes do limite geral da API: tem limite próprio, que devolve a prévia
 * genérica em vez de 429 (o leitor mostraria um erro no lugar da prévia).
 */
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { logger } from '../utils/logger'
import {
  allowedHost, parseOriginalUri, renderPreviewHtml, resolvePreview,
  GENERIC_TITLE, GENERIC_DESCRIPTION,
} from '../services/linkPreview'

const router = Router()

// O CSP impede qualquer script ou recurso externo na página (só a imagem da prévia).
function send(res: Response, html: string, cache: string) {
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.set('Cache-Control', cache)
  res.set('Content-Security-Policy', "default-src 'none'; img-src https:; base-uri 'none'; form-action 'none'")
  res.set('X-Robots-Tag', 'noindex, nofollow')
  res.status(200).send(html)
}

function generic(req: Request, res: Response, cache: string) {
  const host = allowedHost(req.get('x-forwarded-host'))
  const { path } = parseOriginalUri(req.get('x-original-uri'))
  send(res, renderPreviewHtml({ title: GENERIC_TITLE, description: GENERIC_DESCRIPTION }, host, path), cache)
}

// Todo o tráfego vem do nginx do front (mesmo IP): teto folgado, só contra varredura.
export const linkPreviewRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => generic(req, res, 'no-store'),
})

router.get('/', linkPreviewRateLimit, async (req, res) => {
  try {
    const host = allowedHost(req.get('x-forwarded-host'))
    const link = parseOriginalUri(req.get('x-original-uri'))
    const meta = await resolvePreview(link)
    send(res, renderPreviewHtml(meta, host, link.path), 'public, max-age=300')
  } catch (err) {
    // Nunca 5xx com detalhe: o leitor recebe a prévia genérica.
    logger.warn(`[link-preview] falha ao montar a prévia: ${(err as Error)?.message ?? err}`)
    generic(req, res, 'no-store')
  }
})

export default router
