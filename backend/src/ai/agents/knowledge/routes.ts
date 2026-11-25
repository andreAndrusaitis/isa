/**
 * Sugestão da base de conhecimento no Wizard.
 * POST /api/ai/suggest  sempre 200: { suggestion } com a solução, ou null. A sugestão não
 *                       é requisito da abertura: nem entrada inválida atrapalha o Wizard.
 * GET  /api/ai/suggest/status  { enabled, shadow } do usuário logado: agente em apply ou em shadow, IA configurada e dentro do piloto.
 * POST /api/ai/suggest/:interactionId/accept  "Resolveu meu problema": cria o chamado já resolvido, sem fila. Corpo e resposta de POST /api/tickets,
 *                       mais extra_attachments [{ name, url }] com os anexos além do primeiro (attachment_url).
 * POST /api/ai/feedback  Útil / Não útil na resposta da IA { interactionId, value }; a segunda avaliação substitui a primeira.
 * Montados antes de /api/ai: aquele router exige admin em tudo.
 */
import { Router } from 'express'
import { z } from 'zod'
import prisma from '../../../config/prisma'
import { authenticate } from '../../../middlewares/auth'
import { requireCap, ticketsAsRequester } from '../../../access/middleware'
import { AppError } from '../../../middlewares/errorHandler'
import { suggestRateLimit } from '../../../middlewares/rateLimiter'
import { noNullByte } from '../../knowledge/schemas'
import { acceptSuggestion } from './accept'
import { suggest, suggestStatus, type SuggestDeps } from './agent'

// Chamado não tem teto de texto; aqui o teto só diz até onde vale tentar sugerir.
export const MAX_TITLE_CHARS = 300
export const MAX_DESCRIPTION_CHARS = 10_000

const suggestSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS).refine(noNullByte),
  description: z.string().trim().max(MAX_DESCRIPTION_CHARS).refine(noNullByte).default(''),
  categoryId: z.preprocess(v => v || undefined, z.string().max(100).optional()),
})

export function suggestRouter(deps: SuggestDeps = {}) {
  const router = Router()
  // Mesma porta de POST /api/tickets: quem não atende chamados abre como solicitante.
  router.use(authenticate, ticketsAsRequester, requireCap('tickets.create'))

  router.get('/status', async (req, res) => {
    res.json(await suggestStatus(req.user!.sub))
  })

  router.post('/', suggestRateLimit, async (req, res) => {
    const input = suggestSchema.safeParse(req.body)
    res.json({ suggestion: input.success ? await suggest(input.data, req.user!.sub, deps) : null })
  })

  router.post('/:interactionId/accept', async (req, res) => {
    res.status(201).json({ data: await acceptSuggestion(req) })
  })

  return router
}

const feedbackSchema = z.object({
  interactionId: z.string().uuid(),
  value: z.enum(['useful', 'not_useful']),
})

export const feedbackRouter = Router()
feedbackRouter.use(authenticate)

feedbackRouter.post('/', async (req, res) => {
  const { interactionId, value } = feedbackSchema.parse(req.body)
  // O dono entra no where: interação de outro usuário responde igual à que não existe.
  const { count } = await prisma.aiInteraction.updateMany({ where: { id: interactionId, user_id: req.user!.sub }, data: { feedback: value } })
  if (!count) throw new AppError(404, 'Interação não encontrada', 'AI_INTERACTION_NOT_FOUND')
  res.json({ feedback: value })
})

export default suggestRouter()
