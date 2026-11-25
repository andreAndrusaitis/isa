import { Request, Response, NextFunction } from 'express'
import * as macroService from '../services/macros'
import { getAuditInfo } from '../utils/audit'
import { z } from 'zod'
import prisma from '../config/prisma'
import { getTicketAccess } from '../services/ticketAccess'
import { forbidden } from '../utils/denials'
import { AppError } from '../middlewares/errorHandler'
import { SurveyService } from '../services/survey'
import { env } from '../config/env'
import { TEMPLATE_VARIABLES, EXAMPLE_VARS, buildTicketVars, renderTemplate, usesVariable, findUnknownVariables } from '../services/templateVariables'

export function variables(_req: Request, res: Response) {
  res.json({ data: TEMPLATE_VARIABLES })
}

const renderSchema = z.object({ content: z.string().max(5000), ticketId: z.string().max(100).optional() })

// Sem ticketId = pré-visualização com o chamado de exemplo.
export async function render(req: Request, res: Response, next: NextFunction) {
  try {
    const { content, ticketId } = renderSchema.parse(req.body)
    const unknown = findUnknownVariables(content)
    if (!ticketId) return res.json({ data: { content: renderTemplate(content, EXAMPLE_VARS), unknown } })

    const user = (req as any).user
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, user_id: true, org_id: true, queue: true, assigned_to_id: true, collab_queue: true, escalated: true, deleted_at: true },
    })
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
    const access = await getTicketAccess(ticket, user)
    if (!access.allowed) throw forbidden(access.code, access.message)

    // Só gera o token da pesquisa quando a macro usa o link (cria a instância).
    // Sem modelo ativo o link fica vazio em vez de derrubar a macro inteira.
    let linkSurvey: string | undefined
    if (usesVariable(content, 'link_pesquisa')) {
      try {
        linkSurvey = `${env.PORTAL_URL}/survey/${await SurveyService.getSurveyTokenForTicket(ticketId)}`
      } catch (err) {
        console.error('[macros.render] Erro ao obter token de pesquisa:', err)
      }
    }
    const vars = await buildTicketVars(ticketId, { analystId: user.sub, linkSurvey })
    return res.json({ data: { content: renderTemplate(content, vars), surveyLink: !!linkSurvey, unknown } })
  } catch (err) { return next(err) }
}

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const macros = await macroService.listMacros()
    res.json({ data: macros })
  } catch (err) { next(err) }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = macroService.macroSchema.parse(req.body)
    const audit = getAuditInfo(req)
    const macro = await macroService.createMacro(data, audit)
    res.status(201).json({ data: macro })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = macroService.macroSchema.partial().parse(req.body)
    const audit = getAuditInfo(req)
    const macro = await macroService.updateMacro(req.params.id as string, data, audit)
    res.json({ data: macro })
  } catch (err) { next(err) }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const audit = getAuditInfo(req)
    await macroService.deleteMacro(req.params.id as string, audit)
    res.json({ message: 'Macro excluída com sucesso' })
  } catch (err) { next(err) }
}

