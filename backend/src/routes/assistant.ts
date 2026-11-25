/**
 * Assistente de chamados no portal.
 * POST /api/assistant/chat   mensagem do solicitante → resposta do orquestrador
 *
 * Só o cliente final (role 'user'): o assistente age como solicitante (abre,
 * responde e reabre os próprios chamados). A equipe usa as telas de atendimento.
 * Limites de uso, auditoria e confirmação de escrita ficam no orquestrador
 * (ai/assistant): aqui só validamos tamanhos e devolvemos o chamado afetado,
 * para o portal mostrar o link.
 */
import { Router } from 'express'
import { z } from 'zod'
import prisma from '../config/prisma'
import { authenticate } from '../middlewares/auth'
import { AppError } from '../middlewares/errorHandler'
import { runAssistant } from '../ai/assistant/orchestrator'
import { assistantTools } from '../ai/assistant/tools'
import type { AssistantReply, AssistantTool } from '../ai/assistant/types'
import type { ToolChatFn } from '../ai/core/llm'
import { AI_NAME } from '../ai/core/persona'

/** O cliente guarda as últimas ~20 mensagens; o resto é descartado aqui. */
export const MAX_HISTORY = 20
const MAX_TEXT = 4000
const MAX_CONFIRM_INPUT = 12_000

const chatSchema = z.object({
  message: z.string().trim().max(MAX_TEXT).default(''),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(MAX_TEXT),
  })).max(MAX_HISTORY * 2).default([]),
  confirm: z.object({
    tool: z.string().trim().min(1).max(100),
    input: z.unknown(),
    summary: z.string().max(MAX_CONFIRM_INPUT),
  }).optional(),
  conversationId: z.string().trim().regex(/^[\w.:-]{1,100}$/).optional(),
}).refine(b => !!b.confirm || b.message.length > 0, { message: 'Escreva uma mensagem', path: ['message'] })
  .refine(b => !b.confirm || JSON.stringify(b.confirm.input ?? null).length <= MAX_CONFIRM_INPUT, {
    message: 'Ação grande demais', path: ['confirm', 'input'],
  })

export interface AssistantChatResponse extends AssistantReply {
  /** Chamado criado/alterado pela ação confirmada (link /c/<id> no portal). */
  ticket?: { id: string; numero: string }
}

/** Número do chamado no resultado de uma ferramenta de escrita (abrir, responder, reabrir). */
function ticketOf(result: unknown): { id?: string; numero: string } | null {
  const r = result as any
  const numero = r?.numero ?? r?.display_number
  if (typeof numero !== 'string' || !numero) return null
  return { numero, ...(typeof r.id === 'string' ? { id: r.id } : {}) }
}

/**
 * Router com dependências injetáveis: os testes passam um chatFn falso (nunca o
 * Foundry de verdade). Em produção, `default` usa o modelo configurado.
 */
export function createAssistantRouter(deps: { chatFn?: ToolChatFn; tools?: AssistantTool[] } = {}) {
  const router = Router()
  router.use(authenticate)

  router.post('/chat', async (req, res) => {
    const user = req.user!
    if (user.role !== 'user') {
      throw new AppError(403, `A ${AI_NAME} é para quem abre chamados no portal. A equipe usa as telas de atendimento.`, 'ASSISTANT_REQUESTER_ONLY')
    }
    const parsed = chatSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos', 'VALIDATION_ERROR')
    }
    const body = parsed.data

    // Captura o resultado da escrita confirmada: o portal mostra o link do chamado.
    let written: unknown = null
    const tools = (deps.tools ?? assistantTools).map(t => (t.write
      ? { ...t, handler: async (input: any, ctx: any) => { const r = await t.handler(input, ctx); written = r; return r } }
      : t))

    const reply = await runAssistant({
      userId: user.sub,
      via: 'portal',
      history: body.history.slice(-MAX_HISTORY),
      message: body.message,
      tools,
      confirm: body.confirm ? { tool: body.confirm.tool, input: body.confirm.input, summary: body.confirm.summary } : undefined,
      // Teto de tokens por conversa, sempre dentro do próprio usuário.
      conversationId: `${user.sub}:portal${body.conversationId ? `:${body.conversationId}` : ''}`,
      ...(deps.chatFn ? { chatFn: deps.chatFn } : {}),
    })

    const out: AssistantChatResponse = { ...reply }
    const ticket = ticketOf(written)
    if (ticket) {
      const id = ticket.id ?? (await prisma.ticket.findFirst({
        where: { display_number: ticket.numero, user_id: user.sub, deleted_at: null },
        select: { id: true },
      }))?.id
      if (id) out.ticket = { id, numero: ticket.numero }
    }
    res.json({ data: out })
  })

  return router
}

export default createAssistantRouter()
