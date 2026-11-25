import { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { forbidden } from '../utils/denials'
import { getTicketAccess, TICKET_ACCESS_SELECT } from '../services/ticketAccess'
import { SurveyService } from '../services/survey'
import { getEffectiveScope } from '../services/scope'
import { z } from 'zod'

/** Só quem enxerga o chamado (mesma regra do REST de chamados) mexe na pesquisa dele. */
async function assertTicketVisible(ticketId: string, user: { sub: string; role: string }) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: TICKET_ACCESS_SELECT })
  if (!ticket) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
  const access = await getTicketAccess(ticket, user)
  if (!access.allowed) throw forbidden(access.code, access.message)
}

// Id que não existe: filtro de empresa vazio significa "todas" no serviço.
const NO_ORG = 'none'

/** Filtro de empresa dentro da carteira: sem filtro vira a carteira inteira, empresa de fora sai. */
async function orgFilterInScope(orgId: unknown, user: { sub: string; role: string }) {
  const scope = await getEffectiveScope(user.sub, user.role)
  if (scope.scopeAll) return orgId as string
  const asked = typeof orgId === 'string' && orgId !== 'all' ? orgId.split(',').filter(Boolean) : []
  const allowed = asked.length ? asked.filter(id => scope.orgIds.includes(id)) : scope.orgIds
  return allowed.join(',') || NO_ORG
}

export class SurveyController {
  // --- Templates Management (Admin only) ---

  static async listTemplates(_req: Request, res: Response, next: NextFunction) {
    try {
      const templates = await SurveyService.getTemplates()
      return res.json({ data: templates })
    } catch (err) {
      return next(err)
    }
  }

  static async getTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const template = await SurveyService.getTemplate(id)
      return res.json({ data: template })
    } catch (err) {
      return next(err)
    }
  }

  static async getActiveTemplate(_req: Request, res: Response, next: NextFunction) {
    try {
      const template = await SurveyService.getActiveTemplate()
      return res.json({ data: template })
    } catch (err) {
      return next(err)
    }
  }

  static async createTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user
      const schema = z.object({
        nome: z.string().min(1, 'Nome do template é obrigatório'),
        assunto_email: z.string().min(1, 'Assunto do e-mail é obrigatório'),
        corpo_convite_auto: z.string().min(1, 'Corpo de convite automático é obrigatório'),
        corpo_convite_macro: z.string().min(1, 'Corpo de convite para macro é obrigatório'),
        ativo: z.boolean().optional().default(false)
      })

      const data = schema.parse(req.body)
      const template = await SurveyService.createTemplate(data, user.sub)
      return res.status(201).json({ data: template })
    } catch (err) {
      return next(err)
    }
  }

  static async updateTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const user = (req as any).user
      const schema = z.object({
        nome: z.string().min(1).optional(),
        assunto_email: z.string().min(1).optional(),
        corpo_convite_auto: z.string().min(1).optional(),
        corpo_convite_macro: z.string().min(1).optional(),
        ativo: z.boolean().optional()
      })

      const data = schema.parse(req.body)
      const template = await SurveyService.updateTemplate(id, data, user.sub)
      return res.json({ data: template })
    } catch (err) {
      return next(err)
    }
  }

  static async deleteTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const user = (req as any).user
      await SurveyService.deleteTemplate(id, user?.sub)
      return res.json({ message: 'Template excluído com sucesso' })
    } catch (err) {
      return next(err)
    }
  }

  static async setActiveTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string
      const template = await SurveyService.setActiveTemplate(id)
      return res.json({ data: template })
    } catch (err) {
      return next(err)
    }
  }

  // --- Question / Option Management (Admin only) ---

  static async addQuestion(req: Request, res: Response, next: NextFunction) {
    try {
      const templateId = req.params.id as string
      const optSchema = z.object({
        rotulo: z.string().min(1), valor: z.string().min(1),
        emoji: z.string().nullable().optional().transform(v => v ?? undefined),
        cor: z.string().nullable().optional().transform(v => v ?? undefined),
        pontuacao: z.number().int().nullable().optional().transform(v => v ?? undefined),
        acao: z.enum(['reabrir_chamado']).nullable().optional().transform(v => v ?? undefined)
      })
      const schema = z.object({
        enunciado: z.string().min(1),
        descricao: z.string().nullable().optional().transform(v => v ?? undefined),
        tipo: z.enum(['escala', 'escolha_unica', 'escolha_multipla', 'texto_livre', 'nps']),
        estilo: z.enum(['emoji', 'estrela', 'numerico', 'pill']).nullable().optional().transform(v => v ?? undefined),
        obrigatoria: z.boolean().optional(),
        ativa: z.boolean().optional(),
        opcoes: z.array(optSchema).optional()
      })
      const data = schema.parse(req.body)
      const q = await SurveyService.addQuestion(templateId, data)
      return res.status(201).json({ data: q })
    } catch (err) { return next(err) }
  }

  static async updateQuestion(req: Request, res: Response, next: NextFunction) {
    try {
      const questionId = req.params.questionId as string
      const optSchema = z.object({
        rotulo: z.string().min(1), valor: z.string().min(1),
        emoji: z.string().nullable().optional().transform(v => v ?? undefined),
        cor: z.string().nullable().optional().transform(v => v ?? undefined),
        pontuacao: z.number().int().nullable().optional().transform(v => v ?? undefined),
        acao: z.enum(['reabrir_chamado']).nullable().optional().transform(v => v ?? undefined)
      })
      const schema = z.object({
        enunciado: z.string().min(1).optional(),
        descricao: z.string().nullable().optional(),
        tipo: z.enum(['escala', 'escolha_unica', 'escolha_multipla', 'texto_livre', 'nps']).optional(),
        estilo: z.enum(['emoji', 'estrela', 'numerico', 'pill']).nullable().optional(),
        obrigatoria: z.boolean().optional(),
        ativa: z.boolean().optional(),
        opcoes: z.array(optSchema).optional()
      })
      const data = schema.parse(req.body)
      const q = await SurveyService.updateQuestion(questionId, data)
      return res.json({ data: q })
    } catch (err) { return next(err) }
  }

  static async deleteQuestion(req: Request, res: Response, next: NextFunction) {
    try {
      const questionId = req.params.questionId as string
      const result = await SurveyService.deleteQuestion(questionId)
      return res.json({
        message: result.arquivada
          ? 'Pergunta removida da pesquisa. O histórico de respostas foi mantido no dashboard.'
          : 'Pergunta excluída com sucesso',
        ...result
      })
    } catch (err) { return next(err) }
  }

  static async reorderQuestions(req: Request, res: Response, next: NextFunction) {
    try {
      const templateId = req.params.id as string
      const schema = z.object({ orderedIds: z.array(z.string()) })
      const { orderedIds } = schema.parse(req.body)
      const tpl = await SurveyService.reorderQuestions(templateId, orderedIds)
      return res.json({ data: tpl })
    } catch (err) { return next(err) }
  }

  // --- Public survey answering (No auth required) ---

  static async getSurveyByToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.params.token as string
      const instance = await SurveyService.getSurveyByToken(token)
      return res.json({ data: instance })
    } catch (err) {
      return next(err)
    }
  }

  static async submitSurveyResponse(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.params.token as string
      const answerSchema = z.object({
        question_id: z.string(),
        valor_texto: z.string().optional(),
        valor_numero: z.number().optional(),
        valores_opcao: z.array(z.string()).optional()
      })
      const schema = z.object({
        answers: z.array(answerSchema),
        reopen_reason: z.string().optional(),
        reopen_attachment: z.string().optional()
      })

      const data = schema.parse(req.body)
      const response = await SurveyService.submitSurveyResponse(token, data)
      return res.status(201).json({ data: response })
    } catch (err) {
      return next(err)
    }
  }

  // --- Dashboard stats (Admins and Supervisors) ---

  static async getDashboardStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, orgId } = req.query
      const stats = await SurveyService.getDashboardStats({
        startDate: startDate as string,
        endDate: endDate as string,
        orgId: await orgFilterInScope(orgId, (req as any).user)
      })
      return res.json({ data: stats })
    } catch (err) {
      return next(err)
    }
  }

  // --- Ticket Link generation (Agents / Admins) ---

  static async getSurveyLinkForTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string // ticket ID
      await assertTicketVisible(id, (req as any).user) // antes: qualquer logado gerava o link de qualquer chamado
      const token = await SurveyService.getSurveyTokenForTicket(id)
      return res.json({ data: { token } })
    } catch (err) {
      return next(err)
    }
  }

  static async resendSurveyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const ticketId = req.params.id as string
      const user = (req as any).user
      await assertTicketVisible(ticketId, user)
      const result = await SurveyService.resendSurveyEmail(ticketId, user.sub)
      return res.json(result)
    } catch (err) {
      return next(err)
    }
  }

  static async getPendingSurveys(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user
      const pending = await SurveyService.getPendingSurveysForUser(user.sub)
      return res.json({ data: pending })
    } catch (err) {
      return next(err)
    }
  }
}
