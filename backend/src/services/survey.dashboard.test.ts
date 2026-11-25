import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { SurveyService } from './survey'

const SUFFIX = `dash-${Date.now()}`
let orgId: string
let userId: string
let ticketId: string
let templateId: string
let qEscalaId: string
let qTextoId: string
let instanceId: string
let token: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `DashOrg ${SUFFIX}` } })
  orgId = org.id

  const user = await prisma.user.create({
    data: {
      name: `DashUser ${SUFFIX}`,
      email: `dash-${SUFFIX}@t.com`,
      password: 'x',
      role: 'user',
      org_id: orgId
    }
  })
  userId = user.id

  const ticket = await prisma.ticket.create({
    data: {
      id: `DT-${SUFFIX}`,
      display_number: `INC-DT-${SUFFIX}`,
      title: `Dashboard Ticket ${SUFFIX}`,
      description: 'd',
      user_id: userId,
      org_id: orgId,
      queue: 'geral',
      status: 'resolved',
      resolved_at: new Date(),
      sla_deadline: new Date(Date.now() + 86400000)
    }
  })
  ticketId = ticket.id

  const template = await prisma.surveyTemplate.create({
    data: {
      nome: `DashTpl ${SUFFIX}`,
      assunto_email: 'Assunto',
      corpo_convite_auto: 'Corpo auto',
      corpo_convite_macro: 'Corpo macro',
      ativo: false
    }
  })
  templateId = template.id

  const qEscala = await prisma.surveyQuestion.create({
    data: {
      template_id: templateId,
      ordem: 1,
      enunciado: 'Como você avalia o atendimento?',
      tipo: 'escala',
      estilo: 'emoji',
      obrigatoria: true,
      ativa: true,
      opcoes: {
        create: [
          { ordem: 1, rotulo: 'Ruim', valor: '1', pontuacao: 1 },
          { ordem: 2, rotulo: 'Ótimo', valor: '4', pontuacao: 4 }
        ]
      }
    }
  })
  qEscalaId = qEscala.id

  const qTexto = await prisma.surveyQuestion.create({
    data: {
      template_id: templateId,
      ordem: 2,
      enunciado: 'Deixe seu comentário',
      tipo: 'texto_livre',
      obrigatoria: false,
      ativa: true
    }
  })
  qTextoId = qTexto.id

  const instance = await prisma.surveyInstance.create({
    data: {
      ticket_id: ticketId,
      template_id: templateId,
      link_token: `dashtoken-${SUFFIX}`,
      status: 'enviada'
    }
  })
  instanceId = instance.id
  token = instance.link_token

  // Create at least one dispatch so sent > 0
  await prisma.surveyDispatch.create({
    data: {
      instance_id: instanceId,
      canal: 'chat_auto',
      status_envio: 'enviado'
    }
  })

  // Submit a response via the service
  await SurveyService.submitSurveyResponse(token, {
    answers: [
      { question_id: qEscalaId, valor_numero: 4 },
      { question_id: qTextoId, valor_texto: 'Muito bom atendimento' }
    ]
  })
})

afterAll(async () => {
  await prisma.surveyAnswer.deleteMany({ where: { question: { template_id: templateId } } }).catch(() => {})
  await prisma.surveyResponse.deleteMany({ where: { instance: { template_id: templateId } } }).catch(() => {})
  await prisma.surveyDispatch.deleteMany({ where: { instance: { template_id: templateId } } }).catch(() => {})
  await prisma.surveyInstance.deleteMany({ where: { template_id: templateId } }).catch(() => {})
  await prisma.surveyQuestionOption.deleteMany({ where: { question: { template_id: templateId } } }).catch(() => {})
  await prisma.surveyQuestion.deleteMany({ where: { template_id: templateId } }).catch(() => {})
  await prisma.surveyTemplate.deleteMany({ where: { id: templateId } }).catch(() => {})
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: ticketId } }).catch(() => {})
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: ticketId } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('SurveyService.getDashboardStats (dynamic aggregation)', () => {
  it('returns per-question stats with distribution and comments', async () => {
    const stats = await SurveyService.getDashboardStats({})

    // Global counters — tolerant, production may have other data
    expect(stats.responses).toBeGreaterThanOrEqual(1)

    // Must have a questions array
    expect(Array.isArray(stats.questions)).toBe(true)

    // Find the escala question by ID
    const qStat = stats.questions.find(q => q.questionId === qEscalaId)
    expect(qStat).toBeTruthy()
    expect(qStat!.distribution).not.toBeNull()
    expect(qStat!.distribution!.reduce((s, d) => s + d.count, 0)).toBeGreaterThanOrEqual(1)
    expect(typeof qStat!.average).toBe('number')

    // Find the texto_livre question by ID
    const txtStat = stats.questions.find(q => q.questionId === qTextoId)
    expect(txtStat).toBeTruthy()
    expect(Array.isArray(txtStat!.comments)).toBe(true)
    expect(txtStat!.comments!.length).toBeGreaterThanOrEqual(1)

    // responsesList must contain our ticket
    const ourEntry = stats.responsesList.find(r => r.ticketId === ticketId)
    expect(ourEntry).toBeTruthy()
    expect(Array.isArray(ourEntry!.answers)).toBe(true)
  })

  it('normalizes escolha_multipla pct by respondents, so the sum may exceed 100%', async () => {
    // Pergunta de múltipla escolha com 3 opções
    const qMulti = await prisma.surveyQuestion.create({
      data: {
        template_id: templateId,
        ordem: 3,
        enunciado: `Quais canais você usou? ${SUFFIX}`,
        tipo: 'escolha_multipla',
        obrigatoria: false,
        ativa: true,
        opcoes: {
          create: [
            { ordem: 1, rotulo: 'E-mail', valor: 'email' },
            { ordem: 2, rotulo: 'Telefone', valor: 'fone' },
            { ordem: 3, rotulo: 'Chat', valor: 'chat' }
          ]
        }
      }
    })

    // Um respondente marcando 2 das 3 opções
    const ticketM = await prisma.ticket.create({
      data: {
        id: `DTM-${SUFFIX}`,
        display_number: `INC-DTM-${SUFFIX}`,
        title: `Multi Ticket ${SUFFIX}`,
        description: 'd',
        user_id: userId,
        org_id: orgId,
        queue: 'geral',
        status: 'resolved',
        resolved_at: new Date(),
        sla_deadline: new Date(Date.now() + 86400000)
      }
    })
    const instM = await prisma.surveyInstance.create({
      data: {
        ticket_id: ticketM.id,
        template_id: templateId,
        link_token: `dashtoken-multi-${SUFFIX}`,
        status: 'enviada'
      }
    })
    await prisma.surveyDispatch.create({
      data: { instance_id: instM.id, canal: 'chat_auto', status_envio: 'enviado' }
    })
    await SurveyService.submitSurveyResponse(instM.link_token, {
      answers: [
        // qEscalaId é obrigatória no template — precisa ser respondida em toda submissão
        { question_id: qEscalaId, valor_numero: 4 },
        { question_id: qMulti.id, valores_opcao: ['email', 'chat'] }
      ]
    })

    const stats = await SurveyService.getDashboardStats({ orgId })
    const stat = stats.questions.find(q => q.questionId === qMulti.id)!

    const email = stat.distribution!.find(d => d.valor === 'email')!
    const chat = stat.distribution!.find(d => d.valor === 'chat')!
    const fone = stat.distribution!.find(d => d.valor === 'fone')!

    // 1 respondente marcou email e chat: cada um é 100% DOS RESPONDENTES.
    // Dividindo pelo total de seleções (2) daria 50% em cada — a renormalização
    // enganosa que a correção elimina.
    expect(stat.answeredCount).toBe(1)
    expect(email.pct).toBe(100)
    expect(chat.pct).toBe(100)
    expect(fone.pct).toBe(0)
    expect(email.pct + chat.pct + fone.pct).toBeGreaterThan(100)

    // Cleanup — restrito aos IDs criados aqui
    await prisma.surveyAnswer.deleteMany({ where: { question_id: qMulti.id } })
    await prisma.surveyResponse.deleteMany({ where: { instance_id: instM.id } })
    await prisma.surveyDispatch.deleteMany({ where: { instance_id: instM.id } })
    await prisma.surveyInstance.delete({ where: { id: instM.id } })
    await prisma.ticketMessage.deleteMany({ where: { ticket_id: ticketM.id } })
    await prisma.ticketEvent.deleteMany({ where: { ticket_id: ticketM.id } })
    await prisma.ticket.delete({ where: { id: ticketM.id } })
    await prisma.surveyQuestionOption.deleteMany({ where: { question_id: qMulti.id } })
    await prisma.surveyQuestion.delete({ where: { id: qMulti.id } })
  })

  it('exposes per-question sample size, scale range and monthly series', async () => {
    const stats = await SurveyService.getDashboardStats({})
    const qStat = stats.questions.find(q => q.questionId === qEscalaId)!

    expect(qStat.answeredCount).toBeGreaterThanOrEqual(1)
    // Opções criadas no setup: valores '1' e '4'
    expect(qStat.scaleMin).toBe(1)
    expect(qStat.scaleMax).toBe(4)
    expect(qStat.monthlyScores).toHaveLength(12)

    // A resposta do setup é nota 4 no topo da escala 1..4 → 100 no mês corrente
    const mesAtual = qStat.monthlyScores[11]
    expect(mesAtual.month).toBe(new Date().toISOString().slice(0, 7))
    expect(mesAtual.score).toBe(100)
    expect(mesAtual.responses).toBeGreaterThanOrEqual(1)

    // emoji/cor devem chegar ao front (antes eram descartados na projeção)
    expect(qStat.distribution![0]).toHaveProperty('emoji')
    expect(qStat.distribution![0]).toHaveProperty('cor')
  })

  it('returns a 12-month trend with the current month scored on a 0..100 scale', async () => {
    const stats = await SurveyService.getDashboardStats({})

    expect(stats.monthlyTrend).toHaveLength(12)

    // Meses em ordem cronológica, sem buracos, terminando no mês corrente.
    const months = stats.monthlyTrend.map(m => m.month)
    expect([...months].sort()).toEqual(months)
    expect(months[11]).toBe(new Date().toISOString().slice(0, 7))

    // A resposta do setup (nota 4 numa escala 1..4) é o topo da escala → 100.
    const current = stats.monthlyTrend[11]
    expect(current.responses).toBeGreaterThanOrEqual(1)
    expect(current.sent).toBeGreaterThanOrEqual(1)
    expect(current.satisfactionScore).toBe(100)
  })

  it('correctly reports unanswered surveys in unansweredList and allows resending survey emails', async () => {
    // Create a new unanswered ticket/instance
    const ticketUnanswered = await prisma.ticket.create({
      data: {
        id: `DT-UN-${SUFFIX}`,
        display_number: `INC-DT-UN-${SUFFIX}`,
        title: `Dashboard Ticket Unanswered ${SUFFIX}`,
        description: 'd',
        user_id: userId,
        org_id: orgId,
        queue: 'geral',
        status: 'resolved',
        resolved_at: new Date(),
        sla_deadline: new Date(Date.now() + 86400000)
      }
    })

    const instanceUnanswered = await prisma.surveyInstance.create({
      data: {
        ticket_id: ticketUnanswered.id,
        template_id: templateId,
        link_token: `dashtoken-un-${SUFFIX}`,
        status: 'enviada'
      }
    })

    // Fetch stats
    const stats = await SurveyService.getDashboardStats({ orgId })
    const entry = stats.unansweredList.find(u => u.ticketId === ticketUnanswered.id)
    expect(entry).toBeTruthy()
    expect(entry!.clientName).toBe(`DashUser ${SUFFIX}`)
    expect(entry!.clientEmail).toBe(`dash-${SUFFIX}@t.com`)
    expect(entry!.status).toBe('enviada')

    // Test resending
    const res = await SurveyService.resendSurveyEmail(ticketUnanswered.id, userId)
    expect(res.message).toContain('sucesso')

    // Verify a new dispatch was created
    const updatedInstance = await prisma.surveyInstance.findUnique({
      where: { id: instanceUnanswered.id },
      include: { dispatches: true }
    })
    expect(updatedInstance!.dispatches.length).toBeGreaterThan(0)

    // Cleanup
    await prisma.surveyDispatch.deleteMany({ where: { instance_id: instanceUnanswered.id } })
    await prisma.surveyInstance.delete({ where: { id: instanceUnanswered.id } })
    await prisma.ticket.delete({ where: { id: ticketUnanswered.id } })
  })
})
