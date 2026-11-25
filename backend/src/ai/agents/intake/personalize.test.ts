import { describe, it, expect } from 'vitest'
import { personalizeAsks, validAsk } from './personalize'
import type { ChecklistItem } from './intake'
import type { ChatFn } from '../../core/llm'
import type { Evidence } from '../../core/ticketEvidence'

const ev: Evidence = { text: 'Título: Impressora não funciona\nDescrição: a HP do 2º andar não imprime', userCategory: null, fileNames: [], images: [] }
const item = (key: string): ChecklistItem => ({
  key, label: key, criterion: `critério ${key}`, question: `Pergunta fixa ${key}?`, kind: 'text', required: true,
})
const reply = (text: string, seen: string[] = []): ChatFn => async (messages, opts) => {
  seen.push(String(messages[messages.length - 1].content))
  expect(opts.json).toBe(true)
  return { text, firstTokenTop: [], inputTokens: 300, outputTokens: 40 }
}

describe('personalizeAsks', () => {
  it('usa a pergunta reescrita com os termos do solicitante, na ordem do checklist', async () => {
    const seen: string[] = []
    const r = await personalizeAsks(ev, [item('o_que'), item('evid')], reply(JSON.stringify({
      perguntas: {
        evid: 'Pode mandar uma foto do visor da HP do 2º andar mostrando a mensagem?',
        o_que: 'O que a HP do 2º andar faz quando você manda imprimir: dá erro, fica parada ou some da lista?',
      },
    }), seen))
    expect(r).toEqual({
      asks: [
        'O que a HP do 2º andar faz quando você manda imprimir: dá erro, fica parada ou some da lista?',
        'Pode mandar uma foto do visor da HP do 2º andar mostrando a mensagem?',
      ],
      personalized: 2,
    })
    // O modelo recebe as perguntas fixas e o critério de cada item, nunca o nome da pessoa.
    expect(seen[0]).toContain('Pergunta fixa o_que?')
    expect(seen[0]).toContain('critério evid')
    expect(seen[0]).toMatch(/linguagem neutra/)
  })

  it('pergunta inválida ou ausente cai no texto fixo daquele item', async () => {
    const r = await personalizeAsks(ev, [item('a'), item('b'), item('c')], reply(JSON.stringify({
      perguntas: { a: 'Me passa sua senha do Windows para eu testar?', b: 'sem interrogação' },
    })))
    expect(r).toEqual({ asks: ['Pergunta fixa a?', 'Pergunta fixa b?', 'Pergunta fixa c?'], personalized: 0 })
  })

  it('falha da LLM ou JSON quebrado não derruba: todas as perguntas ficam fixas', async () => {
    const boom: ChatFn = async () => { throw new Error('LLM 429') }
    expect(await personalizeAsks(ev, [item('a')], boom)).toEqual({ asks: ['Pergunta fixa a?'], personalized: 0 })
    expect(await personalizeAsks(ev, [item('a')], reply('não é json'))).toEqual({ asks: ['Pergunta fixa a?'], personalized: 0 })
  })
})

describe('validAsk', () => {
  it.each([
    ['Qual mensagem aparece no visor da impressora?', true],
    ['Curta?', false],
    ['Sem ponto de interrogação no final', false],
    ['Pode acessar https://site.com e me dizer o que aparece?', false],
    ['Qual o seu e-mail fulano@empresa.com?', false],
    ['Pode me informar sua senha de rede?', false],
    ['Primeira linha?\nSegunda linha?', false],
    // Marcadores do mascaramento (LGPD) nunca chegam ao solicitante.
    ['O que acontece ao acessar o e-mail [EMAIL]?', false],
    ['O telefone [TELEFONE] ainda funciona para contato?', false],
    [`${'x'.repeat(200)}?`, false],
    [42, false],
  ])('%s → %s', (q, ok) => {
    expect(validAsk(q)).toBe(ok)
  })
})
