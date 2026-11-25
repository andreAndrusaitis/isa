import { Request, Response } from 'express'
import { z } from 'zod'
import { buildSessionUser, getSessionUser, issueTokens, loginSchema, loginService, refreshService, logoutService, parseDurationMs } from '../services/auth'
import { env } from '../config/env'
import { verifyTeamsSsoToken } from '../services/teamsSso'
import { resolveOrCreateSsoUser } from './authSso'
import { createAuditLog } from '../services/audit'

// O refresh token vive em um cookie httpOnly (inacessível a JavaScript → imune a XSS).
const REFRESH_COOKIE = 'isa_rt'
const isProd = env.NODE_ENV === 'production'

// Em produção front e back ficam em domínios distintos (cross-site) → SameSite=None+Secure.
// Em desenvolvimento (localhost same-site, sem HTTPS) → SameSite=Lax e Secure desligado.
const REMEMBER_ME_MS = 30 * 24 * 60 * 60 * 1000

function refreshCookieOptions(rememberMe = false) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api/auth',
    maxAge: rememberMe ? REMEMBER_ME_MS : parseDurationMs(env.JWT_REFRESH_EXPIRES_IN),
  }
}

// Lê o refresh token: prioriza o cookie, com fallback ao body (compatibilidade transitória).
function extractRefreshToken(req: Request): string | undefined {
  const fromCookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE]
  if (fromCookie) return fromCookie
  const body = z.object({ refreshToken: z.string().optional() }).safeParse(req.body)
  return body.success ? body.data.refreshToken : undefined
}

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body)
  const rememberMe = req.body.rememberMe === true
  const result = await loginService(email, password, rememberMe)

  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(rememberMe))

  // Não devolvemos o refresh token no corpo — ele só existe no cookie httpOnly.
  const { refreshToken, ...safe } = result
  void refreshToken
  res.json({ data: safe })
}

/** Establishes a ISA session from a Teams-issued Entra token. */
export async function teamsSsoLogin(req: Request, res: Response) {
  const authorization = req.get('authorization')
  const token = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/)?.[1]
  if (!token) {
    await createAuditLog({ action: 'LOGIN_FAILED', resource: 'AUTH', details: { reason: 'TEAMS_SSO_INVALID', via: 'teams' } })
    return res.status(401).json({ error: 'Token Teams inválido', code: 'TEAMS_SSO_INVALID' })
  }

  try {
    const identity = await verifyTeamsSsoToken(token)
    const resolution = await resolveOrCreateSsoUser(identity.email, { name: identity.name })
    if (resolution.outcome === 'denied') {
      await createAuditLog({ action: 'LOGIN_FAILED', resource: 'AUTH', details: { email: identity.email, reason: 'TEAMS_SSO_DOMAIN_NOT_AUTHORIZED', via: 'teams' } })
      return res.status(401).json({ error: 'Acesso Microsoft não autorizado para este ISA', code: 'TEAMS_SSO_UNAUTHORIZED' })
    }

    const { accessToken, refreshToken } = await issueTokens(resolution.user, true)
    const user = await buildSessionUser(resolution.user)
    await createAuditLog({ userId: resolution.user.id, action: 'LOGIN', resource: 'AUTH', details: { email: identity.email, via: 'teams' } })
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(true))
    return res.json({ data: { accessToken, user } })
  } catch {
    await createAuditLog({ action: 'LOGIN_FAILED', resource: 'AUTH', details: { reason: 'TEAMS_SSO_INVALID', via: 'teams' } })
    return res.status(401).json({ error: 'Token Teams inválido', code: 'TEAMS_SSO_INVALID' })
  }
}

export async function refresh(req: Request, res: Response) {
  const token = extractRefreshToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Refresh token não fornecido', code: 'UNAUTHORIZED' })
  }

  const result = await refreshService(token)

  // Rotação: grava o novo refresh token no cookie, mantendo os 30 dias do "Lembrar de mim".
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(result.rememberMe))

  const { refreshToken, rememberMe, ...safe } = result
  void refreshToken; void rememberMe
  return res.json({ data: safe })
}

export async function logout(req: Request, res: Response) {
  const token = extractRefreshToken(req)
  if (token) await logoutService(token)

  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api/auth',
  })
  res.json({ data: { ok: true } })
}

/** Sessão atual: perfil, módulos, capacidades e tela inicial. */
export async function me(req: Request, res: Response) {
  res.json({ data: await getSessionUser(req.user!.sub) })
}
