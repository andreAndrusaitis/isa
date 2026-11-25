/**
 * Registro único das ferramentas do assistente de chamados (Teams, portal e
 * MCP/Copilot). Tudo no escopo do solicitante: só os chamados que a pessoa
 * abriu (user_id), sem nota interna nem histórico interno.
 */
import { z } from 'zod'
import prisma from '../../config/prisma'
import { AppError } from '../../middlewares/errorHandler'
import { TicketService, redactForRequester } from '../../services/tickets'
import { assertCategoryNotBlocked } from '../../services/orgCategoryAccess'
import { searchLearn } from '../core/learn'
import { AI_NAME, signedByAi } from '../core/persona'
import { SYSTEM_USER_ID } from '../../utils/constants'
import type { AssistantChannel, AssistantTool, ToolContext } from './types'

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto',
  in_progress: 'Em atendimento',
  pending: 'Pendente',
  resolved: 'Resolvido',
  closed: 'Fechado',
}

const VIA_LABEL: Record<AssistantChannel, string> = {
  teams: 'Teams',
  portal: 'portal',
  copilot: 'Copilot',
  mcp: 'MCP',
}

const ACTIVE = ['open', 'in_progress', 'pending']

function assertConfirmed(ctx: ToolContext) {
  if (!ctx.confirmed) {
    throw new AppError(409, 'Esta ação precisa ser confirmada pela pessoa antes de executar.', 'CONFIRMATION_REQUIRED')
  }
}

/** Chamado do próprio solicitante por id ou número (INC-123). De outra pessoa = não encontrado. */
async function ownTicket(ref: string, userId: string) {
  const key = ref.trim()
  const ticket = await prisma.ticket.findFirst({
    where: { deleted_at: null, OR: [{ id: key }, { display_number: { equals: key, mode: 'insensitive' } }] },
    select: { id: true, user_id: true, display_number: true, status: true },
  })
  if (!ticket || ticket.user_id !== userId) {
    throw new AppError(404, 'Chamado não encontrado entre os seus chamados.', 'NOT_FOUND')
  }
  return ticket
}

async function activeUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, org_id: true, active: true, deleted_at: true } })
  if (!user || !user.active || user.deleted_at) throw new AppError(401, 'Usuário inativo', 'UNAUTHORIZED')
  // Admin é somente leitura em chamados.
  if (user.role === 'admin') throw new AppError(403, 'Administradores não abrem nem respondem chamados.', 'ADMIN_READ_ONLY')
  return user
}

const ticketRef = z.string().trim().min(1).max(100).describe('Número do chamado (ex.: INC-123) ou id')

const buscarLearnSchema = z.object({
  consulta: z.string().trim().min(3).max(300).describe('O que procurar na documentação da Microsoft, em poucas palavras'),
})

/** Mensagem assinada pelo usuário de sistema é da Skadi, não de "Sistema". */
export const autorDaMensagem = (m: { user_id?: string | null; text?: string | null; user?: { name?: string | null } | null }) =>
  m.user_id === SYSTEM_USER_ID && signedByAi(m.text ?? '') ? AI_NAME : m.user?.name ?? null

export const buscarLearn: AssistantTool<z.infer<typeof buscarLearnSchema>> = {
  name: 'buscar_learn',
  description: 'Procura a solução na documentação oficial da Microsoft (Microsoft Learn) para dúvidas de Windows, Office/M365, Teams, Outlook etc. Use antes de sugerir abrir chamado.',
  schema: buscarLearnSchema,
  write: false,
  handler: async input => {
    const docs = await searchLearn(input.consulta, { includeAnswers: true })
    return {
      itens: docs.map(d => ({ title: d.title, url: d.url, trecho: d.content })),
      sources: docs.map(d => ({ title: d.title, url: d.url })),
    }
  },
}

const meusChamadosSchema = z.object({
  limite: z.number().int().min(1).max(20).default(5).describe('Quantos chamados trazer (padrão 5)'),
  somenteAbertos: z.boolean().default(false).describe('true = só os que ainda estão em andamento'),
})

export const meusChamados: AssistantTool<z.input<typeof meusChamadosSchema>> = {
  name: 'meus_chamados',
  description: 'Lista os chamados mais recentes que a própria pessoa abriu, com número, título e situação.',
  schema: meusChamadosSchema,
  write: false,
  handler: async (input, ctx) => {
    const { limite, somenteAbertos } = meusChamadosSchema.parse(input)
    const { data } = await TicketService.getTickets({
      user_id: ctx.userId,
      limit: limite,
      ...(somenteAbertos ? { status: { in: ACTIVE } } : {}),
    })
    return data.map((t: any) => ({
      numero: t.display_number,
      titulo: t.title,
      status: STATUS_LABEL[t.status] ?? t.status,
      abertoEm: t.created_at,
      atualizadoEm: t.updated_at,
      responsavel: t.assigned_to?.name ?? null,
    }))
  },
}

const verChamadoSchema = z.object({ chamado: ticketRef })

export const verChamado: AssistantTool<z.infer<typeof verChamadoSchema>> = {
  name: 'ver_chamado',
  description: 'Mostra um chamado da própria pessoa: situação, responsável e a conversa pública com o atendimento.',
  schema: verChamadoSchema,
  write: false,
  handler: async (input, ctx) => {
    const own = await ownTicket(input.chamado, ctx.userId)
    const ticket = await TicketService.getTicketById(own.id)
    if (!ticket) throw new AppError(404, 'Chamado não encontrado entre os seus chamados.', 'NOT_FOUND')
    const safe = redactForRequester(ticket)
    return {
      numero: safe.display_number,
      titulo: safe.title,
      descricao: safe.description,
      status: STATUS_LABEL[safe.status] ?? safe.status,
      categoria: safe.category?.name ?? null,
      responsavel: safe.assigned_to?.name ?? null,
      abertoEm: safe.created_at,
      podeReabrir: safe.canReopen,
      mensagens: (safe.messages ?? []).map((m: any) => ({
        autor: autorDaMensagem(m),
        doAtendimento: m.user_id !== safe.user_id,
        texto: m.text,
        em: m.created_at,
      })),
    }
  },
}

const abrirChamadoSchema = z.object({
  titulo: z.string().trim().min(3).max(200).describe('Resumo curto do problema'),
  descricao: z.string().trim().min(3).max(5000).describe('O que acontece, desde quando, o que já foi tentado'),
  categoryId: z.string().trim().min(1).max(100).optional(),
  subcategoryId: z.string().trim().min(1).max(100).optional(),
})

export const abrirChamado: AssistantTool<z.infer<typeof abrirChamadoSchema>> = {
  name: 'abrir_chamado',
  description: 'Abre um chamado em nome da própria pessoa (já identificada pelo login: não pergunte e-mail, usuário nem empresa). Chame assim que souber qual é o problema, com título curto e descrição do que ela contou; o sistema mostra o resumo e pede a confirmação antes de criar.',
  schema: abrirChamadoSchema,
  write: true,
  describe: input => `Abrir chamado "${input.titulo}"\n\n${input.descricao}`,
  handler: async (input, ctx) => {
    assertConfirmed(ctx)
    const user = await activeUser(ctx.userId)
    await assertCategoryNotBlocked(user.org_id, input.categoryId ?? null, input.subcategoryId ?? null)
    const ticket = await TicketService.createTicket({
      title: input.titulo,
      description: input.descricao,
      priority: 'medium',
      category_id: input.categoryId ?? null,
      subcategory_id: input.subcategoryId ?? null,
      user_id: user.id,
      org_id: user.org_id,
      auditNote: `Chamado aberto pela ${AI_NAME} (${VIA_LABEL[ctx.via]})`,
      // Canal de origem para as métricas por canal (MCP é o Copilot).
      channel: ctx.via === 'mcp' ? 'copilot' : ctx.via,
    }, user.id)
    return { numero: ticket.display_number, id: ticket.id, status: STATUS_LABEL[ticket.status] ?? ticket.status }
  },
}

const responderSchema = z.object({
  chamado: ticketRef,
  mensagem: z.string().trim().min(1).max(5000).describe('Texto que vai para o analista'),
})

export const responderAnalista: AssistantTool<z.infer<typeof responderSchema>> = {
  name: 'responder_analista',
  description: 'Envia uma mensagem pública ao atendimento num chamado da própria pessoa (responder pergunta, mandar informação).',
  schema: responderSchema,
  write: true,
  describe: input => `Responder no chamado ${input.chamado}:\n\n${input.mensagem}`,
  handler: async (input, ctx) => {
    assertConfirmed(ctx)
    await activeUser(ctx.userId)
    const own = await ownTicket(input.chamado, ctx.userId)
    const message = await TicketService.addMessage(own.id, ctx.userId, input.mensagem, 'user')
    return { numero: own.display_number, mensagemId: message.id, enviada: true }
  },
}

const reabrirSchema = z.object({
  chamado: ticketRef,
  motivo: z.string().trim().min(10).max(2000).describe('Por que o problema continua (mínimo 10 caracteres)'),
})

export const reabrirChamado: AssistantTool<z.infer<typeof reabrirSchema>> = {
  name: 'reabrir_chamado',
  description: 'Reabre um chamado resolvido da própria pessoa, dentro do prazo de reabertura, quando o problema voltou.',
  schema: reabrirSchema,
  write: true,
  describe: input => `Reabrir o chamado ${input.chamado}\n\nMotivo: ${input.motivo}`,
  handler: async (input, ctx) => {
    assertConfirmed(ctx)
    await activeUser(ctx.userId)
    const own = await ownTicket(input.chamado, ctx.userId)
    const ticket = await TicketService.reopenTicket(own.id, ctx.userId, input.motivo)
    return { numero: own.display_number, status: STATUS_LABEL[ticket?.status ?? 'open'] }
  },
}

export const assistantTools: AssistantTool[] = [buscarLearn, meusChamados, verChamado, abrirChamado, responderAnalista, reabrirChamado]

export function getAssistantTool(name: string): AssistantTool | undefined {
  return assistantTools.find(t => t.name === name)
}
