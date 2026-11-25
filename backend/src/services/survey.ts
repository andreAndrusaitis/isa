import prisma from '../config/prisma'
import { canStillReopen } from './reopenWindow'
import { AppError } from '../middlewares/errorHandler'
import { createAuditLog } from './audit'
import crypto from 'crypto'
import { env } from '../config/env'
import { sendSurveyEmail } from './email/mailer'
import { TicketService } from './tickets'
import { multi } from '../utils/multiFilter'
import { buildTicketVars, renderTemplate } from './templateVariables'
import { isDataUri } from './uploads'
import { AI_NAME } from '../ai/core/persona'

/** Mesmo limite da caixa de texto do formulário. */
const MAX_ANSWER_TEXT = 1000

type SurveyAnswerInput = { question_id: string; valor_texto?: string; valor_numero?: number; valores_opcao?: string[] }
type SurveyQuestionRules = { id: string; tipo: string; estilo: string | null; ativa: boolean; opcoes: Array<{ valor: string; pontuacao: number | null }> }

/** Notas que o formulário oferece: mesma conta de optionScore em QuestionRenderer.tsx. */
function scoresOf(q: SurveyQuestionRules): number[] {
  if (q.tipo === 'nps') return Array.from({ length: 11 }, (_, n) => n)
  if (q.opcoes.length === 0) return [1, 2, 3, 4, 5]
  return q.opcoes.map((o, i) => o.pontuacao ?? (Number.isFinite(Number(o.valor)) ? Number(o.valor) : i + 1))
}

/**
 * O link é público e o dashboard soma cada linha gravada, então só entra o que o
 * formulário poderia ter enviado: uma resposta por pergunta, nota da escala, opção
 * existente. Campo que a pergunta não usa é ignorado, e sem conteúdo a linha nem é gravada.
 */
function validatedAnswers(questions: SurveyQuestionRules[], answers: SurveyAnswerInput[]): SurveyAnswerInput[] {
  const byId = new Map(questions.map(q => [q.id, q]))
  const seen = new Set<string>()
  const valid: SurveyAnswerInput[] = []
  for (const a of answers) {
    const q = byId.get(a.question_id)
    if (!q) throw new AppError(400, 'Resposta para pergunta que não pertence a esta pesquisa', 'BAD_REQUEST')
    if (seen.has(q.id)) throw new AppError(400, 'Pergunta respondida mais de uma vez', 'BAD_REQUEST')
    seen.add(q.id)
    // Desativada depois que o cliente abriu o link: ele não tem como corrigir, só não conta.
    if (!q.ativa) continue

    const picks = a.valores_opcao ?? []
    const optionsOk = new Set(picks).size === picks.length && picks.every(v => q.opcoes.some(o => o.valor === v))
    if (!optionsOk || (picks.length > 1 && q.tipo !== 'escolha_multipla')) {
      throw new AppError(400, `Opção inválida na pergunta "${a.question_id}"`, 'BAD_REQUEST')
    }

    const takesNumber = q.tipo === 'nps' || q.tipo === 'escala' || q.tipo === 'escala_1_5'
    if (takesNumber && typeof a.valor_numero === 'number' && !scoresOf(q).includes(a.valor_numero)) {
      throw new AppError(400, `Nota fora da escala na pergunta "${a.question_id}"`, 'BAD_REQUEST')
    }

    // Escala sem estilo e a legada não têm controle próprio: o formulário mostra a caixa de texto.
    const takesText = q.tipo === 'texto_livre' || q.tipo === 'escala_1_5' || (q.tipo === 'escala' && !q.estilo)
    if (takesText && (a.valor_texto?.length ?? 0) > MAX_ANSWER_TEXT) {
      throw new AppError(400, `A resposta deve ter no máximo ${MAX_ANSWER_TEXT} caracteres`, 'BAD_REQUEST')
    }

    const valor_texto = takesText && a.valor_texto?.trim() ? a.valor_texto : undefined
    const valor_numero = takesNumber ? a.valor_numero : undefined
    if (valor_texto !== undefined || valor_numero !== undefined || picks.length > 0) {
      valid.push({ question_id: q.id, valor_texto, valor_numero, valores_opcao: picks })
    }
  }
  return valid
}

export class SurveyService {
  /**
   * Obtém todos os templates de pesquisa.
   */
  static async getTemplates() {
    return prisma.surveyTemplate.findMany({
      orderBy: { created_at: 'desc' },
      include: { questions: { orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } } }
    })
  }

  /**
   * Obtém um template por ID.
   */
  static async getTemplate(id: string) {
    const template = await prisma.surveyTemplate.findUnique({
      where: { id },
      include: { questions: { orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } } }
    })
    if (!template) throw new AppError(404, 'Template não encontrado', 'NOT_FOUND')
    return template
  }

  /**
   * Obtém o template ativo vigente.
   */
  static async getActiveTemplate() {
    let template = await prisma.surveyTemplate.findFirst({
      where: { ativo: true },
      include: { questions: { orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } } }
    })
    if (!template) {
      template = await prisma.surveyTemplate.findFirst({
        include: { questions: { orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } } }
      })
    }
    if (!template) {
      throw new AppError(404, 'Nenhum template de pesquisa ativo no momento', 'NOT_FOUND')
    }
    return template
  }

  /**
   * Cria um novo template e insere as 5 perguntas padrão.
   */
  static async createTemplate(data: { nome: string; assunto_email: string; corpo_convite_auto: string; corpo_convite_macro: string; ativo?: boolean }, creatorId?: string) {
    const { nome, assunto_email, corpo_convite_auto, corpo_convite_macro, ativo = false } = data

    // Se estiver ativo, desativa os outros templates vigentes
    if (ativo) {
      await prisma.surveyTemplate.updateMany({
        where: { ativo: true },
        data: { ativo: false }
      })
    }

    const template = await prisma.surveyTemplate.create({
      data: {
        nome,
        assunto_email,
        corpo_convite_auto,
        corpo_convite_macro,
        ativo,
        atualizado_por_id: creatorId
      }
    })

    return this.getTemplate(template.id)
  }

  /**
   * Atualiza as informações básicas do template.
   */
  static async updateTemplate(id: string, data: { nome?: string; assunto_email?: string; corpo_convite_auto?: string; corpo_convite_macro?: string; ativo?: boolean }, creatorId?: string) {
    const template = await prisma.surveyTemplate.findUnique({ where: { id } })
    if (!template) throw new AppError(404, 'Template não encontrado', 'NOT_FOUND')

    const updateData: any = { ...data }
    if (creatorId) updateData.atualizado_por_id = creatorId

    if (data.ativo === true) {
      // Garante que apenas um modelo seja ativo por vez
      await prisma.surveyTemplate.updateMany({
        where: { id: { not: id }, ativo: true },
        data: { ativo: false }
      })
    }

    return prisma.surveyTemplate.update({
      where: { id },
      data: updateData,
      include: { questions: { orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } } }
    })
  }

  /**
   * Exclui um template.
   */
  static async deleteTemplate(id: string, operatorId?: string) {
    const template = await prisma.surveyTemplate.findUnique({ where: { id } })
    if (!template) throw new AppError(404, 'Template não encontrado', 'NOT_FOUND')
    if (template.ativo) throw new AppError(400, 'Não é possível excluir o template ativo principal', 'BAD_REQUEST')

    const result = await prisma.surveyTemplate.delete({ where: { id } })

    await createAuditLog({
      userId: operatorId,
      action: 'DELETE_SURVEY_TEMPLATE',
      resource: 'SURVEY',
      details: { templateId: id, nome: template.nome }
    })

    return result
  }

  /**
   * Ativa um template principal de pesquisa.
   */
  static async setActiveTemplate(id: string) {
    const template = await prisma.surveyTemplate.findUnique({ where: { id } })
    if (!template) throw new AppError(404, 'Template não encontrado', 'NOT_FOUND')

    await prisma.surveyTemplate.updateMany({
      where: { id: { not: id }, ativo: true },
      data: { ativo: false }
    })

    return prisma.surveyTemplate.update({
      where: { id },
      data: { ativo: true },
      include: { questions: { orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } } }
    })
  }

  /**
   * Obtém a instância de pesquisa pelo link_token público.
   */
  static async getSurveyByToken(token: string) {
    const instance = await prisma.surveyInstance.findUnique({
      where: { link_token: token },
      include: {
        // Pergunta desativada sai do formulário do cliente; o histórico dela
        // permanece no dashboard (ver getDashboard, que não filtra por 'ativa').
        template: { include: { questions: { where: { ativa: true }, orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } } } },
        ticket: { select: { id: true, title: true, user_id: true } }
      }
    })

    if (!instance) throw new AppError(404, 'Pesquisa não encontrada', 'NOT_FOUND')

    return {
      id: instance.id,
      ticket_id: instance.ticket_id,
      status: instance.status,
      ticket: instance.ticket,
      template: instance.template
    }
  }

  /**
   * Salva a resposta da pesquisa enviada pelo cliente (versão dinâmica).
   */
  static async submitSurveyResponse(token: string, data: {
    answers: Array<{ question_id: string; valor_texto?: string; valor_numero?: number; valores_opcao?: string[] }>
    reopen_reason?: string
    reopen_attachment?: string
  }) {
    const instance = await prisma.surveyInstance.findUnique({
      where: { link_token: token },
      include: { template: { include: { questions: { include: { opcoes: { orderBy: { ordem: 'asc' } } } } } } }
    })
    if (!instance) throw new AppError(404, 'Pesquisa não encontrada', 'NOT_FOUND')
    if (instance.status === 'respondida') throw new AppError(400, 'Esta pesquisa já foi respondida', 'ALREADY_ANSWERED')
    if (instance.status === 'expirada') throw new AppError(400, 'O prazo para responder esta pesquisa expirou', 'EXPIRED')

    const questions = instance.template.questions.filter(q => q.ativa)
    const answerByQ = new Map(data.answers.map(a => [a.question_id, a]))
    const answers = validatedAnswers(instance.template.questions, data.answers)

    // Detect reopen trigger first so we can relax mandatory validation for other questions
    let triggerReopen = false
    for (const a of answers) {
      const q = questions.find(q => q.id === a.question_id)
      if (!q) continue
      for (const valor of a.valores_opcao || []) {
        const opt = q.opcoes.find(o => o.valor === valor)
        if (opt?.acao === 'reabrir_chamado') triggerReopen = true
      }
    }

    if (triggerReopen) {
      if (!data.reopen_reason || data.reopen_reason.trim().length < 10) {
        throw new AppError(400, 'Para reabrir o chamado, o motivo deve ter pelo menos 10 caracteres', 'BAD_REQUEST')
      }
      // Link público: só arquivo enviado agora. Nome de blob seria assinado e, na purga, apagado.
      if (data.reopen_attachment && !isDataUri(data.reopen_attachment)) {
        throw new AppError(400, 'Anexo inválido', 'INVALID_ATTACHMENT_TYPE')
      }
    } else {
      // Only enforce mandatory questions when NOT reopening
      for (const q of questions) {
        if (!q.obrigatoria) continue
        const a = answerByQ.get(q.id)
        const answered = a && (
          (a.valor_texto && a.valor_texto.trim().length > 0) ||
          typeof a.valor_numero === 'number' ||
          (a.valores_opcao && a.valores_opcao.length > 0)
        )
        if (!answered) throw new AppError(400, `A pergunta "${q.enunciado}" é obrigatória`, 'BAD_REQUEST')
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const response = await tx.surveyResponse.create({ data: { instance_id: instance.id } })
      if (answers.length > 0) {
        await tx.surveyAnswer.createMany({
          data: answers.map(a => ({
            response_id: response.id,
            question_id: a.question_id,
            valor_texto: a.valor_texto ?? null,
            valor_numero: typeof a.valor_numero === 'number' ? a.valor_numero : null,
            valores_opcao: a.valores_opcao ?? []
          }))
        })
      }
      await tx.surveyInstance.update({ where: { id: instance.id }, data: { status: 'respondida', respondida_em: new Date() } })
      return response
    })

    if (triggerReopen) {
      const ticket = await prisma.ticket.findUnique({ where: { id: instance.ticket_id } })
      if (ticket && ticket.status === 'resolved') {
        await TicketService.reopenTicket(ticket.id, ticket.user_id, data.reopen_reason!)
        await TicketService.addMessage(ticket.id, ticket.user_id, data.reopen_reason!, 'user', data.reopen_attachment)
        await prisma.ticket.update({ where: { id: ticket.id }, data: { is_reopened: true } })
      }
    }

    return result
  }

  /**
   * Obtém ou gera o token exclusivo da pesquisa de um chamado para uso da macro.
   */
  static async getSurveyTokenForTicket(ticketId: string) {
    const existing = await prisma.surveyInstance.findUnique({
      where: { ticket_id: ticketId }
    })

    if (existing) {
      return existing.link_token
    }

    // Sem atendimento não há o que avaliar: fecha também o link da macro e o reenvio.
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { ai_resolved: true } })
    if (ticket?.ai_resolved) {
      throw new AppError(409, `Chamado resolvido pela ${AI_NAME} não tem pesquisa de satisfação`, 'AI_RESOLVED_NO_SURVEY')
    }

    // Cria uma nova instância associando o chamado ao template vigente
    const activeTemplate = await this.getActiveTemplate()
    const linkToken = crypto.randomBytes(16).toString('hex')

    const created = await prisma.surveyInstance.create({
      data: {
        ticket_id: ticketId,
        template_id: activeTemplate.id,
        link_token: linkToken,
        status: 'enviada'
      }
    })

    return created.link_token
  }

  /**
   * Dispara a pesquisa automaticamente via e-mail e chat.
   */
  static async triggerAutoSurvey(ticketId: string) {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { user: true }
      })
      if (!ticket) return

      // Garante a geração do token
      const token = await this.getSurveyTokenForTicket(ticketId)
      const instance = await prisma.surveyInstance.findUnique({
        where: { ticket_id: ticketId },
        include: { template: true }
      })
      if (!instance) return

      const template = instance.template
      const linkSurvey = `${env.PORTAL_URL}/survey/${token}`
      const vars = await buildTicketVars(ticketId, { linkSurvey })

      // ── 1. Disparo de e-mail se o cliente tiver e-mail cadastrado
      if (ticket.user && ticket.user.email) {
        const dispatchEmail = await prisma.surveyDispatch.create({
          data: {
            instance_id: instance.id,
            canal: 'email',
            status_envio: 'enfileirado'
          }
        })

        // Executa o envio de forma assíncrona (não bloqueia fluxo)
        sendSurveyEmail({
          to: ticket.user.email,
          ticketId,
          vars,
          linkSurvey,
          subjectTemplate: template.assunto_email,
          bodyTemplate: template.corpo_convite_auto
        }).then(async (result) => {
          try {
            await prisma.surveyDispatch.update({
              where: { id: dispatchEmail.id },
              data: {
                status_envio: result.status === 'SUCCESS' ? 'enviado' : 'falha',
                disparado_em: new Date()
              }
            })
          } catch (e) {
            // ignore if deleted during test cleanup
          }
        }).catch(async (err) => {
          console.error('[SurveyService] Erro ao enviar e-mail:', err)
          try {
            await prisma.surveyDispatch.update({
              where: { id: dispatchEmail.id },
              data: {
                status_envio: 'falha',
                disparado_em: new Date()
              }
            })
          } catch (e) {
            // ignore if deleted during test cleanup
          }
        })
      }

      // ── 2. Disparo de mensagem no canal de chat (chat_auto)
      const dispatchChat = await prisma.surveyDispatch.create({
        data: {
          instance_id: instance.id,
          canal: 'chat_auto',
          status_envio: 'enfileirado'
        }
      })

      const chatText = renderTemplate(template.corpo_convite_auto, vars)

      try {
        await TicketService.addMessage(ticketId, 'system', chatText, 'agent')
        try {
          await prisma.surveyDispatch.update({
            where: { id: dispatchChat.id },
            data: {
              status_envio: 'enviado',
              disparado_em: new Date()
            }
          })
        } catch (e) {
          // ignore if deleted during test cleanup
        }
      } catch (err) {
        console.error('[SurveyService] Erro ao enviar mensagem de chat:', err)
        try {
          await prisma.surveyDispatch.update({
            where: { id: dispatchChat.id },
            data: {
              status_envio: 'falha',
              disparado_em: new Date()
            }
          })
        } catch (e) {
          // ignore if deleted during test cleanup
        }
      }
    } catch (err) {
      console.error('[SurveyService] Falha ao processar trigger de pesquisa:', err)
    }
  }

  /**
   * Consolida dados para o dashboard gerencial (apenas chamados concluídos).
   * Agrega resultados dinamicamente por pergunta a partir de SurveyAnswer.
   */
  static async getDashboardStats(filters: { startDate?: string; endDate?: string; orgId?: string }) {
    const { startDate, endDate, orgId } = filters

    const ticketWhere: any = {
      status: { in: ['resolved', 'closed'] },
      deleted_at: null
    }

    if (startDate || endDate) {
      const dateFilter: any = {}
      if (startDate) dateFilter.gte = new Date(startDate)
      if (endDate) dateFilter.lte = new Date(endDate)
      ticketWhere.resolved_at = dateFilter
    }

    ticketWhere.org_id = multi(orgId)

    const tickets = await prisma.ticket.findMany({
      where: ticketWhere,
      select: {
        id: true,
        title: true,
        user: { select: { id: true, name: true, email: true } },
        org: { select: { name: true } },
        survey_instance: {
          include: {
            dispatches: true,
            response: {
              include: { answers: true }
            },
            template: {
              include: {
                // Sem filtro de 'ativa': perguntas desativadas saem da pesquisa
                // nova, mas o histórico já respondido continua no dashboard.
                questions: {
                  orderBy: { ordem: 'asc' },
                  include: { opcoes: { orderBy: { ordem: 'asc' } } }
                }
              }
            }
          }
        }
      }
    })

    let totalDispatches = 0
    let totalResponses = 0

    // Per-question accumulators — keyed by question ID
    type QuestionDef = {
      enunciado: string
      tipo: string
      estilo: string | null
      ativa: boolean
      opcoes: Array<{ rotulo: string; valor: string; pontuacao: number | null; emoji: string | null; cor: string | null }>
    }

    const qDefs = new Map<string, QuestionDef>()
    const qOptCounts = new Map<string, Map<string, number>>() // qId -> valor -> count
    const qNumeric = new Map<string, { sum: number; n: number }>()
    const qNps = new Map<string, { det: number; neu: number; pro: number; total: number }>()
    const qComments = new Map<string, Array<{ ticketId: string; text: string; date: string }>>()
    // Quantas respostas cada pergunta recebeu — usado no front para sinalizar
    // amostra pequena (um índice 100 com n=3 engana quem lê o dashboard).
    const qAnswered = new Map<string, number>()
    // Série mensal por pergunta: qId -> 'YYYY-MM' -> média normalizada 0..100
    const qMonthly = new Map<string, Map<string, { sum: number; n: number }>>()

    const responsesList: Array<{
      ticketId: string
      ticketTitle: string
      clientName: string
      companyName: string
      date: string
      answers: Array<{ questionId: string; enunciado: string; display: string }>
    }> = []

    const unansweredList: Array<{
      ticketId: string
      ticketTitle: string
      clientName: string
      clientEmail: string
      companyName: string
      status: string
      sentAt: string
      dispatchesCount: number
    }> = []

    // Série histórica: acumulado por mês (chave 'YYYY-MM'), preenchida no mesmo
    // loop dos tickets para não fazer uma segunda query.
    const monthly = new Map<string, { sent: number; responses: number; scoreSum: number; scoreN: number }>()
    const monthBucket = (key: string) => {
      let b = monthly.get(key)
      if (!b) {
        b = { sent: 0, responses: 0, scoreSum: 0, scoreN: 0 }
        monthly.set(key, b)
      }
      return b
    }
    const monthKey = (d: Date) => d.toISOString().slice(0, 7)

    for (const t of tickets) {
      const instance = t.survey_instance
      if (!instance) continue

      totalDispatches += instance.dispatches.length
      const sentBucket = monthBucket(monthKey(instance.created_at))
      sentBucket.sent += instance.dispatches.length

      // Register question definitions from this template
      for (const q of instance.template.questions) {
        if (!qDefs.has(q.id)) {
          qDefs.set(q.id, {
            enunciado: q.enunciado,
            tipo: q.tipo,
            estilo: q.estilo ?? null,
            ativa: q.ativa,
            opcoes: q.opcoes.map(o => ({
              rotulo: o.rotulo,
              valor: o.valor,
              pontuacao: o.pontuacao ?? null,
              emoji: o.emoji ?? null,
              cor: o.cor ?? null
            }))
          })
          qOptCounts.set(q.id, new Map())
          qAnswered.set(q.id, 0)
          qMonthly.set(q.id, new Map())
          qNumeric.set(q.id, { sum: 0, n: 0 })
          qNps.set(q.id, { det: 0, neu: 0, pro: 0, total: 0 })
          if (q.tipo === 'texto_livre') {
            qComments.set(q.id, [])
          }
        }
      }

      const resp = instance.response
      if (!resp || instance.status !== 'respondida') {
        const sentAt = instance.created_at.toISOString()
        unansweredList.push({
          ticketId: t.id,
          ticketTitle: t.title,
          clientName: t.user ? t.user.name : '—',
          clientEmail: t.user ? t.user.email : '—',
          companyName: t.org ? t.org.name : '—',
          status: instance.status,
          sentAt,
          dispatchesCount: instance.dispatches.length
        })
        continue
      }

      totalResponses++
      const responseDate = resp.respondido_em.toISOString()
      const respBucket = monthBucket(monthKey(resp.respondido_em))
      respBucket.responses++

      const answerDisplays: Array<{ questionId: string; enunciado: string; display: string }> = []

      for (const a of resp.answers) {
        const def = qDefs.get(a.question_id)
        if (!def) continue

        qAnswered.set(a.question_id, (qAnswered.get(a.question_id) ?? 0) + 1)

        // Option distribution: from explicit selections OR from numeric value matched to option valor
        const optMap = qOptCounts.get(a.question_id)!
        if (a.valores_opcao && a.valores_opcao.length > 0) {
          for (const v of a.valores_opcao) {
            optMap.set(v, (optMap.get(v) ?? 0) + 1)
          }
        } else if (typeof a.valor_numero === 'number') {
          // For escala/nps questions where the answer is a numeric value matching an option
          const numStr = String(a.valor_numero)
          if (def.opcoes.some(o => o.valor === numStr)) {
            optMap.set(numStr, (optMap.get(numStr) ?? 0) + 1)
          }
        }

        // Numeric average + NPS
        if (typeof a.valor_numero === 'number') {
          const num = qNumeric.get(a.question_id)!
          num.sum += a.valor_numero
          num.n++

          // Índice mensal de satisfação: escalas têm ranges diferentes (1..5,
          // 0..10), então normaliza cada nota para 0..100 antes de somar.
          const escala = def.opcoes.map(o => Number(o.valor)).filter(v => Number.isFinite(v))
          const min = escala.length > 0 ? Math.min(...escala) : 0
          const max = escala.length > 0 ? Math.max(...escala) : 10
          if (max > min) {
            const normalizado = ((a.valor_numero - min) / (max - min)) * 100
            respBucket.scoreSum += normalizado
            respBucket.scoreN++

            // Mesma nota normalizada, agora acumulada por pergunta/mês para a
            // série individual de cada indicador.
            const porMes = qMonthly.get(a.question_id)!
            const mk = monthKey(resp.respondido_em)
            const cell = porMes.get(mk) ?? { sum: 0, n: 0 }
            cell.sum += normalizado
            cell.n++
            porMes.set(mk, cell)
          }

          const nps = qNps.get(a.question_id)!
          if (a.valor_numero <= 6) nps.det++
          else if (a.valor_numero <= 8) nps.neu++
          else nps.pro++
          nps.total++
        }

        // Text comments
        if (def.tipo === 'texto_livre' && a.valor_texto && a.valor_texto.trim()) {
          qComments.get(a.question_id)!.push({
            ticketId: t.id,
            text: a.valor_texto,
            date: responseDate
          })
        }

        // Build display string for responsesList
        let display = ''
        if (a.valor_texto) {
          display = a.valor_texto
        } else if (typeof a.valor_numero === 'number') {
          const matchOpt = def.opcoes.find(o => o.valor === String(a.valor_numero))
          display = matchOpt ? matchOpt.rotulo : String(a.valor_numero)
        } else if (a.valores_opcao && a.valores_opcao.length > 0) {
          display = a.valores_opcao
            .map(v => def.opcoes.find(o => o.valor === v)?.rotulo ?? v)
            .join(', ')
        }
        answerDisplays.push({ questionId: a.question_id, enunciado: def.enunciado, display })
      }

      responsesList.push({
        ticketId: t.id,
        ticketTitle: t.title,
        clientName: t.user ? t.user.name : '—',
        companyName: t.org ? t.org.name : '—',
        date: responseDate,
        answers: answerDisplays
      })
    }

    // Build per-question stats.
    // Pergunta desativada só entra no dashboard se tiver histórico respondido —
    // assim a pergunta antiga continua visível, mas uma inativa nunca respondida
    // não polui a tela com uma linha zerada.
    const temHistorico = (qId: string) => {
      const optMap = qOptCounts.get(qId)
      return (qNumeric.get(qId)?.n ?? 0) > 0
        || (qComments.get(qId)?.length ?? 0) > 0
        || (optMap ? Array.from(optMap.values()).some(c => c > 0) : false)
    }

    // Janela dos 12 meses: âncora no fim do período filtrado (ou hoje). Compartilhada
    // pela tendência global e pela série de cada pergunta, para os eixos baterem.
    const anchor = endDate ? new Date(endDate) : new Date()
    const monthWindow = Array.from({ length: 12 }, (_, i) =>
      new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - (11 - i), 1))
        .toISOString()
        .slice(0, 7)
    )

    const questions = Array.from(qDefs.entries())
      .filter(([questionId, def]) => def.ativa || temHistorico(questionId))
      .map(([questionId, def]) => {
      const optMap = qOptCounts.get(questionId)!
      const numeric = qNumeric.get(questionId)!
      const bucket = qNps.get(questionId)!

      // Distribution: only for non-texto_livre questions with defined options
      let distribution: Array<{
        rotulo: string; valor: string; count: number; pct: number; emoji: string | null; cor: string | null
      }> | null = null
      if (def.tipo !== 'texto_livre' && def.opcoes.length > 0) {
        const totalOptSelections = Array.from(optMap.values()).reduce((s, c) => s + c, 0)
        // Em múltipla escolha o respondente marca várias opções: dividir pelo
        // total de seleções renormalizaria para 100% e mentiria sobre o dado.
        // O denominador correto é o número de respondentes — a soma dos pct
        // pode (e deve) passar de 100%.
        const denom = def.tipo === 'escolha_multipla'
          ? (qAnswered.get(questionId) ?? 0)
          : totalOptSelections
        distribution = def.opcoes.map(o => {
          const count = optMap.get(o.valor) ?? 0
          const pct = denom > 0 ? Math.round((count / denom) * 100) : 0
          return { rotulo: o.rotulo, valor: o.valor, count, pct, emoji: o.emoji, cor: o.cor }
        })
      }

      const average = numeric.n > 0 ? Math.round((numeric.sum / numeric.n) * 10) / 10 : null
      const npsScore = def.tipo === 'nps' && bucket.total > 0
        ? Math.round(((bucket.pro - bucket.det) / bucket.total) * 100)
        : null
      const comments = def.tipo === 'texto_livre' ? (qComments.get(questionId) ?? []) : null

      // Range da escala — o front usa para formatar "4,3 de 5" e desenhar
      // estrelas/emojis na ordem certa.
      const valoresNum = def.opcoes.map(o => Number(o.valor)).filter(v => Number.isFinite(v))
      const scaleMin = valoresNum.length > 0 ? Math.min(...valoresNum) : null
      const scaleMax = valoresNum.length > 0 ? Math.max(...valoresNum) : null

      const porMes = qMonthly.get(questionId)
      const monthlyScores = monthWindow.map(m => {
        const cell = porMes?.get(m)
        return {
          month: m,
          score: cell && cell.n > 0 ? Math.round((cell.sum / cell.n) * 10) / 10 : null,
          responses: cell?.n ?? 0
        }
      })

      return {
        questionId,
        enunciado: def.enunciado,
        tipo: def.tipo,
        estilo: def.estilo,
        ativa: def.ativa,
        distribution,
        average,
        npsScore,
        comments,
        answeredCount: qAnswered.get(questionId) ?? 0,
        scaleMin,
        scaleMax,
        npsBuckets: def.tipo === 'nps' ? { detratores: bucket.det, neutros: bucket.neu, promotores: bucket.pro } : null,
        monthlyScores
      }
    })

    const responseRate = totalDispatches > 0 ? Math.round((totalResponses / totalDispatches) * 100) : 0

    // Últimos 12 meses até o fim do período filtrado (ou até hoje), com os
    // meses sem dado presentes e zerados para a linha do tempo não ter buracos.
    const monthlyTrend = monthWindow.map(key => {
      const b = monthly.get(key) ?? { sent: 0, responses: 0, scoreSum: 0, scoreN: 0 }
      return {
        month: key,
        sent: b.sent,
        responses: b.responses,
        responseRate: b.sent > 0 ? Math.round((b.responses / b.sent) * 100) : 0,
        satisfactionScore: b.scoreN > 0 ? Math.round((b.scoreSum / b.scoreN) * 10) / 10 : null
      }
    })

    return {
      monthlyTrend,
      sent: totalDispatches,
      responses: totalResponses,
      responseRate,
      questions,
      responsesList: responsesList.sort((a, b) => b.date.localeCompare(a.date)),
      unansweredList: unansweredList.sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    }
  }

  /**
   * Obtém as pesquisas pendentes (não respondidas) de um determinado usuário.
   */
  // Enquanto o cliente ainda vai dizer se resolveu, a pesquisa espera: ela vem depois da confirmação.
  static async getPendingSurveysForUser(userId: string) {
    const [pending, config] = await Promise.all([prisma.surveyInstance.findMany({
      where: {
        status: 'enviada',
        ticket: {
          user_id: userId
        }
      },
      include: {
        ticket: {
          select: {
            id: true,
            title: true,
            status: true, reopen_sla_enabled: true, reopen_sla_limit_hours: true, resolved_at: true, closed_at: true, updated_at: true
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    }), prisma.reopenSlaConfig.findFirst()])
    return pending
      .filter(p => p.ticket.status !== 'resolved' || !canStillReopen(p.ticket, config))
      .map(p => ({ ...p, ticket: { id: p.ticket.id, title: p.ticket.title } }))
  }

  /**
   * Reenvia a pesquisa de satisfação por e-mail para um chamado específico.
   */
  static async resendSurveyEmail(ticketId: string, operatorId: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { user: true }
    })
    if (!ticket) throw new AppError(404, 'Chamado não encontrado', 'NOT_FOUND')
    if (!ticket.user || !ticket.user.email) {
      throw new AppError(400, 'O cliente deste chamado não possui e-mail cadastrado', 'BAD_REQUEST')
    }

    // Get the survey instance
    let instance = await prisma.surveyInstance.findUnique({
      where: { ticket_id: ticketId },
      include: { template: true }
    })

    if (!instance) {
      // If it doesn't exist, create it
      await this.getSurveyTokenForTicket(ticketId)
      instance = await prisma.surveyInstance.findUnique({
        where: { ticket_id: ticketId },
        include: { template: true }
      })
    }

    if (!instance) throw new AppError(404, 'Instância de pesquisa não encontrada', 'NOT_FOUND')

    // If survey is already answered, don't allow resending
    if (instance.status === 'respondida') {
      throw new AppError(400, 'Esta pesquisa já foi respondida', 'BAD_REQUEST')
    }

    // Update status to 'enviada' (in case it was 'expirada')
    if (instance.status !== 'enviada') {
      await prisma.surveyInstance.update({
        where: { id: instance.id },
        data: { status: 'enviada' }
      })
    }

    const template = instance.template
    const linkSurvey = `${env.PORTAL_URL}/survey/${instance.link_token}`

    // Create survey dispatch record
    const dispatchEmail = await prisma.surveyDispatch.create({
      data: {
        instance_id: instance.id,
        canal: 'email',
        disparado_por: operatorId,
        status_envio: 'enfileirado'
      }
    })

    // Send the email asynchronously
    sendSurveyEmail({
      to: ticket.user.email,
      ticketId,
      resend: true,
      vars: await buildTicketVars(ticketId, { linkSurvey }),
      linkSurvey,
      subjectTemplate: template.assunto_email,
      bodyTemplate: template.corpo_convite_auto
    }).then(async (result) => {
      try {
        await prisma.surveyDispatch.update({
          where: { id: dispatchEmail.id },
          data: {
            status_envio: result.status === 'SUCCESS' ? 'enviado' : 'falha',
            disparado_em: new Date()
          }
        })
      } catch (e) {
        console.error('[SurveyService] Erro ao atualizar status do dispatch de reenvio:', e)
      }
    }).catch(async (err) => {
      console.error('[SurveyService] Erro ao enviar e-mail de reenvio:', err)
      try {
        await prisma.surveyDispatch.update({
          where: { id: dispatchEmail.id },
          data: {
            status_envio: 'falha',
            disparado_em: new Date()
          }
        })
      } catch (e) {
        // ignore
      }
    })

    return { message: 'E-mail de pesquisa reenviado com sucesso' }
  }

  /**
   * Adiciona uma pergunta ao template, com opções opcionais.
   */
  static async addQuestion(templateId: string, data: {
    enunciado: string
    descricao?: string
    tipo: 'escala' | 'escolha_unica' | 'escolha_multipla' | 'texto_livre' | 'nps'
    estilo?: 'emoji' | 'estrela' | 'numerico' | 'pill'
    obrigatoria?: boolean
    ativa?: boolean
    opcoes?: Array<{ rotulo: string; valor: string; emoji?: string; cor?: string; pontuacao?: number; acao?: 'reabrir_chamado' }>
  }) {
    const template = await prisma.surveyTemplate.findUnique({ where: { id: templateId } })
    if (!template) throw new AppError(404, 'Template não encontrado', 'NOT_FOUND')

    const count = await prisma.surveyQuestion.count({ where: { template_id: templateId } })
    const question = await prisma.surveyQuestion.create({
      data: {
        template_id: templateId,
        ordem: count + 1,
        enunciado: data.enunciado,
        descricao: data.descricao,
        tipo: data.tipo,
        estilo: data.estilo,
        obrigatoria: data.obrigatoria ?? false,
        ativa: data.ativa ?? true,
        opcoes: data.opcoes ? {
          create: data.opcoes.map((o, i) => ({
            ordem: i + 1, rotulo: o.rotulo, valor: o.valor,
            emoji: o.emoji, cor: o.cor, pontuacao: o.pontuacao, acao: o.acao
          }))
        } : undefined
      },
      include: { opcoes: { orderBy: { ordem: 'asc' } } }
    })
    return question
  }

  /**
   * Atualiza uma pergunta existente e opcionalmente substitui suas opções.
   */
  static async updateQuestion(questionId: string, data: {
    enunciado?: string
    descricao?: string | null
    tipo?: 'escala' | 'escolha_unica' | 'escolha_multipla' | 'texto_livre' | 'nps'
    estilo?: 'emoji' | 'estrela' | 'numerico' | 'pill' | null
    obrigatoria?: boolean
    ativa?: boolean
    opcoes?: Array<{ rotulo: string; valor: string; emoji?: string; cor?: string; pontuacao?: number; acao?: 'reabrir_chamado' }>
  }) {
    const question = await prisma.surveyQuestion.findUnique({ where: { id: questionId } })
    if (!question) throw new AppError(404, 'Pergunta não encontrada', 'NOT_FOUND')

    return prisma.$transaction(async (tx) => {
      await tx.surveyQuestion.update({
        where: { id: questionId },
        data: {
          enunciado: data.enunciado,
          descricao: data.descricao,
          tipo: data.tipo,
          estilo: data.estilo,
          obrigatoria: data.obrigatoria,
          ativa: data.ativa
        }
      })
      if (data.opcoes) {
        await tx.surveyQuestionOption.deleteMany({ where: { question_id: questionId } })
        await tx.surveyQuestionOption.createMany({
          data: data.opcoes.map((o, i) => ({
            question_id: questionId, ordem: i + 1, rotulo: o.rotulo, valor: o.valor,
            emoji: o.emoji, cor: o.cor, pontuacao: o.pontuacao, acao: o.acao
          }))
        })
      }
      return tx.surveyQuestion.findUniqueOrThrow({
        where: { id: questionId },
        include: { opcoes: { orderBy: { ordem: 'asc' } } }
      })
    })
  }

  /**
   * Deleta uma pergunta e suas opções em cascata.
   */
  static async deleteQuestion(questionId: string) {
    const question = await prisma.surveyQuestion.findUnique({ where: { id: questionId } })
    if (!question) throw new AppError(404, 'Pergunta não encontrada', 'NOT_FOUND')

    // Se já foi respondida, o hard delete levaria as respostas junto e alteraria
    // métricas históricas do dashboard. Nesse caso desativa: sai da pesquisa nova
    // e da lista do admin, mas o histórico continua agregado no dashboard.
    const respondida = await prisma.surveyAnswer.count({ where: { question_id: questionId } })
    if (respondida > 0) {
      await prisma.surveyQuestion.update({ where: { id: questionId }, data: { ativa: false } })
      return { id: questionId, arquivada: true, respostas: respondida }
    }

    await prisma.surveyQuestion.delete({ where: { id: questionId } })
    return { id: questionId, arquivada: false, respostas: 0 }
  }

  /**
   * Reordena as perguntas de um template.
   */
  static async reorderQuestions(templateId: string, orderedIds: string[]) {
    await prisma.$transaction(
      orderedIds.map((id, i) =>
        prisma.surveyQuestion.update({ where: { id }, data: { ordem: i + 1 } })
      )
    )
    return this.getTemplate(templateId)
  }
}
