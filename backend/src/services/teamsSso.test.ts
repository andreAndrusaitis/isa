import { describe, expect, it } from 'vitest'
import { selectMicrosoftSigningKey, validateTeamsSsoClaims } from './teamsSso'

const validClaims = {
  aud: '11111111-1111-4111-8111-111111111111',
  iss: 'https://login.microsoftonline.com/33333333-3333-4333-8333-333333333333/v2.0',
  tid: '33333333-3333-4333-8333-333333333333',
  scp: 'access_as_user',
  preferred_username: 'ana@example.com',
  name: 'Ana Example',
}

describe('validateTeamsSsoClaims', () => {
  it('returns the ISA identity from a token with the configured audience and scope', () => {
    expect(validateTeamsSsoClaims(validClaims)).toEqual({ email: 'ana@example.com', name: 'Ana Example' })
  })

  it.each([
    ['a wrong audience', { ...validClaims, aud: 'other-app-id' }],
    ['a missing access_as_user scope', { ...validClaims, scp: 'openid profile' }],
    ['a mismatched issuer tenant', { ...validClaims, iss: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0' }],
    ['an invalid tenant identifier', { ...validClaims, tid: 'not-a-tenant' }],
    ['no usable email claim', { ...validClaims, preferred_username: undefined, email: undefined }],
  ])('rejects %s', (_label, claims) => {
    expect(() => validateTeamsSsoClaims(claims)).toThrow('Token Teams inválido')
  })
})

describe('selectMicrosoftSigningKey', () => {
  it('accepts a Microsoft RSA signing key when the JWKS omits alg', () => {
    expect(selectMicrosoftSigningKey([{ kid: 'key-1', kty: 'RSA', use: 'sig', issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0' }], 'key-1')).toMatchObject({ kid: 'key-1' })
  })
})
