import { describe, it, expect, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { loginService, issueTokens, refreshService } from './auth'

describe('loginService — contas microsoft', () => {
  it('rejeita login local para usuário auth_provider=microsoft', async () => {
    const email = `sso-block-${Date.now()}@example.com`
    let userId: string | undefined
    try {
      const user = await prisma.user.create({
        data: { name: 'SSO Only', email, auth_provider: 'microsoft', role: 'user', active: true },
      })
      userId = user.id

      await expect(loginService(email, 'qualquer-senha')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    } finally {
      if (userId) await prisma.user.delete({ where: { id: userId } })
    }
  })
})

describe('loginService — e-mail desconhecido', () => {
  it('paga o mesmo bcrypt de uma conta local e responde o erro genérico', async () => {
    const compare = vi.spyOn(bcrypt, 'compare')
    try {
      await expect(loginService(`ninguem-${Date.now()}@example.com`, 'qualquer-senha')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
      expect(compare).toHaveBeenCalledOnce()
      expect(compare.mock.calls[0][0]).toBe('qualquer-senha')
      expect(compare.mock.calls[0][1]).toMatch(/^\$2[aby]\$10\$/)
    } finally {
      compare.mockRestore()
    }
  })
})

describe('refreshService — token rotacionado que reaparece', () => {
  const hash = (token: string) => createHash('sha256').update(token).digest('hex')
  const passGraceWindow = (token: string) =>
    prisma.refreshToken.update({ where: { token: hash(token) }, data: { expires_at: new Date(Date.now() - 1000) } })

  async function withUser(run: (user: { id: string; role: string; org_id: string | null }) => Promise<void>) {
    const user = await prisma.user.create({
      data: { name: 'Reuso', email: `reuso-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, role: 'agent', active: true },
    })
    try {
      await run(user)
    } finally {
      await prisma.auditLog.deleteMany({ where: { user_id: user.id } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  }

  it('passada a tolerância derruba a cadeia inteira e registra o reuso', async () => {
    await withUser(async (user) => {
      const { refreshToken: stolen } = await issueTokens(user)
      const { refreshToken: current } = await refreshService(stolen)
      await passGraceWindow(stolen)

      await expect(refreshService(stolen)).rejects.toMatchObject({ statusCode: 401 })

      expect(await prisma.refreshToken.count({ where: { user_id: user.id } })).toBe(0)
      await expect(refreshService(current)).rejects.toMatchObject({ statusCode: 401 })
      expect(await prisma.auditLog.count({ where: { user_id: user.id, action: 'REFRESH_TOKEN_REUSE' } })).toBeGreaterThan(0)
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(after.session_invalidated_at).not.toBeNull()
    })
  })

  it('token que venceu de verdade não derruba as outras sessões', async () => {
    await withUser(async (user) => {
      const { refreshToken: otherDevice } = await issueTokens(user)
      const expired = jwt.sign({ sub: user.id }, env.JWT_REFRESH_SECRET, { expiresIn: -10 })
      await prisma.refreshToken.create({
        data: { token: hash(expired), user_id: user.id, expires_at: new Date(Date.now() - 10_000) },
      })

      await expect(refreshService(expired)).rejects.toMatchObject({ statusCode: 401 })

      await expect(refreshService(otherDevice)).resolves.toBeTruthy()
      expect(await prisma.auditLog.count({ where: { user_id: user.id, action: 'REFRESH_TOKEN_REUSE' } })).toBe(0)
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(after.session_invalidated_at).toBeNull()
    })
  })
})

describe('refreshService — sessão longa (SSO / Lembrar de mim) e várias abas', () => {
  const DAY = 86_400_000

  it('rotação mantém 30 dias e reuso simultâneo (outra aba) não derruba a sessão', async () => {
    const email = `refresh-30d-${Date.now()}@example.com`
    let userId: string | undefined
    try {
      const user = await prisma.user.create({
        data: { name: 'Analista SSO', email, auth_provider: 'microsoft', role: 'agent', active: true },
      })
      userId = user.id
      const { refreshToken } = await issueTokens(user, true)

      // Aba A rotaciona; aba B chega logo depois com o MESMO cookie antigo.
      const a = await refreshService(refreshToken)
      const b = await refreshService(refreshToken)

      expect(a.rememberMe).toBe(true)
      expect(b.rememberMe).toBe(true)
      const rows = await prisma.refreshToken.findMany({ where: { user_id: user.id }, orderBy: { expires_at: 'desc' } })
      expect(rows.length).toBe(3) // antigo (em tolerância) + um novo por aba: nada revogado
      expect(rows[0].expires_at.getTime() - Date.now()).toBeGreaterThan(29 * DAY)

      // Os tokens novos seguem válidos.
      await expect(refreshService(a.refreshToken)).resolves.toBeTruthy()
    } finally {
      if (userId) await prisma.user.delete({ where: { id: userId } })
    }
  })
})
