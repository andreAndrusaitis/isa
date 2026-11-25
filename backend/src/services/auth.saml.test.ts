import { describe, it, expect } from 'vitest'
import prisma from '../config/prisma'
import { issueTokens } from './auth'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

describe('issueTokens', () => {
  it('gera accessToken e refreshToken válidos com o payload do usuário', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'SSO Test User',
        email: `sso-test-${Date.now()}@example.com`,
        auth_provider: 'microsoft',
        role: 'user',
      },
    })

    try {
      const result = await issueTokens(user)

      expect(result.accessToken).toBeTruthy()
      expect(result.refreshToken).toBeTruthy()

      const payload = jwt.verify(result.accessToken, env.JWT_SECRET) as { sub: string; role: string }
      expect(payload.sub).toBe(user.id)
      expect(payload.role).toBe('user')

      const stored = await prisma.refreshToken.findFirst({ where: { user_id: user.id } })
      expect(stored).not.toBeNull()
    } finally {
      await prisma.refreshToken.deleteMany({ where: { user_id: user.id } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  })
})
