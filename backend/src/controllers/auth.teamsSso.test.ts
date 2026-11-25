import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verifyTeamsSsoToken: vi.fn(), createAuditLog: vi.fn(), resolveOrCreateSsoUser: vi.fn(), issueTokens: vi.fn(), buildSessionUser: vi.fn() }))

vi.mock('../config/env', () => ({ env: { NODE_ENV: 'test', JWT_REFRESH_EXPIRES_IN: '7d' } }))
vi.mock('../services/teamsSso', () => ({ verifyTeamsSsoToken: mocks.verifyTeamsSsoToken }))
vi.mock('../services/audit', () => ({ createAuditLog: mocks.createAuditLog }))
vi.mock('../services/auth', () => ({
  loginSchema: { parse: vi.fn() }, loginService: vi.fn(), refreshService: vi.fn(), logoutService: vi.fn(), parseDurationMs: vi.fn(), issueTokens: mocks.issueTokens, buildSessionUser: mocks.buildSessionUser, getSessionUser: vi.fn(),
}))
vi.mock('./authSso', () => ({ resolveOrCreateSsoUser: mocks.resolveOrCreateSsoUser }))

import { teamsSsoLogin } from './auth'

function response() {
  const res = { status: vi.fn(), json: vi.fn(), cookie: vi.fn() }
  res.status.mockReturnValue(res)
  return res
}

function request(authorization?: string) {
  return { get: vi.fn().mockReturnValue(authorization) } as never
}

describe('teamsSsoLogin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records a failed Teams SSO attempt without recording the bearer token', async () => {
    mocks.verifyTeamsSsoToken.mockRejectedValue(new Error('signature failed'))
    const res = response()

    await teamsSsoLogin(request('Bearer opaque.teams.token'), res as never)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Token Teams inválido', code: 'TEAMS_SSO_INVALID' })
    expect(mocks.createAuditLog).toHaveBeenCalledWith({ action: 'LOGIN_FAILED', resource: 'AUTH', details: { reason: 'TEAMS_SSO_INVALID', via: 'teams' } })
    expect(JSON.stringify(mocks.createAuditLog.mock.calls)).not.toContain('opaque.teams.token')
  })

  it('records a missing or malformed bearer without echoing the header', async () => {
    const res = response()

    await teamsSsoLogin(request('Basic secret-value'), res as never)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(mocks.verifyTeamsSsoToken).not.toHaveBeenCalled()
    expect(mocks.createAuditLog).toHaveBeenCalledWith({ action: 'LOGIN_FAILED', resource: 'AUTH', details: { reason: 'TEAMS_SSO_INVALID', via: 'teams' } })
    expect(JSON.stringify(mocks.createAuditLog.mock.calls)).not.toContain('secret-value')
  })

  it('audits a successful Teams login as via teams, without the bearer token', async () => {
    const dbUser = { id: 'u1', email: 'ana@cliente.com' }
    mocks.verifyTeamsSsoToken.mockResolvedValue({ email: 'ana@cliente.com', name: 'Ana' })
    mocks.resolveOrCreateSsoUser.mockResolvedValue({ outcome: 'found', user: dbUser })
    mocks.issueTokens.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' })
    mocks.buildSessionUser.mockResolvedValue({ id: 'u1' })
    const res = response()

    await teamsSsoLogin(request('Bearer opaque.teams.token'), res as never)

    expect(mocks.issueTokens).toHaveBeenCalledWith(dbUser, true)
    expect(mocks.createAuditLog).toHaveBeenCalledWith({ userId: 'u1', action: 'LOGIN', resource: 'AUTH', details: { email: 'ana@cliente.com', via: 'teams' } })
    expect(JSON.stringify(mocks.createAuditLog.mock.calls)).not.toContain('opaque.teams.token')
    expect(res.json).toHaveBeenCalledWith({ data: { accessToken: 'access', user: { id: 'u1' } } })
  })
})
