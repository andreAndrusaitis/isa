import { createPublicKey, type JsonWebKey } from 'node:crypto'
import jwt, { type JwtPayload } from 'jsonwebtoken'
import { z } from 'zod'
import { tenantAllowed } from './ssoSettings'

/** Client id do app do Teams no Entra ID. Vazio = login pelo Teams desligado. */
const teamsClientId = () => process.env.TEAMS_SSO_CLIENT_ID?.trim() ?? ''
const MICROSOFT_JWKS_URL = 'https://login.microsoftonline.com/organizations/discovery/v2.0/keys'
const MICROSOFT_ISSUER = 'https://login.microsoftonline.com/{tenantid}/v2.0'
const JWKS_CACHE_MS = 60 * 60 * 1000

type MicrosoftJwk = JsonWebKey & { kid?: string; issuer?: string; alg?: string; use?: string }

let cachedJwks: { expiresAt: number; keys: MicrosoftJwk[] } | null = null

export type TeamsSsoIdentity = { email: string; name?: string }

function invalidToken(): Error {
  return new Error('Token Teams inválido')
}

function issuerForTenant(tenantId: string): string {
  return MICROSOFT_ISSUER.replace('{tenantid}', tenantId)
}

function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function hasAccessAsUserScope(value: unknown): boolean {
  return typeof value === 'string' && value.split(' ').includes('access_as_user')
}

function hasExpectedAudience(value: unknown): boolean {
  const expected = teamsClientId()
  return Boolean(expected) && (value === expected || (Array.isArray(value) && value.includes(expected)))
}

/**
 * Checks only claims that are meaningful after the JWS signature was verified.
 * Exported separately so policy regressions stay unit-testable without a live Entra key.
 */
export function validateTeamsSsoClaims(claims: JwtPayload): TeamsSsoIdentity {
  if (!hasExpectedAudience(claims.aud) || !hasAccessAsUserScope(claims.scp) || !isTenantId(claims.tid)) {
    throw invalidToken()
  }

  if (claims.iss !== issuerForTenant(claims.tid)) {
    throw invalidToken()
  }

  const email = z.string().trim().email().safeParse(claims.preferred_username)
  if (!email.success) {
    throw invalidToken()
  }

  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : undefined
  return { email: email.data, name }
}

async function getMicrosoftSigningKey(keyId: string): Promise<MicrosoftJwk> {
  if (!cachedJwks || cachedJwks.expiresAt <= Date.now()) {
    const response = await fetch(MICROSOFT_JWKS_URL, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) {
      throw invalidToken()
    }

    const body = await response.json() as { keys?: unknown }
    if (!Array.isArray(body.keys)) {
      throw invalidToken()
    }

    cachedJwks = { expiresAt: Date.now() + JWKS_CACHE_MS, keys: body.keys as MicrosoftJwk[] }
  }

  const key = selectMicrosoftSigningKey(cachedJwks.keys, keyId)
  if (!key) {
    throw invalidToken()
  }

  return key
}

/** Microsoft omits `alg` from its organization JWKS; jwt.verify pins RS256. */
export function selectMicrosoftSigningKey(keys: MicrosoftJwk[], keyId: string): MicrosoftJwk | undefined {
  return keys.find(candidate => candidate.kid === keyId && candidate.kty === 'RSA' && candidate.use === 'sig' && (candidate.alg === undefined || candidate.alg === 'RS256'))
}

function validateSigningKeyIssuer(key: MicrosoftJwk, tenantId: string) {
  const expectedIssuer = issuerForTenant(tenantId)
  const keyIssuer = key.issuer?.replace('{tenantid}', tenantId)
  if (keyIssuer !== expectedIssuer) {
    throw invalidToken()
  }
}

/** Verifies the Microsoft signature and the ISA Teams SSO claim contract. */
export async function verifyTeamsSsoToken(token: string): Promise<TeamsSsoIdentity> {
  // Sem client id configurado nada é aceito: audience vazio faria o jwt.verify pular a checagem.
  if (!teamsClientId()) throw invalidToken()
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded === 'string' || decoded.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string') {
    throw invalidToken()
  }

  const key = await getMicrosoftSigningKey(decoded.header.kid)
  let claims: JwtPayload
  try {
    claims = jwt.verify(token, createPublicKey({ key, format: 'jwk' }), {
      algorithms: ['RS256'],
      audience: teamsClientId(),
    }) as JwtPayload
  } catch {
    throw invalidToken()
  }

  const identity = validateTeamsSsoClaims(claims)
  validateSigningKeyIssuer(key, claims.tid as string)
  if (!await tenantAllowed(claims.tid as string)) throw invalidToken()
  return identity
}
