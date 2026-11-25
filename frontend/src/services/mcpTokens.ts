import api from './api'

export interface McpToken {
  id: string
  name: string
  tokenPrefix: string
  active: boolean
  createdAt: string
  lastUsedAt: string | null
}

export interface McpTokenCreated extends McpToken {
  token: string
}

export async function listMcpTokens(): Promise<McpToken[]> {
  const { data } = await api.get('/mcp-tokens')
  return data.data
}

export async function createMcpToken(name: string): Promise<McpTokenCreated> {
  const { data } = await api.post('/mcp-tokens', { name })
  return data.data
}

export async function revokeMcpToken(tokenId: string): Promise<void> {
  await api.delete(`/mcp-tokens/${tokenId}`)
}
