import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSsoConfig = vi.hoisted(() => vi.fn())
const discovery = vi.hoisted(() => vi.fn())
vi.mock('./ssoSettings', async original => ({ ...await original<object>(), getSsoConfig }))
vi.mock('openid-client', async original => ({ ...await original<object>(), discovery }))

const config = (extra: object = {}) => ({
  source: 'admin', version: 'db:1', clientId: 'app', tenants: [], callbackUrl: 'https://portal.example.org/auth/acs',
  auth: { method: 'secret', clientSecret: 'x' }, ...extra,
})

describe('getOidc', () => {
  beforeEach(() => { vi.resetModules(); getSsoConfig.mockReset(); discovery.mockReset(); discovery.mockResolvedValue({}) })
  const load = async () => (await import('./oidc')).getOidc

  it('null quando o login Microsoft está desligado', async () => {
    getSsoConfig.mockResolvedValue(null)
    expect(await (await load())()).toBeNull()
    expect(discovery).not.toHaveBeenCalled()
  })

  it('um tenant: login direto nele; vários ou nenhum: endpoint multi-tenant', async () => {
    const getOidc = await load()
    getSsoConfig.mockResolvedValue(config({ tenants: ['t1'] }))
    await getOidc()
    expect(String(discovery.mock.calls[0][0])).toBe('https://login.microsoftonline.com/t1/v2.0')
    getSsoConfig.mockResolvedValue(config({ version: 'db:2', tenants: ['t1', 't2'] }))
    await getOidc()
    expect(String(discovery.mock.calls[1][0])).toBe('https://login.microsoftonline.com/organizations/v2.0')
  })

  it('reaproveita o cliente até a configuração mudar e não guarda falha', async () => {
    const getOidc = await load()
    getSsoConfig.mockResolvedValue(config())
    discovery.mockRejectedValueOnce(new Error('fora do ar'))
    await expect(getOidc()).rejects.toThrow('fora do ar')
    await getOidc()
    await getOidc()
    expect(discovery).toHaveBeenCalledTimes(2)
    getSsoConfig.mockResolvedValue(config({ version: 'db:9' }))
    await getOidc()
    expect(discovery).toHaveBeenCalledTimes(3)
  })
})
