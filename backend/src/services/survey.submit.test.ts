import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => {
  const tx = {
    surveyResponse: { create: vi.fn() },
    surveyAnswer: { createMany: vi.fn() },
    surveyInstance: { update: vi.fn() },
  }
  return {
    tx,
    surveyInstance: { findUnique: vi.fn() },
    ticket: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
})
vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('./audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('./email/mailer', () => ({ sendSurveyEmail: vi.fn() }))
vi.mock('./templateVariables', () => ({ buildTicketVars: vi.fn(), renderTemplate: vi.fn() }))
const ticketsMock = vi.hoisted(() => ({ reopenTicket: vi.fn(), addMessage: vi.fn() }))
vi.mock('./tickets', () => ({ TicketService: ticketsMock }))

import { SurveyService } from './survey'

const q = (id: string, tipo: string, extra: Record<string, unknown> = {}) => ({ id, tipo, estilo: null, ativa: true, obrigatoria: false, enunciado: id, opcoes: [] as unknown[], ...extra })
const opt = (valor: string, pontuacao: number | null = null, acao: string | null = null) => ({ valor, pontuacao, acao })

const questions = [
  q('resolucao', 'escolha_unica', { opcoes: [opt('sim'), opt('nao', null, 'reabrir_chamado')] }),
  q('csat', 'escala', { estilo: 'emoji', opcoes: [opt('1', 1), opt('2', 2), opt('3', 3), opt('4', 4), opt('5', 5)] }),
  q('rotulos', 'escala', { estilo: 'pill', opcoes: [opt('ruim'), opt('bom')] }),
  q('nps', 'nps'),
  q('canais', 'escolha_multipla', { opcoes: [opt('a'), opt('b')] }),
  q('comentario', 'texto_livre'),
  q('escala_sem_estilo', 'escala', { opcoes: [opt('1', 1), opt('2', 2)] }),
  q('arquivada', 'texto_livre', { ativa: false }),
]

const submit = (answers: unknown[], extra: Record<string, unknown> = {}) =>
  SurveyService.submitSurveyResponse('tok', { answers: answers as never, ...extra })
const rows = () => prismaMock.tx.surveyAnswer.createMany.mock.calls[0]?.[0]?.data ?? []

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.surveyInstance.findUnique.mockResolvedValue({ id: 'i1', ticket_id: 't1', status: 'enviada', template: { questions } })
  prismaMock.tx.surveyResponse.create.mockResolvedValue({ id: 'r1' })
  prismaMock.ticket.findUnique.mockResolvedValue({ id: 't1', user_id: 'u1', status: 'resolved' })
})

describe('submitSurveyResponse: respostas conferidas contra o template', () => {
  it('aceita o que o formulário envia', async () => {
    await submit([
      { question_id: 'resolucao', valores_opcao: ['sim'] },
      { question_id: 'csat', valor_numero: 5 },
      { question_id: 'rotulos', valor_numero: 2 },
      { question_id: 'nps', valor_numero: 0 },
      { question_id: 'canais', valores_opcao: ['a', 'b'] },
      { question_id: 'comentario', valor_texto: 'Ótimo atendimento' },
      { question_id: 'escala_sem_estilo', valor_texto: 'caixa de texto do formulário' },
    ])
    expect(rows()).toHaveLength(7)
    expect(rows().find((r: any) => r.question_id === 'comentario').valor_texto).toBe('Ótimo atendimento')
    expect(rows().find((r: any) => r.question_id === 'escala_sem_estilo').valor_texto).toBe('caixa de texto do formulário')
  })

  it('recusa a mesma pergunta repetida (um voto por resposta)', async () => {
    const dup = Array.from({ length: 50 }, () => ({ question_id: 'nps', valor_numero: 10 }))
    await expect(submit(dup)).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['csat', 1000000], ['csat', 0], ['csat', 6], ['csat', 4.5],
    ['nps', 11], ['nps', -1], ['rotulos', 3],
  ])('recusa nota fora da escala: %s = %s', async (question_id, valor_numero) => {
    await expect(submit([{ question_id, valor_numero }])).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('recusa opção inexistente, repetida ou duas em escolha única', async () => {
    for (const a of [
      { question_id: 'resolucao', valores_opcao: ['<img src=x onerror=alert(1)>'] },
      { question_id: 'canais', valores_opcao: ['a', 'a'] },
      { question_id: 'resolucao', valores_opcao: ['sim', 'nao'] },
      { question_id: 'comentario', valores_opcao: ['qualquer'] },
    ]) await expect(submit([a]), JSON.stringify(a)).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('recusa pergunta de outra pesquisa', async () => {
    await expect(submit([{ question_id: 'outra', valor_texto: 'x' }])).rejects.toMatchObject({ statusCode: 400 })
  })

  it('recusa texto maior que o limite do formulário', async () => {
    await expect(submit([{ question_id: 'comentario', valor_texto: 'x'.repeat(1001) }])).rejects.toMatchObject({ statusCode: 400 })
    await expect(submit([{ question_id: 'comentario', valor_texto: 'x'.repeat(1000) }])).resolves.toBeTruthy()
  })

  it('campo que a pergunta não usa não é gravado (texto em pergunta de nota não chega ao relatório)', async () => {
    await submit([
      { question_id: 'csat', valor_numero: 4, valor_texto: '<img src=x onerror=alert(1)>' },
      { question_id: 'comentario', valor_texto: 'ok', valor_numero: 999 },
    ])
    expect(rows()).toEqual([
      { question_id: 'csat', valor_texto: null, valor_numero: 4, valores_opcao: [], response_id: 'r1' },
      { question_id: 'comentario', valor_texto: 'ok', valor_numero: null, valores_opcao: [], response_id: 'r1' },
    ])
  })

  it('resposta sem conteúdo aproveitável não vira linha e pergunta desativada não conta', async () => {
    await submit([
      { question_id: 'resolucao', valor_texto: 'só texto' },
      { question_id: 'comentario', valor_texto: '   ' },
      { question_id: 'arquivada', valor_texto: 'abri o link antes de arquivarem' },
      { question_id: 'csat', valor_numero: 3 },
    ])
    expect(rows().map((r: any) => r.question_id)).toEqual(['csat'])
  })
})

describe('submitSurveyResponse: anexo da reabertura', () => {
  const reopen = (reopen_attachment?: string) =>
    submit([{ question_id: 'resolucao', valores_opcao: ['nao'] }], { reopen_reason: 'Continua com problema', reopen_attachment })

  it('aceita o data URI que o formulário envia', async () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo='
    await reopen(uri)
    expect(ticketsMock.addMessage).toHaveBeenCalledWith('t1', 'u1', 'Continua com problema', 'user', uri)
  })

  it('reabre sem anexo', async () => {
    await reopen()
    expect(ticketsMock.reopenTicket).toHaveBeenCalled()
  })

  it.each(['tickets/2026/11/de-outro-chamado.pdf', 'https://attacker.example/a.png', 'javascript:alert(1)'])('recusa %s sem gravar nada', async value => {
    await expect(reopen(value)).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(ticketsMock.addMessage).not.toHaveBeenCalled()
  })
})
