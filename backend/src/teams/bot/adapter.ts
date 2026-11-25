/**
 * CloudAdapter do Microsoft 365 Agents SDK, criado sob demanda. Single-tenant:
 * o token do canal é conferido contra o app id e o tenant do app (issuer
 * validado); a resposta ao Teams sai com o client secret do mesmo app.
 */
import { CloudAdapter, type TurnContext } from '@microsoft/agents-hosting'
import { logger } from '../../utils/logger'
import { botConfig, type BotConfig } from './config'

let cached: { key: string; adapter: CloudAdapter } | null = null

export const TURN_ERROR_TEXT = 'Algo deu errado aqui. Tente de novo em instantes ou abra o chamado pelo portal.'

export function createBotAdapter(config: BotConfig): CloudAdapter {
  const adapter = new CloudAdapter({
    clientId: config.appId,
    clientSecret: config.password,
    tenantId: config.homeTenant,
    authType: 'ClientSecret',
    validateIssuer: true,
  })
  adapter.onTurnError = async (context: TurnContext, error: unknown) => {
    logger.error(`[Teams:bot] erro no turno: ${(error as Error)?.message ?? error}`)
    if (context.activity.type === 'message') await context.sendActivity(TURN_ERROR_TEXT).catch(() => undefined)
  }
  return adapter
}

/** null quando o bot está desligado (sem chaves ou TEAMS_BOT_ENABLED=false). */
export function getBotAdapter(config: BotConfig = botConfig()): CloudAdapter | null {
  if (!config.enabled) return null
  const key = `${config.appId}:${config.homeTenant}`
  if (cached?.key !== key) cached = { key, adapter: createBotAdapter(config) }
  return cached.adapter
}
