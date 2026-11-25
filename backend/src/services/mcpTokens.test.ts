import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import prisma from '../config/prisma'
import * as McpTokens from './mcpTokens'

describe('mcpTokens service', () => {
  // mcp_tokens.user_id tem FK para users: o usuário precisa existir.
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: 'test-user-mcp' },
      create: { id: 'test-user-mcp', name: 'Teste MCP', email: `mcp-${Date.now()}@test.com`, role: 'agent' },
      update: {},
    })
  })

  afterAll(async () => {
    await prisma.user.delete({ where: { id: 'test-user-mcp' } }) // tokens caem em cascata
  })

  beforeEach(async () => {
    await prisma.mcpToken.deleteMany({ where: { user_id: 'test-user-mcp' } })
  })

  it('createMcpToken gera token, salva hash e devolve o valor em texto puro uma única vez', async () => {
    const result = await McpTokens.createMcpToken('test-user-mcp', { name: 'Claude Desktop' })

    expect(result.token).toMatch(/^isamcp_[a-f0-9]{64}$/)
    expect(result.name).toBe('Claude Desktop')
    expect((result as any).token_hash).toBeUndefined()

    const stored = await prisma.mcpToken.findUnique({ where: { id: result.id } })
    expect(stored?.token_hash).toBe(McpTokens.hashMcpToken(result.token))
  })

  it('listMcpTokens não expõe o hash do token', async () => {
    await McpTokens.createMcpToken('test-user-mcp', { name: 'Cursor' })
    const list = await McpTokens.listMcpTokens('test-user-mcp')

    expect(list).toHaveLength(1)
    expect((list[0] as any).token_hash).toBeUndefined()
    expect(list[0].token_prefix).toMatch(/^isamcp_/)
  })

  it('deactivateMcpTokens desliga todos os tokens da pessoa e só dela', async () => {
    const other = await prisma.user.create({ data: { name: 'Outro MCP', email: `mcp-outro-${Date.now()}@test.com`, role: 'agent' } })
    try {
      const a = await McpTokens.createMcpToken('test-user-mcp', { name: 'A' })
      const b = await McpTokens.createMcpToken('test-user-mcp', { name: 'B' })
      const kept = await McpTokens.createMcpToken(other.id, { name: 'C' })

      await McpTokens.deactivateMcpTokens('test-user-mcp')

      expect(await McpTokens.resolveUserIdFromToken(a.token)).toBeNull()
      expect(await McpTokens.resolveUserIdFromToken(b.token)).toBeNull()
      expect(await McpTokens.resolveUserIdFromToken(kept.token)).toBe(other.id)
    } finally {
      await prisma.user.delete({ where: { id: other.id } })
    }
  })

  it('revokeMcpToken marca active=false e o token para de resolver usuário', async () => {
    const created = await McpTokens.createMcpToken('test-user-mcp', { name: 'Temp' })
    await McpTokens.revokeMcpToken('test-user-mcp', created.id)

    const resolved = await McpTokens.resolveUserIdFromToken(created.token)
    expect(resolved).toBeNull()
  })

  it('resolveUserIdFromToken devolve o user_id do token ativo válido', async () => {
    const created = await McpTokens.createMcpToken('test-user-mcp', { name: 'Ok' })
    const resolved = await McpTokens.resolveUserIdFromToken(created.token)
    expect(resolved).toBe('test-user-mcp')
  })

  it('revokeMcpToken não revoga token de outro usuário', async () => {
    const created = await McpTokens.createMcpToken('test-user-mcp', { name: 'X' })
    await expect(McpTokens.revokeMcpToken('outro-usuario', created.id)).rejects.toThrow()

    const resolved = await McpTokens.resolveUserIdFromToken(created.token)
    expect(resolved).toBe('test-user-mcp')
  })
})
