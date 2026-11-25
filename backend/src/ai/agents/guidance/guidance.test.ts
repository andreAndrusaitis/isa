import { describe, it, expect } from 'vitest'
import type { ChatFn, ChatMessage } from '../../core/llm'
import type { Evidence } from '../../core/ticketEvidence'
import { toPtBr, parseLearnResponse } from '../../core/learn'
import { parseCard } from '../resolution/distill'
import { runGuidance, unsafeForRequester, type CardHit } from './guidance'
import { checkDuplicate } from './duplicate'
import { guidanceMessage, duplicateMessage, internalNote } from './note'

const evidence: Evidence = { text: 'Título: Outlook não recebe e-mails\nDescrição: desde ontem nada chega', userCategory: null, fileNames: [], images: [] }
const lastText = (m: ChatMessage[]) => String(typeof m.at(-1)!.content === 'string' ? m.at(-1)!.content : '')
const reply = (text: string) => ({ text, firstTokenTop: [], inputTokens: 100, outputTokens: 10 })

const card = (id: string, selfService: boolean, extra: Partial<CardHit['labels']> = {}): CardHit => ({
  id, problem: `problema ${id}`, score: 0.7,
  labels: { selfService, steps: selfService ? ['Feche e abra o Outlook'] : [], teamAction: selfService ? '' : 'Atribuir licença no portal', product: 'microsoft', sourceDisplay: `ISA-${id}`, ...extra },
})

const docs = [
  { title: 'Outlook não sincroniza', url: 'https://learn.microsoft.com/pt-br/troubleshoot/outlook/sync', content: 'Reinicie o Outlook…' },
  { title: 'Modo cache', url: 'https://learn.microsoft.com/pt-br/outlook/cache', content: 'Desative o modo cache…' },
]

/** Resposta de múltipla escolha: a letra da opção cujo rótulo começa com `label`, com 97%. */
function pickOption(t: string, label: string) {
  const letter = t.split(/\n/).find(l => l.includes(label))![0]
  return { text: letter, firstTokenTop: [{ token: letter, logprob: Math.log(0.97) }], inputTokens: 50, outputTokens: 1 }
}

function fakeChat(compose: object | null, analysis: object = { microsoft: true, queries: ['Outlook not receiving emails', 'Outlook Inbox not syncing'] }, kind = 'Resolver um problema') {
  const calls: string[] = []
  const fn: ChatFn = async m => {
    const t = lastText(m)
    if (t.includes('O que o solicitante quer')) { calls.push('kind'); return pickOption(t, kind) }
    if (t.includes('"microsoft": bool')) { calls.push('analyze'); return reply(JSON.stringify(analysis)) }
    if (t.includes('<fontes>')) { calls.push('compose'); return reply(JSON.stringify(compose)) }
    throw new Error('chamada inesperada')
  }
  return { fn, calls }
}

describe('filtro de link e credencial nos passos', () => {
  it.each([
    'Acesse https://attacker.example/fix e entre com sua conta Microsoft',
    'Abra http://10.0.0.5/login',
    'Abra attacker.example/fix no navegador',
    'Entre em suporte-microsoft.xyz',
    'Acesse https://microsoft.com@attacker.example/',
    'Abra https://login.microsoft.com.attacker.example/',
    'Escreva para suporte@attacker.example',
    'Informe sua senha nesta conversa',
    'Responda este e-mail com o código de verificação',
    'Envie o token do Authenticator',
    'Compartilhe suas credenciais com o suporte',
    'Faça um pix para liberar o acesso',
    'Confirme o número do cartão de crédito',
  ])('barra: %s', text => {
    expect(unsafeForRequester(text)).toBe(true)
  })

  it.each([
    'Reinicie o Outlook',
    'No Teams, clique em ⋯ (Configurações e mais) > Configurações > Dispositivos',
    'Feche o Outlook.exe no Gerenciador de Tarefas',
    'Pressione Win+R e digite ncpa.cpl',
    'Localize o arquivo Outlook.ost e anote o tamanho',
    'Digite sua senha na tela de entrada do Windows',
    'Use a opção Esqueci minha senha na tela de entrada',
    'Digite o código de 6 dígitos mostrado no Authenticator',
    'Verifique a senha do Wi-Fi no celular',
    'Acesse https://account.microsoft.com e confira a sua conta',
    'Entre em outlook.office.com pelo navegador',
    'Abra aka.ms/mfasetup e siga as telas',
    'Instale a versão 2.1.3 do aplicativo',
    'Mencione @Maria no canal do Teams',
  ])('deixa passar: %s', text => {
    expect(unsafeForRequester(text)).toBe(false)
  })
})

describe('runGuidance', () => {
  it('injeção no chamado: passo com link de fora cai, os legítimos seguem e a orientação não fica vazia', async () => {
    const { fn } = fakeChat({
      aplicavel: true,
      passos: [
        { texto: 'Acesse https://attacker.example/fix e entre com sua conta Microsoft', fonte: 'L1' },
        { texto: 'Confira a conexão', como: ['Abra attacker.example/fix'], fonte: 'L1' },
        { texto: 'Informe sua senha nesta conversa', fonte: 'L1' },
        { texto: 'Reinicie o Outlook', como: ['Feche o Outlook.exe', 'Abra de novo pelo menu Iniciar'], fonte: 'L1' },
        { texto: 'Entre em outlook.office.com e veja se o e-mail chegou', fonte: 'L2' },
      ],
      links: ['L1'],
    })
    const r = await runGuidance(evidence, { chat: fn, searchLearn: async () => docs, findCards: async () => [] })
    expect(r.steps.map(s => s.text)).toEqual(['Reinicie o Outlook', 'Entre em outlook.office.com e veja se o e-mail chegou'])
    expect(r.links.map(l => l.url)).toEqual(expect.arrayContaining([docs[0].url]))
    expect(guidanceMessage({ name: 'Ana' }, r)).not.toContain('attacker')
  })

  it('assunto Microsoft: busca no Learn, passos citam fontes válidas e links vêm só da busca', async () => {
    const { fn, calls } = fakeChat({
      aplicavel: true,
      passos: [
        { texto: 'Reinicie o Outlook', fonte: 'L1' },
        { texto: 'Feche e abra o Outlook', fonte: 'c2' },
        { texto: 'Passo inventado', fonte: 'X9' },
        { texto: 'Veja o chamado 100-6961', fonte: 'L2' },
      ],
      links: ['L2', 'https://malicioso.example'],
    })
    const queries: string[] = []
    const r = await runGuidance(evidence, {
      chat: fn,
      searchLearn: async q => { queries.push(q); return docs },
      findCards: async () => [card('a', false), card('b', true)],
    })
    expect(calls.sort()).toEqual(['analyze', 'compose', 'kind', 'kind'])
    expect(queries).toEqual(['Outlook not receiving emails', 'Outlook Inbox not syncing'])
    expect(r.learn).toHaveLength(2) // mesmas URLs nas duas buscas: sem repetição
    expect(r.steps).toEqual([{ text: 'Reinicie o Outlook', how: [], source: 'L1' }, { text: 'Feche e abra o Outlook', how: [], source: 'C2' }])
    expect(r.links.map(l => l.url)).toEqual([docs[1].url, docs[0].url])
    expect(r.usedCards).toEqual(['b'])
    expect(r.teamHints).toEqual([{ cardId: 'a', text: 'Atribuir licença no portal', sourceDisplay: 'ISA-a', score: 0.7 }])
    expect(r.kind).toMatchObject({ chosen: 'problem', problem: true })
    expect(r.inputTokens).toBe(300)
  })

  it('sem Learn nem cartão de autoatendimento: não chama a composição, só dicas de equipe', async () => {
    const { fn, calls } = fakeChat(null, { microsoft: false, queries: [] })
    const r = await runGuidance(evidence, { chat: fn, searchLearn: async () => { throw new Error('não devia buscar') }, findCards: async () => [card('a', false)] })
    expect(calls.sort()).toEqual(['analyze', 'kind', 'kind'])
    expect(r.steps).toEqual([])
    expect(r.teamHints).toHaveLength(1)
  })

  it('pedido para a equipe: não busca no Learn nem compõe, mas mantém as dicas de equipe', async () => {
    const { fn, calls } = fakeChat({ aplicavel: true, passos: [{ texto: 'x', fonte: 'L1' }] }, undefined, 'Que a equipe')
    const r = await runGuidance(evidence, { chat: fn, searchLearn: async () => { throw new Error('não devia buscar') }, findCards: async () => [card('a', false), card('b', true)] })
    expect(calls).not.toContain('compose')
    expect(r.kind).toMatchObject({ chosen: 'request', problem: false })
    expect(r.steps).toEqual([])
    expect(r.teamHints).toHaveLength(1)
  })

  it('comunicado ou resposta: nenhuma dica de equipe', async () => {
    const { fn } = fakeChat(null, { microsoft: false, queries: [] }, 'Comunicado')
    const r = await runGuidance(evidence, { chat: fn, searchLearn: async () => [], findCards: async () => [card('a', false)] })
    expect(r.kind.chosen).toBe('other')
    expect(r.teamHints).toEqual([])
  })

  it('"como fazer": subpassos viram how; passo com subpasso de administrador é descartado', async () => {
    const { fn } = fakeChat({
      aplicavel: true,
      passos: [
        { texto: 'Escolha o microfone certo no Teams', como: ['No Teams, clique em ⋯ > Configurações > Dispositivos', 'Em Microfone, escolha o seu fone', '', 42], fonte: 'L1' },
        { texto: 'Reinstale o driver', como: ['Abra o Prompt de Comando como administrador'], fonte: 'L2' },
      ],
    })
    const r = await runGuidance(evidence, { chat: fn, searchLearn: async () => docs, findCards: async () => [] })
    expect(r.steps).toEqual([{ text: 'Escolha o microfone certo no Teams', how: ['No Teams, clique em ⋯ > Configurações > Dispositivos', 'Em Microfone, escolha o seu fone'], source: 'L1' }])
    const msg = guidanceMessage({ name: 'Ana' }, r)
    expect(msg).toContain(['1. Escolha o microfone certo no Teams', '   • No Teams, clique em ⋯ > Configurações > Dispositivos', '   • Em Microfone, escolha o seu fone'].join('\n'))
  })

  it('aplicavel=false: nenhum passo', async () => {
    const { fn } = fakeChat({ aplicavel: false, passos: [{ texto: 'x', fonte: 'L1' }] })
    const r = await runGuidance(evidence, { chat: fn, searchLearn: async () => docs, findCards: async () => [] })
    expect(r.steps).toEqual([])
    expect(r.links).toEqual([])
  })
})

describe('mensagens', () => {
  it('orientação ao solicitante não leva fonte nem número de chamado; nota interna leva', async () => {
    const { fn } = fakeChat({ aplicavel: true, passos: [{ texto: 'Feche e abra o Outlook', fonte: 'C1' }], links: [] })
    const r = await runGuidance(evidence, { chat: fn, searchLearn: async () => [], findCards: async () => [card('b', true), card('a', false)] })
    const msg = guidanceMessage({ name: 'Ana', now: new Date('2026-10-06T16:00:00Z') }, r)
    expect(msg).toContain('Boa tarde, Ana!')
    expect(msg).toContain('1. Feche e abra o Outlook')
    expect(msg).not.toMatch(/ISA-|C1|\[/)
    const note = internalNote({ guidance: r }, 'apply', true)
    expect(note.split('\n')[0]).toBe('**Orientação IA** — 1 passo de autoatendimento enviado ao solicitante')
    expect(note).toContain('[C1]')
    expect(note).toContain('ISA-a')
  })

  it('duplicidade cita o chamado do próprio solicitante', () => {
    expect(duplicateMessage({ name: 'Ana' }, { display_number: 'ISA-10', title: 'VPN' })).toContain('ISA-10 — "VPN"')
  })
})

describe('checkDuplicate', () => {
  const open = [{ id: 't1', display_number: 'ISA-1', title: 'VPN cai', description: 'cai toda hora' }, { id: 't2', display_number: 'ISA-2', title: 'Impressora', description: null }]
  const embed = async (texts: string[]) => texts.map(t => (t.includes('VPN') ? [1, 0] : t.includes('Impressora') ? [0, 1] : [1, -1]))
  const choice = (letterProbs: Record<string, number>): ChatFn => async () =>
    ({ text: 'A', firstTokenTop: Object.entries(letterProbs).map(([token, p]) => ({ token, logprob: Math.log(p) })), inputTokens: 50, outputTokens: 1 })

  it('abaixo do cosseno não chama a LLM', async () => {
    const r = await checkDuplicate({ title: 'Teams lento', description: null }, [open[1]], { embed, chat: async () => { throw new Error('não devia chamar') } })
    expect(r.result).toBeNull()
  })

  it('mesmo problema com confiança alta = duplicado; dividido = não', async () => {
    // Ordem normal: A=same; invertida: A=different. "Sim" forte nas duas rodadas.
    let round = 0
    const sure: ChatFn = async () => (round++ % 2 === 0
      ? { text: 'A', firstTokenTop: [{ token: 'A', logprob: Math.log(0.97) }, { token: 'B', logprob: Math.log(0.03) }], inputTokens: 50, outputTokens: 1 }
      : { text: 'B', firstTokenTop: [{ token: 'B', logprob: Math.log(0.97) }, { token: 'A', logprob: Math.log(0.03) }], inputTokens: 50, outputTokens: 1 })
    const yes = await checkDuplicate({ title: 'VPN caindo', description: null }, open, { embed, chat: sure })
    expect(yes.result).toMatchObject({ ticket: { id: 't1', display_number: 'ISA-1' }, isDuplicate: true })
    const split = await checkDuplicate({ title: 'VPN caindo', description: null }, open, { embed, chat: choice({ A: 0.5, B: 0.5 }) })
    expect(split.result?.isDuplicate).toBe(false)
  })
})

describe('Learn', () => {
  it('troca a URL para pt-br e descarta o fórum Q&A', () => {
    expect(toPtBr('https://learn.microsoft.com/troubleshoot/outlook/x#resolution')).toBe('https://learn.microsoft.com/pt-br/troubleshoot/outlook/x#resolution')
    expect(toPtBr('https://learn.microsoft.com/en-us/office/y')).toBe('https://learn.microsoft.com/pt-br/office/y')
    expect(toPtBr('https://learn.microsoft.com/answers/a/123')).toBeNull()
    expect(toPtBr('https://evil.example/x')).toBeNull()
  })

  it('lê a resposta SSE do MCP', () => {
    const results = { results: [
      { title: 'Q&A', contentUrl: 'https://learn.microsoft.com/answers/a/1', content: 'fórum' },
      { title: 'Doc', contentUrl: 'https://learn.microsoft.com/troubleshoot/a', content: 'passos' },
      { title: 'Doc repetido', contentUrl: 'https://learn.microsoft.com/en-us/troubleshoot/a', content: 'passos' },
    ] }
    const body = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(results) }] } })}\n`
    expect(parseLearnResponse(body)).toEqual([{ title: 'Doc', url: 'https://learn.microsoft.com/pt-br/troubleshoot/a', content: 'passos' }])
  })
})

describe('parseCard (destilação)', () => {
  const ok = { usable: true, problem: 'Outlook não sincroniza e-mails', selfService: true, steps: ['Reinicie o Outlook'], teamAction: '', product: 'microsoft' }
  it('aceita cartão limpo', () => expect(parseCard(JSON.stringify(ok))).toMatchObject({ selfService: true, steps: ['Reinicie o Outlook'] }))
  it('descarta inutilizável, JSON inválido e cartão com rastro de chamado ou dado mascarado', () => {
    expect(parseCard(JSON.stringify({ ...ok, usable: false }))).toBeNull()
    expect(parseCard('nada')).toBeNull()
    expect(parseCard(JSON.stringify({ ...ok, steps: ['Veja o chamado 100-6961'] }))).toBeNull()
    expect(parseCard(JSON.stringify({ ...ok, steps: ['Use a senha [SENHA]'] }))).toBeNull()
  })
  it('autoatendimento sem passos vira cartão de equipe (ou some se não houver ação)', () => {
    expect(parseCard(JSON.stringify({ ...ok, steps: [], teamAction: 'Resetar senha' }))).toMatchObject({ selfService: false, steps: [] })
    expect(parseCard(JSON.stringify({ ...ok, steps: [] }))).toBeNull()
  })
})

describe('runGuidance com a configuração do Motor IA', () => {
  const composeAll = { aplicavel: true, passos: [1, 2, 3, 4].map(i => ({ texto: `Passo ${i}`, como: ['a', 'b'], fonte: 'L1' })) }

  it('sem Microsoft Learn: não busca; sem base interna: não procura cartões', async () => {
    const { fn } = fakeChat(null, { microsoft: true, queries: ['x'] })
    const r = await runGuidance(evidence, {
      chat: fn, config: { useLearn: false, useInternalBase: false },
      searchLearn: async () => { throw new Error('não devia buscar no Learn') },
      findCards: async () => { throw new Error('não devia procurar cartões') },
    })
    expect(r.learn).toEqual([])
    expect(r.cards).toEqual([])
    expect(r.steps).toEqual([])
  })

  it('máximo de passos e sem "como fazer"', async () => {
    const { fn } = fakeChat(composeAll)
    const r = await runGuidance(evidence, { chat: fn, searchLearn: async () => docs, findCards: async () => [], config: { maxSteps: 2, howTo: false } })
    expect(r.steps).toEqual([{ text: 'Passo 1', how: [], source: 'L1' }, { text: 'Passo 2', how: [], source: 'L1' }])
  })
})
