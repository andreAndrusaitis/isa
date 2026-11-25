import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import app from '../app'
import prisma from '../config/prisma'
import { createMcpToken, resolveUserIdFromToken } from '../services/mcpTokens'

const SUFFIX = `pwd-${Date.now()}`
let userId: string
let accessToken: string
const INITIAL_PASSWORD = 'senha-inicial-123'

beforeAll(async () => {
  const hashed = await bcrypt.hash(INITIAL_PASSWORD, 10)
  const user = await prisma.user.create({
    data: { name: `User ${SUFFIX}`, email: `u-${SUFFIX}@t.com`, password: hashed, role: 'user' },
  })
  userId = user.id

  const loginRes = await request(app).post('/api/auth/login').send({ email: user.email, password: INITIAL_PASSWORD })
  accessToken = loginRes.body.data.accessToken
})

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { user_id: userId } })
  await prisma.auditLog.deleteMany({ where: { user_id: userId } })
  await prisma.user.delete({ where: { id: userId } })
})

describe('PATCH /api/users/me/password', () => {
  it('senha errada não mexe nos tokens MCP', async () => {
    const mcp = await createMcpToken(userId, { name: 'Antes da troca' })
    await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'senha-errada', newPassword: 'nova-senha-456' })

    expect(await resolveUserIdFromToken(mcp.token)).toBe(userId)
    await prisma.mcpToken.delete({ where: { id: mcp.id } })
  })

  it('troca da senha desliga os tokens MCP da pessoa', async () => {
    const password = 'senha-mcp-789'
    const hashed = await bcrypt.hash(password, 4)
    const user = await prisma.user.create({ data: { name: `Mcp ${SUFFIX}`, email: `mcp-${SUFFIX}@t.com`, password: hashed, role: 'user' } })
    try {
      const login = await request(app).post('/api/auth/login').send({ email: user.email, password })
      const mcp = await createMcpToken(user.id, { name: 'Sobrevive?' })

      const res = await request(app)
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .send({ currentPassword: password, newPassword: 'nova-senha-456' })

      expect(res.status).toBe(200)
      expect(await resolveUserIdFromToken(mcp.token)).toBeNull()
    } finally {
      await prisma.refreshToken.deleteMany({ where: { user_id: user.id } })
      await prisma.auditLog.deleteMany({ where: { user_id: user.id } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  it('rejeita senha atual incorreta', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'senha-errada', newPassword: 'nova-senha-456' })

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD')
  })

  it('rejeita nova senha curta', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: INITIAL_PASSWORD, newPassword: '123' })

    expect(res.status).toBe(400)
  })

  it('troca a senha com sucesso quando a senha atual está correta', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: INITIAL_PASSWORD, newPassword: 'nova-senha-456' })

    expect(res.status).toBe(200)

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const matches = await bcrypt.compare('nova-senha-456', updated.password!)
    expect(matches).toBe(true)
  })
})
