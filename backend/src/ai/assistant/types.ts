/**
 * Contrato do assistente de chamados (Teams, portal e MCP/Copilot usam o mesmo).
 *
 * - Ferramentas (tools.ts) vivem num registro único: descrição para o modelo,
 *   schema zod da entrada e o handler, sempre no escopo do usuário (nunca
 *   devolvem nota interna — passam por redactForRequester).
 * - Ferramenta de escrita (write: true) nunca roda direto pelo modelo: o
 *   orquestrador devolve uma ação pendente para o canal pedir confirmação, e
 *   só executa com ctx.confirmed = true.
 */
import type { z } from 'zod'

export type AssistantChannel = 'teams' | 'portal' | 'copilot' | 'mcp'

export interface ToolContext {
  userId: string
  via: AssistantChannel
  /** true só quando a pessoa confirmou a ação pendente no canal. */
  confirmed?: boolean
}

export interface AssistantTool<I = any> {
  name: string
  /** Texto para o modelo decidir quando usar (pt-BR, curto e objetivo). */
  description: string
  schema: z.ZodType<I>
  /** Escreve algo (abre chamado, responde analista…): exige confirmação. */
  write: boolean
  /** Resumo legível da ação, mostrado ao pedir confirmação de uma escrita. */
  describe?: (input: I) => string
  handler: (input: I, ctx: ToolContext) => Promise<unknown>
}

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Escrita proposta pelo modelo, aguardando a pessoa confirmar no canal. */
export interface PendingAction {
  tool: string
  input: unknown
  summary: string
}

export interface AssistantReply {
  /** Texto para mostrar à pessoa. */
  text: string
  /** Presente quando o modelo quer escrever algo: o canal pede confirmação. */
  pending?: PendingAction
  /** Links do Microsoft Learn usados na resposta (citados no canal). */
  sources?: Array<{ title: string; url: string }>
}
