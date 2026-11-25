import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { pemBlock, ssoIdentity, ssoInputSchema } from './ssoSettings'

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'

describe('ssoIdentity', () => {
  it('recusa tenant fora da lista, com ou sem e-mail conhecido', () => {
    expect(ssoIdentity({ tenants: [T1] }, { tid: T2, preferred_username: 'ana@empresa.com' })).toEqual({ error: 'tenant_not_allowed' })
    expect(ssoIdentity({ tenants: [T1] }, { preferred_username: 'ana@empresa.com' })).toEqual({ error: 'tenant_not_allowed' })
  })

  it('multi-tenant ignora o claim email, que o outro tenant pode forjar (nOAuth)', () => {
    const claims = { tid: T2, email: 'admin@vitima.com', preferred_username: 'intruso@outro.com' }
    expect(ssoIdentity({ tenants: [] }, claims)).toEqual({ email: 'intruso@outro.com' })
    expect(ssoIdentity({ tenants: [T1, T2] }, claims)).toEqual({ email: 'intruso@outro.com' })
    expect(ssoIdentity({ tenants: [] }, { tid: T2, email: 'admin@vitima.com' })).toEqual({ error: 'missing_email' })
  })

  it('no tenant único usa o e-mail do diretório e cai no UPN', () => {
    expect(ssoIdentity({ tenants: [T1] }, { tid: T1.toUpperCase(), email: 'Ana@Empresa.com', preferred_username: 'ana.s@empresa.com' })).toEqual({ email: 'ana@empresa.com' })
    expect(ssoIdentity({ tenants: [T1] }, { tid: T1, preferred_username: 'ana.s@empresa.com' })).toEqual({ email: 'ana.s@empresa.com' })
  })

  it('preferred_username que não é e-mail não serve', () => {
    expect(ssoIdentity({ tenants: [] }, { tid: T1, preferred_username: '+5511999999999' })).toEqual({ error: 'missing_email' })
  })
})

describe('entrada', () => {
  it('aceita PEM com \\n literal e texto em volta; recusa o que não é PEM', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    expect(pemBlock(`Bag Attributes\n${pem.replace(/\n/g, '\\n')}`, 'PRIVATE KEY')?.trim()).toBe(pem.trim())
    expect(pemBlock('nada aqui', 'PRIVATE KEY')).toBeNull()
  })

  it('exige GUID no client id e nos tenants, e recusa campo desconhecido', () => {
    const ok = { enabled: true, clientId: T1, tenants: [T2], authMethod: 'secret' }
    expect(ssoInputSchema.safeParse(ok).success).toBe(true)
    expect(ssoInputSchema.safeParse({ ...ok, clientId: 'x' }).success).toBe(false)
    expect(ssoInputSchema.safeParse({ ...ok, tenants: ['common/../x'] }).success).toBe(false)
    expect(ssoInputSchema.safeParse({ ...ok, callbackUrl: 'https://mal.com' }).success).toBe(false)
  })
})
