/**
 * Configuração do bot do Teams (piloto single-tenant).
 * Sem as três chaves o bot fica desligado: a rota responde 503 e a notificação
 * proativa não faz nada.
 */
import { env } from '../../config/env'

export interface BotConfig {
  enabled: boolean
  appId: string
  password: string
  /** Tenant do app (autenticação do bot): o primeiro da lista. */
  homeTenant: string
  /** Tenants de onde o bot aceita conversas (minúsculas). */
  tenants: string[]
  portalUrl: string
}

const list = (value: string | undefined) => (value ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean)

export function botConfig(source: typeof env = env): BotConfig {
  const appId = source.TEAMS_BOT_APP_ID?.trim() ?? ''
  const password = source.TEAMS_BOT_APP_PASSWORD?.trim() ?? ''
  const tenants = list(source.TEAMS_BOT_TENANT_ID)
  return {
    enabled: !!source.TEAMS_BOT_ENABLED && !!appId && !!password && tenants.length > 0,
    appId,
    password,
    homeTenant: tenants[0] ?? '',
    tenants,
    portalUrl: source.PORTAL_URL.replace(/\/+$/, ''),
  }
}

export function tenantAllowed(config: Pick<BotConfig, 'tenants'>, tenantId: string | undefined | null): boolean {
  return !!tenantId && config.tenants.includes(tenantId.toLowerCase())
}
