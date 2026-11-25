/**
 * Bot do Teams.
 * POST /api/teams/messages   endpoint de mensagens do Azure Bot
 *
 * Sem login do app: quem autentica é o SDK (token do Bot Framework assinado,
 * audiência = app id do bot, issuer do tenant do app). Bot desligado = 503.
 */
import { Router, type Request, type Response } from 'express'
import type { CloudAdapter, TurnContext } from '@microsoft/agents-hosting'
import { getBotAdapter } from '../teams/bot/adapter'
import { createBotHandler, type BotDeps } from '../teams/bot/bot'
import { logger } from '../utils/logger'

export function createTeamsBotRouter(deps: { adapter?: () => CloudAdapter | null; bot?: Partial<BotDeps> } = {}) {
  const router = Router()
  const adapterOf = deps.adapter ?? (() => getBotAdapter())
  const onTurn = createBotHandler(deps.bot)

  router.post('/messages', async (req: Request, res: Response) => {
    const adapter = adapterOf()
    if (!adapter) {
      res.status(503).json({ error: 'Bot do Teams desligado neste ambiente', code: 'TEAMS_BOT_DISABLED' })
      return
    }
    let authorized = false
    await adapter.authorizeRequest(req as any, res as any, () => { authorized = true })
    if (!authorized) return
    try {
      await adapter.process(req as any, res as any, (context: TurnContext) => onTurn(context))
    } catch (err: any) {
      logger.error(`[Teams:bot] falha ao processar atividade: ${err?.message ?? err}`)
      if (!res.headersSent) res.status(500).json({ error: 'Falha ao processar a mensagem do Teams', code: 'TEAMS_BOT_ERROR' })
    }
  })

  return router
}

export default createTeamsBotRouter()
