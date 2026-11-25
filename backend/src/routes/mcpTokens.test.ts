import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../app'
import prisma from '../config/prisma'
import { env } from '../config/env'

describe('/api/mcp-tokens', () => {
  let userId: string
  let authHeader: string
  let otherUserId: string
  let otherTokenId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { module_projects: true, name: 'MCP Token CRUD User', email: 'mcp-crud@test.local', role: 'agent', active: true },
    })
    userId = user.id
    const jwtToken = jwt.sign({ sub: userId, role: 'user', orgId: null }, env.JWT_SECRET, { algorithm: 'HS256' })
    authHeader = `Bearer ${jwtToken}`

    const otherUser = await prisma.user.create({
      data: { module_projects: true, name: 'MCP Other User', email: 'mcp-crud-other@test.local', role: 'agent', active: true },
    })
    otherUserId = otherUser.id
    const otherToken = await prisma.mcpToken.create({
      data: { user_id: otherUserId, name: 'Alheio', token_hash: 'x'.repeat(64), token_prefix: 'isamcp_xxxx' },
    })
    otherTokenId = otherToken.id
  })

  afterAll(async () => {
    await prisma.mcpToken.deleteMany({ where: { user_id: { in: [userId, otherUserId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } })
  })

  it('cria, lista e revoga um token do próprio usuário', async () => {
    const createRes = await request(app)
      .post('/api/mcp-tokens')
      .set('Authorization', authHeader)
      .send({ name: 'Claude Code' })
    expect(createRes.status).toBe(201)
    expect(createRes.body.data.token).toMatch(/^isamcp_/)
    const tokenId = createRes.body.data.id

    const listRes = await request(app).get('/api/mcp-tokens').set('Authorization', authHeader)
    expect(listRes.status).toBe(200)
    expect(listRes.body.data.some((t: any) => t.id === tokenId)).toBe(true)
    expect(listRes.body.data[0].token).toBeUndefined()

    const deleteRes = await request(app).delete(`/api/mcp-tokens/${tokenId}`).set('Authorization', authHeader)
    expect(deleteRes.status).toBe(204)
  })

  it('não permite revogar token de outro usuário', async () => {
    const res = await request(app)
      .delete(`/api/mcp-tokens/${otherTokenId}`)
      .set('Authorization', authHeader)
    expect(res.status).toBe(404)
  })
})
