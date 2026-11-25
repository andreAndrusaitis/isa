import { describe, it, expect } from 'vitest'
import { heldByGate, runTriage } from './triage'
import { buildQuestions, TYPE_OPTIONS } from './options'
import type { ChatFn } from '../../core/llm'
import type { Evidence } from '../../core/ticketEvidence'

const QUOTE = 'criar usuários nominais'
const evidence: Evidence = {
  text: `Título: Acesso\nDescrição: Preciso ${QUOTE} no firewall`,
  userCategory: null, fileNames: [], images: [],
}
const CATEGORIES = [{ value: 'c-fw', label: 'Firewall Geral' }, { value: 'c-out', label: 'Outlook Geral' }]

// Responde a letra da opção cujo rótulo contém o alvo da pergunta (0,95 de probabilidade).
function fakeChat(targets: Record<string, string>, evidencias: Record<string, unknown>): ChatFn {
  return async (messages, opts) => {
    if (opts.json) {
      return { text: JSON.stringify({ justificativa: 'Pedido de criação de acesso.', evidencias }), firstTokenTop: [], inputTokens: 50, outputTokens: 30 }
    }
    const last = messages[messages.length - 1].content as string
    const target = Object.entries(targets).find(([prefix]) => last.startsWith(prefix))?.[1]
    const line = last.split('\n').find(l => /^[A-Z]\) /.test(l) && !!target && l.includes(target))
    const letter = line ? line[0] : 'A'
    const other = letter === 'A' ? 'B' : 'A'
    return {
      text: letter,
      firstTokenTop: [{ token: letter, logprob: Math.log(0.95) }, { token: other, logprob: Math.log(0.05) }],
      inputTokens: 100, outputTokens: 1,
    }
  }
}

const TARGETS = {
  'Qual é o tipo': 'Requisição',
  'Qual categoria': 'Firewall Geral',
  'Dentro dessa categoria': 'Usuários VPN',
  'Qual é a urgência': 'Baixa',
  'Qual é o impacto': 'Baixo',
}

describe('runTriage', () => {
  it('decide cada pergunta, valida evidências e calcula a prioridade pela matriz', async () => {
    const asked: string[] = []
    const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), {
      chat: fakeChat(TARGETS, {
        type: { trecho: QUOTE, fonte: 'texto' },
        category: { trecho: 'no firewall', fonte: 'texto' },
        subcategory: { trecho: 'no firewall', fonte: 'texto' },
      }),
      subcategoryOptions: async cat => { asked.push(cat); return [{ value: 's-vpn', label: 'Usuários VPN' }] },
    })

    const by = Object.fromEntries(r.questions.map(q => [q.key, q]))
    expect(by.type.chosen).toBe('request')
    expect(by.type.confidence).toBeCloseTo(0.95)
    expect(by.type.roundsAgree).toBe(true)
    expect(by.type.evidenceValid).toBe(true)
    expect(by.type.wouldApply).toBe(true)

    expect(by.category.chosen).toBe('c-fw')
    expect(asked).toEqual(['c-fw'])
    // subcategoria tem 1 opção só: decidida sem chamar o modelo, evidência dispensada
    expect(by.subcategory.chosen).toBe('s-vpn')
    expect(by.subcategory.confidence).toBeCloseTo(0.95)

    // urgência/impacto sem evidência citada → confiança 0 → prioridade não seria aplicada
    expect(by.urgency.chosen).toBe('low')
    expect(by.urgency.evidenceValid).toBe(false)
    expect(r.priority).toEqual({ value: 'low', confidence: 0, wouldApply: false })

    expect(r.justification).toBe('Pedido de criação de acesso.')
    expect(r.inputTokens).toBeGreaterThan(0)
  })

  it('categoria citada só pelo nome da opção vale pela evidência da subcategoria', async () => {
    const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), {
      chat: fakeChat(TARGETS, {
        category: { trecho: 'Firewall Geral', fonte: 'texto' },   // rótulo, não está no texto
        subcategory: { trecho: 'no firewall', fonte: 'texto' },
      }),
      subcategoryOptions: async () => [{ value: 's-vpn', label: 'Usuários VPN' }],
    })
    const category = r.questions.find(q => q.key === 'category')!
    expect(category.evidenceValid).toBe(true)
    expect(category.evidence).toBe('no firewall')
    expect(category.confidence).toBeCloseTo(0.95)
  })

  it('categoria dividida entre as rodadas é deduzida pela única subcategoria unânime', async () => {
    const lp = Math.log
    const chat: ChatFn = async (messages, opts) => {
      if (opts.json) {
        return { text: JSON.stringify({ justificativa: 'ok', evidencias: { subcategory: { trecho: 'no firewall', fonte: 'texto' } } }), firstTokenTop: [], inputTokens: 1, outputTokens: 1 }
      }
      const last = messages[messages.length - 1].content as string
      const lines = last.split('\n').filter(l => /^[A-Z]\) /.test(l))
      if (last.startsWith('Qual categoria')) {
        // A sempre com 55%, B com 45%: como a 2ª rodada inverte a ordem, as rodadas divergem.
        return { text: 'A', firstTokenTop: [{ token: 'A', logprob: lp(0.55) }, { token: 'B', logprob: lp(0.45) }], inputTokens: 1, outputTokens: 1 }
      }
      const want = last.startsWith('Dentro dessa categoria')
        ? (lines.find(l => l.includes('Usuários VPN')) ?? lines.find(l => l.includes('Nenhuma')))!
        : lines[0]
      const other = want[0] === 'A' ? 'B' : 'A'
      return { text: want[0], firstTokenTop: [{ token: want[0], logprob: lp(0.95) }, { token: other, logprob: lp(0.05) }], inputTokens: 1, outputTokens: 1 }
    }
    const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), {
      chat,
      subcategoryOptions: async cat => cat === 'c-fw'
        ? [{ value: 's-vpn', label: 'Usuários VPN' }]
        : [{ value: 's-cx', label: 'Caixa compartilhada' }],
    })
    const category = r.questions.find(q => q.key === 'category')!
    expect(category.roundsAgree).toBe(false)
    expect(category).toMatchObject({ chosen: 'c-fw', derivedFromSubcategory: true, evidenceValid: true })
    expect(category.confidence).toBeCloseTo(0.95)
    expect(category.wouldApply).toBe(true)
    expect(r.questions.find(q => q.key === 'subcategory')!.chosen).toBe('s-vpn')
  })

  it('categoria unânime mas abaixo do limiar também é confirmada pela subcategoria', async () => {
    const lp = Math.log
    const chat: ChatFn = async (messages, opts) => {
      if (opts.json) {
        return { text: JSON.stringify({ justificativa: 'ok', evidencias: { subcategory: { trecho: 'no firewall', fonte: 'texto' } } }), firstTokenTop: [], inputTokens: 1, outputTokens: 1 }
      }
      const last = messages[messages.length - 1].content as string
      const lines = last.split('\n').filter(l => /^[A-Z]\) /.test(l))
      const pick = (label: string) => lines.find(l => l.includes(label))!
      const want = last.startsWith('Qual categoria') ? pick('Outlook Geral')
        : last.startsWith('Dentro dessa categoria') ? (lines.find(l => l.includes('Caixa compartilhada')) ?? pick('Nenhuma'))
        : lines[0]
      const other = want[0] === 'A' ? 'B' : 'A'
      const p = last.startsWith('Qual categoria') ? 0.6 : 0.95
      return { text: want[0], firstTokenTop: [{ token: want[0], logprob: lp(p) }, { token: other, logprob: lp(1 - p) }], inputTokens: 1, outputTokens: 1 }
    }
    const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), {
      chat,
      subcategoryOptions: async cat => cat === 'c-out'
        ? [{ value: 's-cx', label: 'Caixa compartilhada' }]
        : [{ value: 's-vpn', label: 'Usuários VPN' }],
    })
    const category = r.questions.find(q => q.key === 'category')!
    expect(category.roundsAgree).toBe(true)
    expect(category).toMatchObject({ chosen: 'c-out', derivedFromSubcategory: true, wouldApply: true })
    expect(r.questions.find(q => q.key === 'subcategory')!.chosen).toBe('s-cx')
  })

  it('categoria firme sem subcategoria que encaixe tenta a 2ª categoria mais provável', async () => {
    const lp = Math.log
    const chat: ChatFn = async (messages, opts) => {
      if (opts.json) {
        return { text: JSON.stringify({ justificativa: 'ok', evidencias: { subcategory: { trecho: 'no firewall', fonte: 'texto' } } }), firstTokenTop: [], inputTokens: 1, outputTokens: 1 }
      }
      const last = messages[messages.length - 1].content as string
      const lines = last.split('\n').filter(l => /^[A-Z]\) /.test(l))
      const pick = (label: string) => lines.find(l => l.includes(label))!
      // Categoria: Firewall com 99% (firme), Outlook em 2º. Subcategoria: só "Caixa compartilhada" encaixa.
      const want = last.startsWith('Qual categoria') ? pick('Firewall Geral')
        : last.startsWith('Dentro dessa categoria') ? (lines.find(l => l.includes('Caixa compartilhada')) ?? pick('Nenhuma'))
        : lines[0]
      const second = last.startsWith('Qual categoria') ? pick('Outlook Geral')[0] : (want[0] === 'A' ? 'B' : 'A')
      return { text: want[0], firstTokenTop: [{ token: want[0], logprob: lp(0.99) }, { token: second, logprob: lp(0.01) }], inputTokens: 1, outputTokens: 1 }
    }
    const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), {
      chat,
      subcategoryOptions: async cat => cat === 'c-out'
        ? [{ value: 's-cx', label: 'Caixa compartilhada' }]
        : [{ value: 's-vpn', label: 'Usuários VPN' }],
    })
    const category = r.questions.find(q => q.key === 'category')!
    expect(category).toMatchObject({ chosen: 'c-out', derivedFromSubcategory: true, wouldApply: true })
    expect(r.questions.find(q => q.key === 'subcategory')!.chosen).toBe('s-cx')
  })

  it('sem subcategoryOptions a subcategoria não é perguntada', async () => {
    const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), { chat: fakeChat(TARGETS, {}) })
    expect(r.questions.map(q => q.key)).toEqual(['type', 'category', 'urgency', 'impact'])
  })

  it('com exemplos, o bloco RAG entra só em tipo/urgência/impacto e a versão vira triage-v4-rag', async () => {
    const seen: Record<string, boolean> = {}
    const base = fakeChat(TARGETS, {})
    const spy: ChatFn = async (messages, opts) => {
      const last = messages[messages.length - 1].content
      if (typeof last === 'string' && !opts.json) {
        const hasBlock = messages.some(m => typeof m.content === 'string' && m.content.startsWith('Chamados parecidos'))
        const prompt = last.split('\n')[0]
        seen[prompt] = (seen[prompt] ?? false) || hasBlock
      }
      return base(messages, opts)
    }
    const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), {
      chat: spy,
      examples: async () => [{ id: 'e1', text: 'Criar usuário VPN', labels: { type: 'request', urgency: 'low', impact: 'low' }, score: 0.7 }],
    })
    expect(seen).toEqual({
      'Qual é o tipo deste chamado?': true,
      'Qual categoria melhor descreve o assunto deste chamado?': false,
      'Qual é a urgência deste chamado (quanto tempo dá para esperar)?': true,
      'Qual é o impacto deste chamado (quantos são afetados)?': true,
      'O que é este chamado?': false, // portão: sem exemplos
    })
    expect(r).toMatchObject({ promptVersion: 'triage-v4-rag', ragExamples: 1 })
  })

  it('sem exemplos (ou RAG falhando) a triagem segue como triage-v4', async () => {
    const qs = buildQuestions(TYPE_OPTIONS, CATEGORIES)
    expect(await runTriage(evidence, qs, { chat: fakeChat(TARGETS, {}) })).toMatchObject({ promptVersion: 'triage-v4', ragExamples: 0 })
    const failing = await runTriage(evidence, qs, { chat: fakeChat(TARGETS, {}), examples: async () => { throw new Error('embeddings 500') } })
    expect(failing).toMatchObject({ promptVersion: 'triage-v4', ragExamples: 0 })
    expect(failing.questions.find(q => q.key === 'type')?.chosen).toBe('request')
  })

  it('lê o portão uma vez e grava no resultado (teste confiante = nada a aplicar)', async () => {
    const r = await runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), {
      chat: fakeChat({ ...TARGETS, 'O que é este chamado?': 'Teste do sistema' }, {}),
    })
    expect(r.gate).toMatchObject({ value: 'test', wouldApply: true })
    expect(r.gate!.confidence).toBeCloseTo(0.95)
    expect(heldByGate(r)).toBe('test')
    expect(heldByGate({ gate: { ...r.gate!, value: 'automatic' } })).toBeNull()
    expect(heldByGate({ gate: { ...r.gate!, wouldApply: false } })).toBeNull()
  })

  it('propaga falha do LLM para o chamador decidir', async () => {
    const failing: ChatFn = async () => { throw new Error('LLM 500') }
    await expect(runTriage(evidence, buildQuestions(TYPE_OPTIONS, CATEGORIES), { chat: failing })).rejects.toThrow('LLM 500')
  })
})
