import { describe, it, expect } from 'vitest'
import { runIntake, MAX_ASKS, type ChecklistItem } from './intake'
import type { ChatFn } from '../../core/llm'
import type { Evidence } from '../../core/ticketEvidence'

const ev = (fileNames: string[] = []): Evidence => ({
  text: 'Título: Impressora\nDescrição: não imprime', userCategory: null, fileNames, images: [],
})
const item = (key: string, extra: Partial<ChecklistItem> = {}): ChecklistItem => ({
  key, label: key, criterion: `critério ${key}`, question: `pergunta ${key}?`, kind: 'text', required: true, ...extra,
})

/**
 * Responde a letra da opção cujo rótulo contém o alvo escolhido por `pick(prompt)`,
 * com probabilidade p. Registra os prompts recebidos.
 */
function fakeChat(pick: (prompt: string) => string, p = 0.95, seen: string[] = []): ChatFn {
  return async messages => {
    const last = messages[messages.length - 1].content as string
    seen.push(last)
    const target = pick(last)
    const line = last.split('\n').find(l => /^[A-Z]\) /.test(l) && l.includes(target))
    const letter = line ? line[0] : 'A'
    const other = letter === 'A' ? 'B' : 'A'
    return {
      text: letter,
      firstTokenTop: [{ token: letter, logprob: Math.log(p) }, { token: other, logprob: Math.log(1 - p) }],
      inputTokens: 100, outputTokens: 1,
    }
  }
}
const USER = 'Relato de problema'
const AUTO = 'Comunicado automático'
const SIM = 'Sim, o chamado'
const NAO = 'Não, o chamado'
// Portão = relato do usuário; itens cujo critério cita uma key de `absent` → ausente.
const answers = (absent: string[]) => (prompt: string) =>
  prompt.startsWith('O que é este chamado?') ? USER : absent.some(k => prompt.includes(`critério ${k}`)) ? NAO : SIM

describe('runIntake', () => {
  it('portão confiante em comunicado automático: pula sem avaliar o checklist', async () => {
    const seen: string[] = []
    const r = await runIntake(ev(), [item('o_que')], { chat: fakeChat(() => AUTO, 0.95, seen) })
    expect(r).toMatchObject({ gate: 'automatic', skipped: true, missing: [], asks: [] })
    expect(r.questions.map(q => q.key)).toEqual(['gate'])
    expect(seen).toHaveLength(2) // 2 rodadas do portão
  })

  it('portão incerto em não-usuário segue para o checklist (na dúvida, avalia)', async () => {
    const r = await runIntake(ev(), [item('o_que')], {
      chat: fakeChat(p => (p.startsWith('O que é este chamado?') ? AUTO : NAO), 0.6),
    })
    expect(r.skipped).toBe(false)
    expect(r.questions.map(q => q.key)).toEqual(['gate', 'o_que'])
  })

  it('pergunta só o obrigatório ausente; imagem anexada cumpre "evidence" sem chamar a LLM', async () => {
    const seen: string[] = []
    const items = [item('o_que'), item('quem'), item('evid', { kind: 'evidence' })]
    const r = await runIntake(ev(['print.png']), items, { chat: fakeChat(answers(['o_que']), 0.95, seen) })
    expect(r.missing).toEqual(['o_que'])
    expect(r.asks).toEqual(['pergunta o_que?'])
    const evid = r.questions.find(q => q.key === 'evid')!
    expect(evid).toMatchObject({ chosen: 'present', byRule: true, confidence: 1 })
    expect(seen.some(s => s.includes('critério evid'))).toBe(false)
    expect(r.questions.map(q => q.key)).toEqual(['gate', 'o_que', 'quem', 'evid'])
    expect(r.inputTokens).toBe(100 * seen.length)
  })

  it('portão da triagem: reusado sem perguntar de novo; automático pula, relato avalia só os itens', async () => {
    const reading = (value: 'user' | 'automatic') => ({ value, probability: 0.97, margin: 0.95, roundsAgree: true, confidence: 0.97, wouldApply: true })
    const seen: string[] = []
    const auto = await runIntake(ev(), [item('o_que')], { chat: fakeChat(answers([]), 0.95, seen), gate: reading('automatic') })
    expect(auto).toMatchObject({ gate: 'automatic', skipped: true, gateFromTriage: true, asks: [] })
    expect(auto.questions[0]).toMatchObject({ key: 'gate', chosen: 'automatic', confidence: 0.97 })
    expect(seen).toHaveLength(0)
    const user = await runIntake(ev(), [item('o_que')], { chat: fakeChat(answers(['o_que']), 0.95, seen), gate: reading('user'), personalize: false })
    expect(user.missing).toEqual(['o_que'])
    expect(seen.some(s => s.startsWith('O que é este chamado?'))).toBe(false)
  })

  it('item que "não se aplica" ao chamado (pela descrição inteira) nunca é perguntado', async () => {
    const r = await runIntake(ev(), [item('o_que_pedido'), item('quem')], {
      chat: fakeChat(p => (p.startsWith('O que é este chamado?') ? USER : p.includes('critério o_que_pedido') ? 'Não se aplica' : NAO)),
      personalize: false,
    })
    expect(r.missing).toEqual(['quem'])
    expect(r.questions.find(q => q.key === 'o_que_pedido')).toMatchObject({ chosen: 'na', wouldApply: true })
  })

  it('"evidence" sem imagem é perguntado à LLM', async () => {
    const r = await runIntake(ev(['log.txt']), [item('evid', { kind: 'evidence' })], { chat: fakeChat(answers(['evid'])) })
    expect(r.missing).toEqual(['evid'])
  })

  it('ausência incerta conta como presente (não pergunta)', async () => {
    const r = await runIntake(ev(), [item('o_que')], {
      chat: fakeChat(p => (p.startsWith('O que é este chamado?') ? USER : NAO), 0.6),
    })
    expect(r.missing).toEqual([])
    expect(r.questions[1]).toMatchObject({ chosen: 'absent', wouldApply: false })
  })

  it('item não obrigatório ausente aparece nas decisões mas nunca vira pergunta', async () => {
    const r = await runIntake(ev(), [item('desde', { required: false })], { chat: fakeChat(answers(['desde'])) })
    expect(r.missing).toEqual([])
    expect(r.questions[1]).toMatchObject({ key: 'desde', chosen: 'absent', required: false })
  })

  it(`no máximo ${MAX_ASKS} perguntas, na ordem do checklist`, async () => {
    const items = ['a', 'b', 'c', 'd'].map(k => item(k))
    const r = await runIntake(ev(), items, { chat: fakeChat(answers(['a', 'b', 'c', 'd'])) })
    expect(r.missing).toEqual(['a', 'b', 'c', 'd'])
    expect(r.asks).toEqual(['pergunta a?', 'pergunta b?', 'pergunta c?'])
  })

  it('personaliza as perguntas do que falta com os termos do chamado (e conta os tokens)', async () => {
    const base = fakeChat(answers(['o_que']))
    let jsonCalls = 0
    const chat: ChatFn = async (messages, opts) => {
      if (!opts.json) return base(messages, opts)
      jsonCalls++
      return {
        text: JSON.stringify({ perguntas: { o_que: 'O que a impressora faz quando você manda imprimir?' } }),
        firstTokenTop: [], inputTokens: 300, outputTokens: 30,
      }
    }
    const r = await runIntake(ev(), [item('o_que'), item('quem')], { chat })
    expect(jsonCalls).toBe(1)
    expect(r.asks).toEqual(['O que a impressora faz quando você manda imprimir?'])
    expect(r.personalized).toBe(1)
    expect(r.outputTokens).toBeGreaterThanOrEqual(30)
  })

  it('sem nada faltando não chama a personalização', async () => {
    let jsonCalls = 0
    const base = fakeChat(answers([]))
    const r = await runIntake(ev(), [item('o_que')], { chat: async (m, o) => { if (o.json) jsonCalls++; return base(m, o) } })
    expect(r.asks).toEqual([])
    expect(jsonCalls).toBe(0)
  })
})

describe('runIntake com a configuração do Motor IA', () => {
  const three = [item('a'), item('b'), item('c')]
  it('máximo de perguntas = 1: só a primeira que falta vira pergunta', async () => {
    const r = await runIntake(ev(), three, { chat: fakeChat(answers(['a', 'b', 'c'])), maxAsks: 1, personalize: false })
    expect(r.missing).toEqual(['a', 'b', 'c'])
    expect(r.asks).toEqual(['pergunta a?'])
  })

  it('personalização desligada: usa o texto do checklist e não chama a IA para reescrever', async () => {
    const seen: string[] = []
    const r = await runIntake(ev(), [item('a')], { chat: fakeChat(answers(['a']), 0.95, seen), personalize: false })
    expect(r.asks).toEqual(['pergunta a?'])
    expect(seen.some(p => p.includes('Reescreva'))).toBe(false)
  })

  it('rigor: com 88% de certeza de ausência, equilibrado e ousado perguntam, conservador não', async () => {
    const run = (rigor: 'conservative' | 'balanced' | 'bold') =>
      runIntake(ev(), [item('a')], { chat: fakeChat(answers(['a']), 0.88), personalize: false, rigor })
    expect((await run('balanced')).missing).toEqual(['a'])
    expect((await run('bold')).missing).toEqual(['a'])
    expect((await run('conservative')).missing).toEqual([])
  })
})
