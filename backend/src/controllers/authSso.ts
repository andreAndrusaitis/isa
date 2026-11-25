import { Request, Response } from 'express'
import * as client from 'openid-client'
import prisma from '../config/prisma'
import { issueTokens } from '../services/auth'
import { getOidc } from '../services/oidc'
import { getSsoConfig, ssoIdentity } from '../services/ssoSettings'
import { env } from '../config/env'
import { createAuditLog } from '../services/audit'
import { logger } from '../utils/logger'

const REFRESH_COOKIE = 'isa_rt'
// Guarda PKCE verifier + state + nonce entre /auth/login e /auth/acs. Vida
// curta (5 min) só para cobrir o tempo do handshake com o Azure — não é uma
// sessão, é descartado assim que /auth/acs processa a resposta.
const OIDC_STATE_COOKIE = 'isa_oidc'
const isProd = env.NODE_ENV === 'production'
const FRONT_URL = env.PORTAL_URL

type SsoResolveResult =
  | { outcome: 'found'; user: NonNullable<Awaited<ReturnType<typeof findExistingUser>>> }
  | { outcome: 'created'; user: NonNullable<Awaited<ReturnType<typeof findExistingUser>>> }
  | { outcome: 'denied'; user: null }

function findExistingUser(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' as const }, deleted_at: null, active: true, auth_provider: 'microsoft' },
  })
}

/**
 * Decide se um login SSO é permitido quando o usuário ainda não existe no
 * banco: consulta AuthorizedDomain pelo domínio do e-mail e, se autorizado
 * (domínio ativo + organização ativa), cria o usuário na hora como
 * role='user' vinculado àquela organização. Extraída do ssoCallback para
 * ser testável sem mockar o handshake OIDC completo.
 */
export async function resolveOrCreateSsoUser(
  email: string,
  claims: { name?: string }
): Promise<SsoResolveResult> {
  const existing = await findExistingUser(email)
  if (existing) {
    return { outcome: 'found', user: existing }
  }

  // User.email é @unique no schema — se já existe QUALQUER conta com este
  // e-mail (ex: auth_provider='local' ou desativada), não dá pra criar uma
  // segunda conta 'microsoft' com o mesmo endereço. Negar aqui evita um erro
  // 500 de violação de unique constraint e a ambiguidade de duas contas
  // disputando o mesmo e-mail.
  const emailInUse = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' as const } } })
  if (emailInUse) {
    return { outcome: 'denied', user: null }
  }

  const domain = email.split('@').pop()?.toLowerCase()
  const authorizedDomain = domain
    ? await prisma.authorizedDomain.findFirst({
        where: { domain, active: true, org: { active: true, deleted_at: null } },
      })
    : null

  if (!authorizedDomain) {
    return { outcome: 'denied', user: null }
  }

  const fallbackName = email.split('@')[0]
  const created = await prisma.user.create({
    data: {
      name: claims.name?.trim() || fallbackName,
      email,
      role: 'user',
      org_id: authorizedDomain.org_id,
      auth_provider: 'microsoft',
      active: true,
    },
  })

  await createAuditLog({
    userId: created.id,
    action: 'USER_AUTO_CREATED',
    resource: 'USER',
    details: { email, orgId: authorizedDomain.org_id, domain, via: 'sso_domain' },
  })

  return { outcome: 'created', user: created }
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api/auth',
  }
}

function oidcStateCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/auth',
    maxAge: 5 * 60 * 1000,
  }
}

export async function ssoLogin(_req: Request, res: Response) {
  try {
    const sso = await getOidc()
    if (!sso) return res.redirect(`${FRONT_URL}/login?ssoError=not_configured`)
    const config = sso.oidc
    const codeVerifier = client.randomPKCECodeVerifier()
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
    const state = client.randomState()
    const nonce = client.randomNonce()

    res.cookie(OIDC_STATE_COOKIE, JSON.stringify({ codeVerifier, state, nonce }), oidcStateCookieOptions())

    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: sso.config.callbackUrl,
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    return res.redirect(url.href)
  } catch (err) {
    // getOidc() faz discovery contra o Azure — Azure fora do ar, timeout
    // ou DNS não deve virar 500 cru, o usuário precisa de um erro coerente.
    logger.error(`[SSO] ssoLogin falhou: ${err instanceof Error ? err.stack || err.message : String(err)}`)
    return res.redirect(`${FRONT_URL}/login?ssoError=idp_unavailable`)
  }
}

export async function ssoCallback(req: Request, res: Response) {
  if (!await getSsoConfig()) {
    return res.redirect(`${FRONT_URL}/login?ssoError=not_configured`)
  }

  const raw = req.cookies?.[OIDC_STATE_COOKIE]
  res.clearCookie(OIDC_STATE_COOKIE, { path: '/auth' })
  if (!raw) {
    return res.redirect(`${FRONT_URL}/login?ssoError=invalid_response`)
  }

  let codeVerifier: string, state: string, nonce: string
  try {
    ({ codeVerifier, state, nonce } = JSON.parse(raw))
  } catch {
    return res.redirect(`${FRONT_URL}/login?ssoError=invalid_response`)
  }

  let sso
  try {
    sso = await getOidc()
  } catch (err) {
    logger.error(`[SSO] ssoCallback falhou ao obter config: ${err instanceof Error ? err.stack || err.message : String(err)}`)
    return res.redirect(`${FRONT_URL}/login?ssoError=idp_unavailable`)
  }

  if (!sso) return res.redirect(`${FRONT_URL}/login?ssoError=not_configured`)

  let claims
  try {
    const currentUrl = new URL(req.originalUrl, sso.config.callbackUrl)
    const tokens = await client.authorizationCodeGrant(sso.oidc, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
    })
    claims = tokens.claims()
  } catch (err) {
    const detail = err instanceof Error ? err.stack || err.message : String(err)
    logger.error(`[SSO] ssoCallback falhou ao trocar o code: ${detail}`)
    return res.redirect(`${FRONT_URL}/login?ssoError=invalid_response`)
  }

  const identity = ssoIdentity(sso.config, (claims ?? {}) as Record<string, unknown>)
  if ('error' in identity) {
    if (identity.error === 'tenant_not_allowed') {
      await createAuditLog({ action: 'LOGIN_FAILED', resource: 'AUTH', details: { reason: 'TENANT_NOT_ALLOWED', tid: String(claims?.tid ?? '') } })
    }
    return res.redirect(`${FRONT_URL}/login?ssoError=${identity.error}`)
  }
  const { email } = identity

  const resolution = await resolveOrCreateSsoUser(email, { name: claims?.name as string | undefined })

  if (resolution.outcome === 'denied') {
    await createAuditLog({
      action: 'LOGIN_FAILED',
      resource: 'AUTH',
      details: { email, reason: 'DOMAIN_NOT_AUTHORIZED' },
    })
    return res.redirect(`${FRONT_URL}/login?ssoError=domain_not_allowed`)
  }

  const user = resolution.user

  // rememberMe sempre true no SSO: não há como perguntar "lembrar de mim"
  // antes do redirect ao Azure — a segurança adicional já vem do MFA/
  // Conditional Access do próprio Azure AD.
  const { refreshToken } = await issueTokens(user, true)

  await createAuditLog({
    userId: user.id,
    action: 'LOGIN',
    resource: 'AUTH',
    details: { email: user.email, via: 'oidc' },
  })

  res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions(), maxAge: 30 * 24 * 60 * 60 * 1000 })
  res.redirect(`${FRONT_URL}/sso/callback`)
}

/**
 * Logout — só limpa a sessão local (cookie de refresh já foi removido pelo
 * /api/auth/logout antes de chegar aqui). Sem Single Logout contra o Azure:
 * com múltiplos tenants aceitos (endpoint /common/), não há um único
 * end_session_endpoint correto para redirecionar — a sessão Microsoft da
 * pessoa pode ser de qualquer tenant organizacional.
 */
export async function ssoLogout(_req: Request, res: Response) {
  return res.redirect(`${FRONT_URL}/login`)
}
