/**
 * Cliente OIDC do login Microsoft (Entra ID), montado a partir da configuração em
 * vigor (services/ssoSettings.ts) e refeito quando ela muda.
 *
 * Com um único tenant o login acontece nele. Com vários, ou nenhum, usa o endpoint
 * multi-tenant: a Microsoft autentica a pessoa e quem decide se ela entra somos nós
 * (tenant aceito + conta ou domínio autorizado, em controllers/authSso.ts).
 */
import * as client from 'openid-client'
import { webcrypto, createHash } from 'node:crypto'
import { getSsoConfig, pemBlock, type SsoConfig } from './ssoSettings'

const pemBody = (pem: string) => Buffer.from(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, ''), 'base64')

// O Entra identifica o certificado do client assertion pelo x5t (thumbprint SHA-1,
// RFC 7515 §4.1.7); kid não serve para isso (AADSTS700027).
const certThumbprintX5t = (certPem: string) => createHash('sha1').update(pemBody(certPem)).digest('base64url')

const importPrivateKey = (pem: string): Promise<client.CryptoKey> =>
  webcrypto.subtle.importKey('pkcs8', pemBody(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])

const authority = (config: SsoConfig) => (config.tenants.length === 1 ? config.tenants[0] : 'organizations')

async function clientAuth(config: SsoConfig): Promise<client.ClientAuth> {
  if (config.auth.method === 'secret') return client.ClientSecretPost(config.auth.clientSecret)
  const certificate = pemBlock(config.auth.certificate, 'CERTIFICATE') ?? config.auth.certificate
  const key = await importPrivateKey(pemBlock(config.auth.privateKey, 'PRIVATE KEY') ?? config.auth.privateKey)
  const x5t = certThumbprintX5t(certificate)
  return client.PrivateKeyJwt({ key }, {
    [client.modifyAssertion]: (header, payload) => {
      header.x5t = x5t
      // No endpoint multi-tenant o issuer vem como modelo ("{tenantid}") e a Microsoft
      // recusa como audience (AADSTS700023): vale o token endpoint real.
      payload.aud = `https://login.microsoftonline.com/${authority(config)}/oauth2/v2.0/token`
    },
  })
}

let cached: { version: string; configuration: Promise<client.Configuration> } | null = null

async function buildOidc(config: SsoConfig): Promise<client.Configuration> {
  return client.discovery(
    new URL(`https://login.microsoftonline.com/${authority(config)}/v2.0`),
    config.clientId,
    undefined,
    await clientAuth(config),
  )
}

/** Configuração em vigor + cliente pronto; null quando o login Microsoft está desligado. */
export async function getOidc(): Promise<{ config: SsoConfig; oidc: client.Configuration } | null> {
  const config = await getSsoConfig()
  if (!config) return null
  if (cached?.version !== config.version) {
    const configuration = buildOidc(config)
    cached = { version: config.version, configuration }
    // Falha (Microsoft fora do ar) não fica guardada: a próxima tentativa refaz.
    configuration.catch(() => { if (cached?.configuration === configuration) cached = null })
  }
  return { config, oidc: await cached!.configuration }
}

const HINTS: Record<string, string> = {
  AADSTS700016: 'O aplicativo (client id) não existe nesse tenant.',
  AADSTS7000215: 'O segredo do aplicativo está errado. Use o valor do segredo, não o ID dele.',
  AADSTS7000222: 'O segredo do aplicativo expirou.',
  AADSTS700027: 'O certificado não está cadastrado no aplicativo.',
  AADSTS90002: 'O tenant não existe.',
}

/** Botão "Testar" do admin: prova tenant, client id e credencial sem login de ninguém. */
export async function testOidc(config: SsoConfig): Promise<{ ok: boolean; message: string }> {
  let oidc: client.Configuration
  try {
    oidc = await buildOidc(config)
  } catch {
    return { ok: false, message: 'Não foi possível ler os dados do tenant na Microsoft. Confira o ID do tenant e a conexão do servidor.' }
  }
  if (config.tenants.length !== 1) return { ok: true, message: 'A Microsoft respondeu. Sem um tenant único, a credencial só é conferida no primeiro login.' }
  try {
    await client.clientCredentialsGrant(oidc, { scope: 'https://graph.microsoft.com/.default' })
    return { ok: true, message: 'Tenant, aplicativo e credencial conferidos.' }
  } catch (err) {
    const detail = (err as { error_description?: string }).error_description ?? (err as Error).message
    const code = /AADSTS\d+/.exec(String(detail))?.[0]
    return { ok: false, message: (code && HINTS[code]) || `A Microsoft recusou a credencial${code ? ` (${code})` : ''}.` }
  }
}
