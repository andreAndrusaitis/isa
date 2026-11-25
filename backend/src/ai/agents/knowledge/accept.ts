/**
 * Aceite da sugestão: a IA resolveu antes de o chamado existir. Registra o chamado já
 * resolvido, fora da fila, só para o histórico do solicitante e a medição do agente.
 */
import type { Request } from 'express'
import { z } from 'zod'
import prisma from '../../../config/prisma'
import { createTicketSchema, safeAttachmentUrl, ticketFields } from '../../../controllers/tickets'
import { AppError } from '../../../middlewares/errorHandler'
import { createAuditLog } from '../../../services/audit'
import { assertCategoryNotBlocked } from '../../../services/orgCategoryAccess'
import { TicketService } from '../../../services/tickets'
import { adminReadOnly } from '../../../utils/denials'
import { maskPII } from '../../core/masking'
import { AI_NAME } from '../../core/persona'
import { noNullByte } from '../../knowledge/schemas'
import type { SuggestionSource } from './agent'

/** Depois disso a resposta já não é a que o usuário tem na tela: abre chamado comum. */
export const ACCEPT_WINDOW_MS = 60 * 60 * 1000

export const AI_RESOLUTION = `Resolvido pela ${AI_NAME}`

/** Basta para o analista entender o que foi dito se o cliente reabrir. */
export const MAX_ANSWER_IN_RESOLUTION = 1500

export const MAX_EXTRA_ATTACHMENTS = 10

// O primeiro anexo segue em attachment_url, como em POST /api/tickets. Fica fora de
// createTicketSchema porque só aqui eles entram numa transação; lá são mensagens avulsas.
const acceptSchema = createTicketSchema.extend({
  extra_attachments: z.array(z.object({
    name: z.string().trim().min(1, 'Nome do anexo é obrigatório').max(255).refine(noNullByte, 'Nome do anexo inválido'),
    url: safeAttachmentUrl.refine(Boolean, 'Anexo vazio'),
  })).max(MAX_EXTRA_ATTACHMENTS, `Envie no máximo ${MAX_EXTRA_ATTACHMENTS + 1} anexos ao encerrar por aqui`).default([]),
})

const resolutionNote = (sources: SuggestionSource[]) =>
  `${AI_RESOLUTION} com a base de conhecimento. Fonte: ${sources.map(s => s.title).join('; ')}.`

// Mascara antes de cortar: o corte no meio de um e-mail ou CPF escaparia das regras.
function resolutionDetails(sources: SuggestionSource[], answer: string) {
  const masked = maskPII(answer).trim()
  const shown = masked.length > MAX_ANSWER_IN_RESOLUTION ? `${masked.slice(0, MAX_ANSWER_IN_RESOLUTION).trimEnd()}…` : masked
  return `${resolutionNote(sources)}\n\nResposta dada pela ${AI_NAME}:\n${shown}`
}

/**
 * updateMany condicional: entre requisições simultâneas, só uma vê count = 1. Só depois
 * de perder a corrida a linha é lida, para dizer o motivo; de outro usuário é 404, sem
 * revelar que existe.
 */
async function reserve(id: string, userId: string) {
  const { count } = await prisma.aiInteraction.updateMany({
    where: { id, user_id: userId, accepted: false, ticket_id: null, answer: { not: null }, created_at: { gte: new Date(Date.now() - ACCEPT_WINDOW_MS) } },
    data: { accepted: true },
  })
  const row = await prisma.aiInteraction.findFirst({
    where: { id, user_id: userId },
    select: { accepted: true, ticket_id: true, answer: true, sources: true },
  })
  if (!row) throw new AppError(404, 'Sugestão não encontrada', 'AI_INTERACTION_NOT_FOUND')
  if (count) return { sources: row.sources as unknown as SuggestionSource[], answer: row.answer! }
  if (row.accepted || row.ticket_id) throw new AppError(409, 'Esta sugestão já foi usada', 'AI_INTERACTION_USED')
  if (!row.answer) throw new AppError(409, 'Esta interação não tem resposta para aceitar', 'AI_INTERACTION_NO_ANSWER')
  throw new AppError(409, 'Esta sugestão venceu. Abra o chamado normalmente.', 'AI_INTERACTION_EXPIRED')
}

export async function acceptSuggestion(req: Request) {
  const id = String(req.params.interactionId)
  const user = req.user!
  const body = acceptSchema.parse(req.body)

  if (user.role === 'admin') throw adminReadOnly()
  // Quem confirma que o problema acabou é quem tem o problema; o cliente nem saberia do chamado.
  if (body.onBehalfOfUserId || body.proactiveOrgId || body.newRequester) {
    throw new AppError(400, 'A sugestão só pode ser aceita em chamado aberto em nome próprio', 'AI_ACCEPT_SELF_ONLY')
  }

  const orgId = user.orgId || null
  await assertCategoryNotBlocked(orgId, body.categoryId || body.category_id, body.subcategoryId || body.subcategory_id)

  const { sources, answer } = await reserve(id, user.sub)
  const ticket = await TicketService.createTicket({
    ...ticketFields(body, { id: user.sub, orgId }, user.role),
    aiResolution: {
      interactionId: id,
      details: resolutionDetails(sources, answer),
      note: resolutionNote(sources),
      extraAttachments: body.extra_attachments,
    },
  }, user.sub).catch(async err => {
    await prisma.aiInteraction.updateMany({ where: { id, ticket_id: null }, data: { accepted: false } }).catch(() => {})
    throw err
  })

  await createAuditLog({
    userId: user.sub, action: 'TICKET_RESOLVED_BY_AI', resource: 'TICKET',
    details: { ticketId: ticket!.id, interactionId: id, articleIds: sources.map(s => s.articleId) },
    ip: req.ip, userAgent: req.get('user-agent'),
  })
  return ticket
}
