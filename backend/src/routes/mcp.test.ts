import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../app'
import prisma from '../config/prisma'
import { createMcpToken } from '../services/mcpTokens'

describe('POST /mcp', () => {
  let userId: string
  let token: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'MCP Route User', email: `mcp-route-${Date.now()}@test.local`, role: 'agent', active: true, module_projects: true },
    })
    userId = user.id
    const created = await createMcpToken(userId, { name: 'Test Client' })
    token = created.token
  })

  afterAll(async () => {
    await prisma.mcpToken.deleteMany({ where: { user_id: userId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('rejeita sem token', async () => {
    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.status).toBe(401)
  })

  it('rejeita token inválido ou revogado', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer isamcp_tokeninvalidoquenuncaexistiu')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('MCP_TOKEN_INVALID')
  })

  it('lista as tools disponíveis com token válido', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })

    expect(res.status).toBe(200)
    // Streamable HTTP responde em SSE: o JSON-RPC vem na linha "data: ..."
    const data = res.text.split('\n').find((l) => l.startsWith('data: '))!
    const body = JSON.parse(data.slice(6))
    expect(body.result.tools.map((t: any) => t.name)).toContain('list_projects')
  })

  it('recusa token de quem não tem o módulo de projetos', async () => {
    await prisma.user.update({ where: { id: userId }, data: { module_projects: false } })
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    await prisma.user.update({ where: { id: userId }, data: { module_projects: true } })
    expect(res.status).toBe(403)
  })
})
