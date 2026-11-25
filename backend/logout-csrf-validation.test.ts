import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const logoutServiceMock = vi.fn().mockResolvedValue(undefined)

vi.mock('./src/config/env', () => ({
  env: {
    NODE_ENV: 'production',
    JWT_REFRESH_EXPIRES_IN: '7d',
  },
}))

vi.mock('./src/services/auth', () => ({
  loginSchema: { parse: vi.fn() },
  loginService: vi.fn(),
  refreshService: vi.fn(),
  logoutService: logoutServiceMock,
  parseDurationMs: vi.fn().mockReturnValue(7 * 24 * 60 * 60 * 1000),
}))

describe('production logout CSRF validation', () => {
  let app: express.Express

  beforeAll(async () => {
    const { logout } = await import('./src/controllers/auth')
    app = express()
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))
    app.use(cookieParser())
    app.post('/api/auth/logout', logout)
  })

  it('accepts a cross-origin form POST with the SameSite=None refresh cookie', async () => {
    const response = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'https://attacker.invalid')
      .set('Cookie', 'isa_rt=victim-refresh-token')
      .type('form')
      .send({})

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { ok: true } })
    expect(logoutServiceMock).toHaveBeenCalledWith('victim-refresh-token')

    const setCookie = ([response.headers['set-cookie']].flat() as (string | undefined)[])
      .filter(Boolean)
      .join(';')
    expect(setCookie).toContain('isa_rt=')
    expect(setCookie).toContain('Path=/api/auth')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=None')
  })
})