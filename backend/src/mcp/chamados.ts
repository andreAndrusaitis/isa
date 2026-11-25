import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { assistantTools } from '../ai/assistant/tools'
import type { AssistantChannel, AssistantTool } from '../ai/assistant/types'
import { AppError } from '../middlewares/errorHandler'

const CONFIRM_HINT = ' Ação de escrita: chame primeiro sem `confirmado`, mostre o resumo devolvido à pessoa e só chame de novo com `confirmado: true` depois que ela aceitar.'

const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
})

function shapeOf(tool: AssistantTool): z.ZodRawShape {
  const shape = tool.schema instanceof z.ZodObject ? tool.schema.shape : {}
  if (!tool.write) return shape
  return { ...shape, confirmado: z.boolean().optional().describe('true só depois que a pessoa confirmou o resumo da ação') }
}

/**
 * MCP de chamados (Copilot / agente do M365): as mesmas tools do assistente,
 * no escopo do solicitante. Escrita pede `confirmado: true` — quem confirma
 * com a pessoa é o cliente MCP. Uma instância por requisição (stateless).
 */
export function buildChamadosMcpServer(userId: string, via: AssistantChannel = 'mcp'): McpServer {
  const server = new McpServer({ name: 'isa-chamados', version: '1.0.0' })

  for (const tool of assistantTools) {
    server.registerTool(
      tool.name,
      { description: tool.write ? tool.description + CONFIRM_HINT : tool.description, inputSchema: shapeOf(tool) as any },
      async (raw: any) => {
        const { confirmado, ...input } = raw ?? {}
        try {
          if (tool.write && confirmado !== true) {
            const summary = tool.describe ? tool.describe(input) : tool.name
            return text({
              confirmacaoNecessaria: true,
              resumo: summary,
              instrucao: 'Mostre este resumo à pessoa e pergunte se pode seguir. Se ela confirmar, chame a ferramenta de novo com os mesmos dados e confirmado: true.',
            })
          }
          const result = await tool.handler(input, { userId, via, confirmed: tool.write ? true : undefined })
          return text(result)
        } catch (err) {
          if (err instanceof AppError || err instanceof z.ZodError) return text(err.message, true)
          throw err
        }
      },
    )
  }

  return server
}
