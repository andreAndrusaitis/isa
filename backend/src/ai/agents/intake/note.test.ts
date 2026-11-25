import { describe, it, expect } from 'vitest'
import { publicMessage, internalNote, firstName } from './note'
import type { IntakeDecision, IntakeResult } from './intake'

const d = (key: string, label: string, chosen: string, wouldApply: boolean, extra: Partial<IntakeDecision> = {}): IntakeDecision => ({
  key, label, chosen, chosenLabel: chosen, probability: 0.9, margin: 0.8, roundsAgree: true, confidence: wouldApply ? 0.9 : 0.5, wouldApply, ...extra,
})
const base: IntakeResult = {
  questions: [d('gate', 'Portão', 'user', true)], gate: 'user', skipped: false,
  missing: [], asks: [], inputTokens: 0, outputTokens: 0, promptVersion: 'intake-v1',
}

describe('textos do intake', () => {
  it('firstName pega o primeiro nome e corrige nome todo em maiúsculas ou minúsculas', () => {
    expect(firstName('  Maria   da Silva ')).toBe('Maria')
    expect(firstName('JOÃO PEDRO')).toBe('João')
    expect(firstName('ana')).toBe('Ana')
    expect(firstName('McArthur Lima')).toBe('McArthur')
  })

  // 14h e 9h em Brasília (UTC-3).
  const tarde = new Date('2026-10-06T17:00:00Z')
  const manha = new Date('2026-10-06T12:00:00Z')
  const noite = new Date('2026-10-06T23:30:00Z')
  const g = { name: 'Maria', displayNumber: 'INC-1375', title: 'Impressora não funciona' }

  it('mensagem pública cumprimenta pelo nome e pelo horário, cita o chamado e lista as perguntas', () => {
    const t = publicMessage({ ...g, now: tarde }, ['O que a HP faz ao imprimir?', 'Pode mandar uma foto do visor?'])
    expect(t).toBe([
      'Boa tarde, Maria! Recebemos seu chamado INC-1375 — "Impressora não funciona".',
      'Para agilizar o atendimento, você pode nos contar:',
      '• O que a HP faz ao imprimir?',
      '• Pode mandar uma foto do visor?',
      '',
      'É só responder aqui no chamado. Se preferir, o atendimento segue normalmente.',
      '— Skadi',
    ].join('\n'))
  })

  it('saudação segue o horário de Brasília e o texto se ajusta a uma pergunta só', () => {
    expect(publicMessage({ ...g, now: manha }, ['Qual?']).split('\n').slice(0, 2)).toEqual([
      'Bom dia, Maria! Recebemos seu chamado INC-1375 — "Impressora não funciona".',
      'Para agilizar o atendimento, só precisamos de mais uma informação:',
    ])
    expect(publicMessage({ ...g, now: noite }, ['Qual?'])).toMatch(/^Boa noite, Maria!/)
  })

  it('título longo é encurtado', () => {
    const t = publicMessage({ ...g, title: 'x'.repeat(120), now: tarde }, ['Qual?'])
    expect(t.split('\n')[0]).toBe(`Boa tarde, Maria! Recebemos seu chamado INC-1375 — "${'x'.repeat(80)}…".`)
  })

  it('nota de sombra: o que faltaria e o que seria perguntado, item a item', () => {
    const r: IntakeResult = {
      ...base,
      questions: [
        base.questions[0],
        d('o_que', 'O que acontece', 'absent', true),
        d('quem', 'Quem é afetado', 'present', true),
        d('evid', 'Evidência', 'present', true, { byRule: true, confidence: 1 }),
        d('desde', 'Desde quando', 'absent', false),
      ],
      missing: ['o_que'], asks: ['O que exatamente acontece?'],
    }
    const t = internalNote(r, 'shadow')
    expect(t).toContain('**Completude IA** — faltaria: O que acontece (sombra, nada enviado)')
    expect(t).toContain('Perguntas que seriam enviadas:\n• O que exatamente acontece?')
    expect(t).toContain('- O que acontece: ausente (90%)')
    expect(t).toContain('- Quem é afetado: presente (90%)')
    expect(t).toContain('- Evidência: presente (imagem anexada)')
    expect(t).toContain('- Desde quando: incerto (ausente 90%), tratado como presente')
  })

  it('item incerto com rodadas divergentes avisa', () => {
    const r = { ...base, questions: [base.questions[0], d('o_que', 'O que acontece', 'absent', false, { roundsAgree: false, probability: 0.6 })] }
    expect(internalNote(r, 'shadow')).toContain('- O que acontece: incerto (ausente 60%, rodadas divergiram), tratado como presente')
  })

  it('mensagem pública sem nome cumprimenta sem vírgula', () => {
    expect(publicMessage({ ...g, name: '', now: tarde }, ['Qual?']).split('\n')[0]).toBe('Boa tarde! Recebemos seu chamado INC-1375 — "Impressora não funciona".')
  })

  it('nota de apply diz que as perguntas foram enviadas', () => {
    const r = { ...base, questions: [base.questions[0], d('o_que', 'O que acontece', 'absent', true)], missing: ['o_que'], asks: ['Qual?'] }
    expect(internalNote(r, 'apply')).toContain('— faltam: O que acontece · perguntas enviadas ao solicitante\nPerguntas:\n• Qual?')
  })

  it('nota de chamado completo', () => {
    const r = { ...base, questions: [base.questions[0], d('o_que', 'O que acontece', 'present', true)] }
    expect(internalNote(r, 'shadow').split('\n')[0]).toBe('**Completude IA** — informações mínimas presentes')
  })

  it('item fora do escopo do chamado aparece como "não se aplica"', () => {
    const r = { ...base, questions: [base.questions[0], d('o_que_pedido', 'O que é pedido', 'na', true)] }
    expect(internalNote(r, 'shadow')).toContain('- O que é pedido: não se aplica (90%)')
  })

  it('nota de portão: não avaliado e o motivo', () => {
    const r = { ...base, gate: 'automatic' as const, skipped: true, questions: [d('gate', 'Portão', 'automatic', true, { confidence: 0.93 })] }
    expect(internalNote(r, 'shadow')).toBe('**Completude IA** — não avaliado: parece comunicado automático ou relatório (93%)')
  })
})
