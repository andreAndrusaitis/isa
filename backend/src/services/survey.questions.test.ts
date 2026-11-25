import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { SurveyService } from './survey'

const SUFFIX = `qtst-${Date.now()}`
let templateId: string

beforeAll(async () => {
  const t = await prisma.surveyTemplate.create({
    data: { nome: `Tpl ${SUFFIX}`, assunto_email: 'a', corpo_convite_auto: 'b', corpo_convite_macro: 'c', ativo: false }
  })
  templateId = t.id
})

afterAll(async () => {
  await prisma.surveyTemplate.deleteMany({ where: { id: templateId } }).catch(() => {})
  await prisma.$disconnect()
})

describe('Survey question CRUD', () => {
  let qId = ''

  it('adiciona pergunta de escala com opções', async () => {
    const q = await SurveyService.addQuestion(templateId, {
      enunciado: 'Satisfação geral?',
      tipo: 'escala',
      estilo: 'emoji',
      obrigatoria: true,
      opcoes: [
        { rotulo: 'Muito ruim', valor: '1', emoji: '😠', pontuacao: 1 },
        { rotulo: 'Ruim', valor: '2', emoji: '🙁', pontuacao: 2 },
        { rotulo: 'Bom', valor: '3', emoji: '🙂', pontuacao: 3 },
        { rotulo: 'Muito bom', valor: '4', emoji: '😄', pontuacao: 4 }
      ]
    })
    qId = q.id
    expect(q.opcoes).toHaveLength(4)
    expect(q.ordem).toBe(1)
    expect(q.opcoes[0].rotulo).toBe('Muito ruim')
  })

  it('atualiza enunciado e substitui opções', async () => {
    const q = await SurveyService.updateQuestion(qId, {
      enunciado: 'Como você avalia?',
      opcoes: [
        { rotulo: 'Não', valor: 'nao', acao: 'reabrir_chamado' },
        { rotulo: 'Sim', valor: 'sim' }
      ]
    })
    expect(q.enunciado).toBe('Como você avalia?')
    expect(q.opcoes).toHaveLength(2)
    expect(q.opcoes.find(o => o.valor === 'nao')?.acao).toBe('reabrir_chamado')
  })

  it('reordena perguntas', async () => {
    const q2 = await SurveyService.addQuestion(templateId, { enunciado: 'Comentário', tipo: 'texto_livre', obrigatoria: false })
    await SurveyService.reorderQuestions(templateId, [q2.id, qId])
    const tpl = await SurveyService.getTemplate(templateId)
    expect(tpl.questions[0].id).toBe(q2.id)
    expect(tpl.questions[1].id).toBe(qId)
  })

  it('deleta pergunta sem respostas de verdade', async () => {
    const res = await SurveyService.deleteQuestion(qId)
    expect(res.arquivada).toBe(false)
    const tpl = await SurveyService.getTemplate(templateId)
    expect(tpl.questions.find(q => q.id === qId)).toBeUndefined()
  })

  it('arquiva (nao apaga) pergunta ja respondida, preservando o histórico', async () => {
    const q = await SurveyService.addQuestion(templateId, {
      enunciado: 'Ja respondida', tipo: 'nps', obrigatoria: false
    })

    // Monta uma resposta real ligada a essa pergunta.
    const user = await prisma.user.create({
      data: { name: `U ${SUFFIX}`, email: `${SUFFIX}@test.local`, password: 'x', role: 'user' }
    })
    const ticket = await prisma.ticket.create({
      data: {
        id: `tk-${SUFFIX}`,
        title: 'Ticket de teste',
        display_number: `T-${SUFFIX}`,
        user_id: user.id,
        sla_deadline: new Date()
      }
    })

    const inst = await prisma.surveyInstance.create({
      data: { ticket_id: ticket.id, template_id: templateId, link_token: `tok-${SUFFIX}`, status: 'respondida' }
    })
    const resp = await prisma.surveyResponse.create({
      data: { instance_id: inst.id, respondido_em: new Date() }
    })
    await prisma.surveyAnswer.create({
      data: { response_id: resp.id, question_id: q.id, valor_numero: 9 }
    })

    const res = await SurveyService.deleteQuestion(q.id)
    expect(res.arquivada).toBe(true)
    expect(res.respostas).toBe(1)

    // A pergunta continua existindo, porém inativa — e a resposta segue no banco.
    const ainda = await prisma.surveyQuestion.findUnique({ where: { id: q.id } })
    expect(ainda?.ativa).toBe(false)
    expect(await prisma.surveyAnswer.count({ where: { question_id: q.id } })).toBe(1)

    await prisma.surveyAnswer.deleteMany({ where: { question_id: q.id } })
    await prisma.surveyResponse.deleteMany({ where: { id: resp.id } })
    await prisma.surveyInstance.deleteMany({ where: { id: inst.id } })
    await prisma.ticket.deleteMany({ where: { id: ticket.id } })
    await prisma.user.deleteMany({ where: { id: user.id } })
  })
})
