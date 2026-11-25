import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { entraPolicy, validateEntraClaims, verifyEntraToken } from './entraAuth'

const TENANT = '33333333-3333-4333-8333-333333333333'
const AUD = '11111111-1111-4111-8111-111111111111'
const policy = entraPolicy({ TEAMS_SSO_CLIENT_ID: AUD })

const claims = {
  aud: AUD,
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  tid: TENANT,
  scp: 'access_as_user',
  preferred_username: 'ana@example.com',
}

describe('entraPolicy', () => {
  it('usa o app do SSO do Teams e access_as_user por padrão, sem trava de tenant', () => {
    expect(policy).toEqual({ audiences: [AUD], scope: 'access_as_user', tenants: [] })
  })

  it('lê audiences, escopo e tenants das variáveis MCP_ENTRA_*', () => {
    expect(entraPolicy({ MCP_ENTRA_AUDIENCE: 'a, api://b', MCP_ENTRA_SCOPE: 'Chamados.ReadWrite', MCP_ENTRA_TENANTS: TENANT.toUpperCase() })).toEqual({
      audiences: ['a', 'api://b'], scope: 'Chamados.ReadWrite', tenants: [TENANT],
    })
  })
})

describe('validateEntraClaims', () => {
  it('devolve o e-mail e o tenant de um token válido', () => {
    expect(validateEntraClaims(claims, policy)).toEqual({ email: 'ana@example.com', tenantId: TENANT })
  })

  it('aceita upn quando não há preferred_username', () => {
    expect(validateEntraClaims({ ...claims, preferred_username: undefined, upn: 'bia@example.com' }, policy).email).toBe('bia@example.com')
  })

  it.each([
    ['audience de outro app', { ...claims, aud: 'outro-app' }],
    ['sem o escopo exigido', { ...claims, scp: 'openid profile' }],
    ['issuer de outro tenant', { ...claims, iss: 'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0' }],
    ['issuer v1', { ...claims, iss: `https://sts.windows.net/${TENANT}/` }],
    ['tid inválido', { ...claims, tid: 'nao-e-tenant' }],
    ['sem e-mail', { ...claims, preferred_username: undefined }],
  ])('recusa %s', (_label, c) => {
    expect(() => validateEntraClaims(c, policy)).toThrow('Token Microsoft inválido')
  })

  it('recusa tenant fora da lista quando MCP_ENTRA_TENANTS está preenchida', () => {
    expect(() => validateEntraClaims(claims, { ...policy, tenants: ['00000000-0000-4000-8000-000000000000'] })).toThrow()
    expect(validateEntraClaims(claims, { ...policy, tenants: [TENANT] }).tenantId).toBe(TENANT)
  })
})

describe('verifyEntraToken', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0' }
  const sign = (payload: object, kid = 'k1') => jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: kid, expiresIn: '5m' })

  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })))
  })
  afterAll(() => vi.unstubAllGlobals())

  it('confere a assinatura pelo JWKS da Microsoft', async () => {
    await expect(verifyEntraToken(sign(claims))).resolves.toEqual({ email: 'ana@example.com', tenantId: TENANT })
  })

  it('recusa chave desconhecida, assinatura alheia e token expirado', async () => {
    await expect(verifyEntraToken(sign(claims, 'outra'))).rejects.toThrow('Token Microsoft inválido')
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    await expect(verifyEntraToken(jwt.sign(claims, other, { algorithm: 'RS256', keyid: 'k1' }))).rejects.toThrow('Token Microsoft inválido')
    const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, privateKey, { algorithm: 'RS256', keyid: 'k1' })
    await expect(verifyEntraToken(expired)).rejects.toThrow('Token Microsoft inválido')
  })

  it('recusa token HS256', async () => {
    await expect(verifyEntraToken(jwt.sign(claims, 'segredo-qualquer', { keyid: 'k1' }))).rejects.toThrow('Token Microsoft inválido')
  })
})
