import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { SurveyService } from './survey'

const SUFFIX = `svtst-${Date.now()}`
let orgId: string, reqId: string, ticketId1: string, ticketId2: string
let templateId: string
let token1: string, token2: string
let qResolucaoId: string, qCsatId: string, qComentarioId: string, naoOptionValor: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id

  const req = await prisma.user.create({
    data: {
      name: `Req ${SUFFIX}`,
      email: `req-${SUFFIX}@t.com`,
      password: 'x',
      role: 'user',
      org_id: orgId
    }
  })
  reqId = req.id

  const template = await prisma.surveyTemplate.create({
    data: {
      nome: `Template ${SUFFIX}`,
      assunto_email: 'Assunto',
      corpo_convite_auto: 'Corpo auto',
      corpo_convite_macro: 'Corpo macro',
      ativo: true
    }
  })
  templateId = template.id

  const qResolucao = await prisma.surveyQuestion.create({
    data: {
      template_id: templateId, ordem: 1, enunciado: 'Seu chamado foi resolvido?',
      tipo: 'escolha_unica', obrigatoria: true,
      opcoes: { create: [
        { ordem: 1, rotulo: 'Sim', valor: 'sim' },
        { ordem: 2, rotulo: 'Não', valor: 'nao', acao: 'reabrir_chamado' }
      ] }
    }
  })
  qResolucaoId = qResolucao.id
  naoOptionValor = 'nao'

  const qCsat = await prisma.surveyQuestion.create({
    data: { template_id: templateId, ordem: 2, enunciado: 'Satisfação?', tipo: 'escala', estilo: 'emoji', obrigatoria: true,
      opcoes: { create: [ { ordem: 1, rotulo: 'Ruim', valor: '1', pontuacao: 1 }, { ordem: 2, rotulo: 'Ótimo', valor: '4', pontuacao: 4 } ] } }
  })
  qCsatId = qCsat.id

  const qComentario = await prisma.surveyQuestion.create({
    data: { template_id: templateId, ordem: 3, enunciado: 'Comentário', tipo: 'texto_livre', obrigatoria: false }
  })
  qComentarioId = qComentario.id

  // Ticket 1: will be answered "resolved = yes"
  const t1 = await prisma.ticket.create({
    data: {
      id: `T1-${SUFFIX}`,
      display_number: `INC-T1-${SUFFIX}`,
      title: 'T1',
      description: 'd',
      user_id: reqId,
      org_id: orgId,
      queue: 'geral',
      status: 'resolved',
      resolved_at: new Date(),
      sla_deadline: new Date(Date.now() + 86400000)
    }
  })
  ticketId1 = t1.id

  // Ticket 2: will be answered "resolved = no" (reopen)
  const t2 = await prisma.ticket.create({
    data: {
      id: `T2-${SUFFIX}`,
      display_number: `INC-T2-${SUFFIX}`,
      title: 'T2',
      description: 'd',
      user_id: reqId,
      org_id: orgId,
      queue: 'geral',
      status: 'resolved',
      resolved_at: new Date(),
      sla_deadline: new Date(Date.now() + 86400000)
    }
  })
  ticketId2 = t2.id

  // Survey Instances
  const inst1 = await prisma.surveyInstance.create({
    data: {
      ticket_id: ticketId1,
      template_id: templateId,
      link_token: `token1-${SUFFIX}`,
      status: 'enviada'
    }
  })
  token1 = inst1.link_token

  const inst2 = await prisma.surveyInstance.create({
    data: {
      ticket_id: ticketId2,
      template_id: templateId,
      link_token: `token2-${SUFFIX}`,
      status: 'enviada'
    }
  })
  token2 = inst2.link_token
})

afterAll(async () => {
  await prisma.surveyAnswer.deleteMany({ where: { question: { template_id: templateId } } }).catch(() => {})
  await prisma.surveyResponse.deleteMany({ where: { instance: { template_id: templateId } } }).catch(() => {})
  await prisma.surveyInstance.deleteMany({ where: { template_id: templateId } }).catch(() => {})
  await prisma.surveyTemplate.deleteMany({ where: { id: templateId } }).catch(() => {})
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: [ticketId1, ticketId2] } } }).catch(() => {})
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: [ticketId1, ticketId2] } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: [ticketId1, ticketId2] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: reqId } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('Survey Reopening and Submission Flow', () => {
  it('submete pesquisa resolvida com respostas dinâmicas', async () => {
    const res = await SurveyService.submitSurveyResponse(token1, {
      answers: [
        { question_id: qResolucaoId, valores_opcao: ['sim'] },
        { question_id: qCsatId, valor_numero: 4 },
        { question_id: qComentarioId, valor_texto: 'Excelente!' }
      ]
    })
    expect(res.id).toBeTruthy()
    const answers = await prisma.surveyAnswer.findMany({ where: { response_id: res.id } })
    expect(answers).toHaveLength(3)
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId1 } })
    expect(ticket?.status).toBe('resolved')
  })

  it('reabre o chamado quando opção com acao=reabrir_chamado é escolhida', async () => {
    const reason = 'Meu problema persiste, preciso de ajuda urgente!'
    const res = await SurveyService.submitSurveyResponse(token2, {
      answers: [ { question_id: qResolucaoId, valores_opcao: [naoOptionValor] } ],
      reopen_reason: reason,
      reopen_attachment: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    })
    expect(res.id).toBeTruthy()
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId2 }, include: { messages: true } })
    // Reaberto volta para a fila como "Aberto" (igual ao botão Reabrir): a mensagem do
    // próprio cliente não conta como atendimento (M7 do doc de bugs).
    expect(ticket?.status).toBe('open')
    expect(ticket?.is_reopened).toBe(true)
    expect(ticket?.messages.find(m => m.text === reason)).toBeTruthy()
  }, 30000)

  it('rejeita quando pergunta obrigatória não é respondida', async () => {
    await expect(SurveyService.submitSurveyResponse(token1, { answers: [] }))
      .rejects.toThrow()
  })
})
