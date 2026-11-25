/**
 * Login Microsoft (Entra ID). Vale a configuração salva pelo admin; sem ela, as
 * variáveis de ambiente (AZURE_AD_CLIENT_ID etc.) continuam funcionando.
 */
import { X509Certificate, createPrivateKey } from 'node:crypto'
import { z } from 'zod'
import { env } from '../config/env'
import { AppError } from '../middlewares/errorHandler'
import { clearSetting, openSecret, readSetting, writeSetting } from './systemSettings'
import type { AuditInfo } from '../utils/audit'

const KEY = 'sso_microsoft' as const
const guid = z.string().trim()
  .regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, 'Informe um ID no formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
  .transform(v => v.toLowerCase())
const secret = z.string().trim().min(1).max(20_000)

const valueSchema = z.object({
  enabled: z.boolean(),
  clientId: guid,
  /** Tenants aceitos. Um só: login direto nele. Vazio: qualquer conta corporativa Microsoft. */
  tenants: z.array(guid).max(50),
  authMethod: z.enum(['secret', 'certificate']),
})
export const ssoInputSchema = valueSchema.extend({
  clientSecret: secret.optional(),
  certificate: secret.optional(),
  privateKey: secret.optional(),
}).strict()

export interface SsoConfig {
  source: 'admin' | 'env'
  /** Muda quando a configuração muda: chave do cache do cliente OIDC. */
  version: string
  clientId: string
  tenants: string[]
  callbackUrl: string
  auth: { method: 'secret'; clientSecret: string } | { method: 'certificate'; certificate: string; privateKey: string }
}

/** O login volta sempre pelo endereço do portal (o cookie de sessão é dele). */
export const callbackUrl = () => env.OIDC_CALLBACK_URL || `${String(env.PORTAL_URL).replace(/\/$/, '')}/auth/acs`

/** Aceita PEM colado de qualquer jeito: "\n" literal, atributos antes do bloco, espaços. */
export function pemBlock(raw: string, label: 'CERTIFICATE' | 'PRIVATE KEY'): string | null {
  const text = raw.replace(/\\n/g, '\n')
  const match = text.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`))
  if (!match) return null
  const lines = match[1].replace(/\s/g, '').match(/.{1,64}/g)
  return lines ? `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n` : null
}

function envConfig(): SsoConfig | null {
  if (!env.AZURE_AD_CLIENT_ID || !env.OIDC_CALLBACK_URL || !env.AZURE_AD_CERT || !env.AZURE_AD_PRIVATE_KEY) return null
  return {
    source: 'env', version: 'env', clientId: env.AZURE_AD_CLIENT_ID, tenants: [], callbackUrl: env.OIDC_CALLBACK_URL,
    auth: { method: 'certificate', certificate: env.AZURE_AD_CERT, privateKey: env.AZURE_AD_PRIVATE_KEY },
  }
}

/** Configuração em vigor, ou null quando o login Microsoft está desligado ou incompleto. */
export async function getSsoConfig(): Promise<SsoConfig | null> {
  const row = await readSetting(KEY)
  if (!row) return envConfig()
  const parsed = valueSchema.safeParse(row.value)
  if (!parsed.success || !parsed.data.enabled) return null
  const { clientId, tenants, authMethod } = parsed.data
  const base = { source: 'admin' as const, version: `db:${row.updatedAt}`, clientId, tenants, callbackUrl: callbackUrl() }
  if (authMethod === 'secret') {
    const clientSecret = openSecret(KEY, row, 'clientSecret')
    return clientSecret ? { ...base, auth: { method: 'secret', clientSecret } } : null
  }
  const certificate = openSecret(KEY, row, 'certificate')
  const privateKey = openSecret(KEY, row, 'privateKey')
  return certificate && privateKey ? { ...base, auth: { method: 'certificate', certificate, privateKey } } : null
}

function certificateExpiry(pem: string | null): string | null {
  try { return pem ? new Date(new X509Certificate(pem).validTo).toISOString() : null } catch { return null }
}

/** O que a tela do admin vê: nunca os segredos, só se existem. */
export async function describeSso() {
  const row = await readSetting(KEY, { fresh: true })
  const parsed = valueSchema.safeParse(row?.value)
  const fallback = row ? null : envConfig()
  return {
    source: row ? ('admin' as const) : fallback ? ('env' as const) : null,
    active: Boolean(await getSsoConfig()),
    callbackUrl: fallback?.callbackUrl ?? callbackUrl(),
    enabled: parsed.success ? parsed.data.enabled : Boolean(fallback),
    clientId: parsed.success ? parsed.data.clientId : fallback?.clientId ?? '',
    tenants: parsed.success ? parsed.data.tenants : [],
    authMethod: parsed.success ? parsed.data.authMethod : fallback ? ('certificate' as const) : ('secret' as const),
    hasClientSecret: Boolean(openSecret(KEY, row, 'clientSecret')),
    hasCertificate: Boolean(openSecret(KEY, row, 'certificate') && openSecret(KEY, row, 'privateKey')),
    certificateExpiresAt: certificateExpiry(openSecret(KEY, row, 'certificate')),
  }
}

export async function updateSso(input: unknown, audit: AuditInfo) {
  const { clientSecret, certificate, privateKey, ...value } = ssoInputSchema.parse(input)
  const row = await readSetting(KEY, { fresh: true })
  const secrets: Record<string, string | undefined> = { clientSecret }

  if (certificate || privateKey) {
    const cert = certificate ? pemBlock(certificate, 'CERTIFICATE') : openSecret(KEY, row, 'certificate')
    const key = privateKey ? pemBlock(privateKey, 'PRIVATE KEY') : openSecret(KEY, row, 'privateKey')
    if (!cert || !key) throw new AppError(400, 'Cole o certificado e a chave privada completos, em formato PEM (chave em PKCS#8).', 'SSO_PEM_INVALID')
    let matches = false
    try { matches = new X509Certificate(cert).checkPrivateKey(createPrivateKey(key)) } catch { /* PEM ilegível */ }
    if (!matches) throw new AppError(400, 'A chave privada não corresponde ao certificado.', 'SSO_KEY_MISMATCH')
    secrets.certificate = cert
    secrets.privateKey = key
  }
  if (value.enabled) {
    const ready = value.authMethod === 'secret'
      ? clientSecret || openSecret(KEY, row, 'clientSecret')
      : secrets.certificate || (openSecret(KEY, row, 'certificate') && openSecret(KEY, row, 'privateKey'))
    if (!ready) throw new AppError(400, value.authMethod === 'secret' ? 'Informe o segredo do aplicativo para ligar o login.' : 'Informe o certificado e a chave privada para ligar o login.', 'SSO_SECRET_REQUIRED')
  }
  await writeSetting(KEY, value, secrets, audit)
  return describeSso()
}

export async function resetSso(audit: AuditInfo) {
  await clearSetting(KEY, audit)
  return describeSso()
}

/**
 * A pessoa vem de um tenant aceito? E com que e-mail ela entra.
 * Em login multi-tenant o claim `email` é editável por quem administra o outro tenant
 * e não prova nada (nOAuth); o UPN (preferred_username) exige domínio verificado.
 */
export function ssoIdentity(config: Pick<SsoConfig, 'tenants'>, claims: Record<string, unknown>): { email: string } | { error: 'tenant_not_allowed' | 'missing_email' } {
  const tid = typeof claims.tid === 'string' ? claims.tid.toLowerCase() : ''
  if (config.tenants.length && !config.tenants.includes(tid)) return { error: 'tenant_not_allowed' }
  const valid = (v: unknown) => (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim().toLowerCase() : null)
  const upn = valid(claims.preferred_username)
  const email = config.tenants.length === 1 ? valid(claims.email) ?? upn : upn
  return email ? { email } : { error: 'missing_email' }
}

/** Tenant aceito pela configuração do login Microsoft (vazio = qualquer). Serve a Teams e MCP. */
export async function tenantAllowed(tid: string): Promise<boolean> {
  const tenants = (await getSsoConfig())?.tenants ?? []
  return tenants.length === 0 || tenants.includes(tid.toLowerCase())
}
