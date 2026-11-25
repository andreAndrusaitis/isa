import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mcpTools } from './tools'

/**
 * Uma instância nova por requisição (stateless): o SDK exige um McpServer
 * "limpo" por conexão no transporte Streamable HTTP sem sessão.
 */
export function buildMcpServer(userId: string): McpServer {
  const server = new McpServer({ name: 'isa-projetos', version: '1.0.0' })

  for (const [name, tool] of Object.entries(mcpTools)) {
    server.registerTool(
      name,
      // `.shape` tipado como `any` — o SDK infere um shape concreto por
      // chamada, mas o union de todos os tools no loop quebra essa inferência.
      { description: tool.description, inputSchema: tool.inputSchema.shape as any },
      async (input: any) => {
        const result = await tool.handler(input, userId)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      },
    )
  }

  return server
}
