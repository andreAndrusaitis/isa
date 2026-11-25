import { useCallback, useEffect, useState } from 'react'
import * as McpTokensService from '../services/mcpTokens'
import type { McpToken, McpTokenCreated } from '../services/mcpTokens'

export function useMcpTokens() {
  const [tokens, setTokens] = useState<McpToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTokens(await McpTokensService.listMcpTokens())
    } catch {
      setError('Não foi possível carregar os tokens.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(async (name: string): Promise<McpTokenCreated> => {
    const created = await McpTokensService.createMcpToken(name)
    await reload()
    return created
  }, [reload])

  const revoke = useCallback(async (tokenId: string) => {
    await McpTokensService.revokeMcpToken(tokenId)
    await reload()
  }, [reload])

  return { tokens, loading, error, create, revoke, reload }
}
