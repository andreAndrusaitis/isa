import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../../../config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../config/env')>()
  return { env: { ...mod.env, AI_GUIDANCE_MODE: 'shadow', AZURE_AI_ENDPOINT: 'https://aif.test', AZURE_AI_KEY: 'k', AZURE_AI_DEPLOYMENT: 'gpt-4.1-mini' } }
})

import prisma from '../../../config/prisma'
import { env } from '../../../config/env'
import { SYSTEM_USER_ID } from '../../../utils/constants'
import type { ChatFn, ChatMessage } from '../../core/llm'
import { guidanceTicket, type GuidanceDeps } from './agent'
import { distillTicket } from '../resolution/distill'
import type { CardHit } from './guidance'

const SUFFIX = `aiguid-${Date.now()}`
const setMode = (m: string) => { (env as any).AI_GUIDANCE_MODE = m }
let orgId: string, reqId: string, staffId: string
const ticketIds: string[] = []
let seq = 0

async function makeTicket(userId: string, title: string, extra: Record<string, unknown> = {}) {
  const id = `AIGU-${Date.now()}-${seq++}`
  await prisma.ticket.create({
    data: { id, title, description: 'desde ontem', user_id: userId, org_id: orgId, display_number: `ISA-${id}`, sla_deadline: new Date(Date.now() + 864e5), ...extra },
  })
  ticketIds.push(id)
  return id
}

const lastText = (m: ChatMessage[]) => String(typeof m.at(-1)!.content === 'string' ? m.at(-1)!.content : '')
const reply = (text: string) => ({ text, firstTokenTop: [], inputTokens: 100, outputTokens: 10 })
/** Resposta de múltipla escolha: a letra da opção cujo rótulo contém `label`. */
const pick = (t: string, label: string, p = 0.97) => {
  const letter = t.split(/\n/).find(l => /^[A-Z]\) /.test(l) && l.includes(label))![0]
  return { text: letter, firstTokenTop: [{ token: letter, logprob: Math.log(p) }], inputTokens: 50, outputTokens: 1 }
}
const selfCard: CardHit = { id: 'card-1', problem: 'Outlook não recebe', score: 0.8, labels: { selfService: true, steps: ['Feche e abra o Outlook'], teamAction: '', product: 'microsoft', sourceDisplay: 'ISA-999' } }

/** Sem chamado parecido (embedding ortogonal), Learn vazio, um cartão de autoatendimento. */
const deps = (overrides: Partial<GuidanceDeps> = {}): GuidanceDeps => ({
  embed: async texts => texts.map((_, i) => (i === 0 ? [1, 0] : [0, 1])),
  searchLearn: async () => [],
  findCards: async () => [selfCard],
  chat: (async m => {
    const t = lastText(m)
    if (t.startsWith('O que é este chamado?')) return pick(t, 'Relato de problema')
    if (t.includes('O que o solicitante quer')) {
      const letter = t.split(/\n/).find(l => l.includes('Resolver um problema'))![0]
      return { text: letter, firstTokenTop: [{ token: letter, logprob: Math.log(0.97) }], inputTokens: 50, outputTokens: 1 }
    }
    if (t.includes('"microsoft": bool')) return reply('{"microsoft": false, "queries": []}')
    if (t.includes('<fontes>')) return reply('{"aplicavel": true, "passos": [{"texto": "Feche e abra o Outlook", "fonte": "C1"}], "links": []}')
    throw new Error('chamada inesperada')
  }) as ChatFn,
  ...overrides,
})

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
  reqId = (await prisma.user.create({ data: { name: 'Ana Teste', email: `req-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })).id
  staffId = (await prisma.user.create({ data: { name: `Staff ${SUFFIX}`, email: `staff-${SUFFIX}@t.com`, password: 'x', role: 'agent', org_id: orgId } })).id
})

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
  await prisma.user.deleteMany({ where: { id: { in: [reqId, staffId] } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('guidanceTicket', () => {
  it('sombra: registra e deixa só nota interna, sem marca', async () => {
    setMode('shadow')
    const id = await makeTicket(reqId, 'Outlook não recebe e-mails')
    await guidanceTicket(id, {}, deps())
    expect(await prisma.aiAgentRun.findFirst({ where: { ticket_id: id } })).toMatchObject({ agent: 'guidance', mode: 'shadow', status: 'ok' })
    const msgs = await prisma.ticketMessage.findMany({ where: { ticket_id: id } })
    expect(msgs.map(m => m.type)).toEqual(['internal'])
    expect(msgs[0].text).toContain('1 passo de autoatendimento seria enviado (sombra, nada enviado)')
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ status: 'open', guidance_status: null })
  })

  it('apply: orienta o solicitante sem citar outro chamado e marca offered', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, 'Outlook não recebe e-mails')
    await guidanceTicket(id, {}, deps())
    const pub = await prisma.ticketMessage.findFirst({ where: { ticket_id: id, type: 'agent' } })
    expect(pub?.user_id).toBe(SYSTEM_USER_ID)
    expect(pub?.text).toContain('1. Feche e abra o Outlook')
    expect(pub?.text).not.toContain('ISA-999')
    const note = await prisma.ticketMessage.findFirst({ where: { ticket_id: id, type: 'internal' } })
    expect(note?.text).toContain('ISA-999')
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ status: 'open', guidance_status: 'offered' })
  })

  it('portão da triagem em comunicado automático: não orienta, nota curta, marca skipped e não chama a LLM', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, 'ALERTA Zabbix: disco cheio no SRV-DB01')
    const gate = { value: 'automatic', probability: 0.97, margin: 0.95, roundsAgree: true, confidence: 0.97, wouldApply: true }
    await prisma.aiAgentRun.create({ data: { agent: 'triage', ticket_id: id, mode: 'apply', model: 'm', prompt_version: 'triage-v3', status: 'ok', latency_ms: 1, result: { gate } } })
    await guidanceTicket(id, {}, deps({ chat: (async () => { throw new Error('não devia chamar') }) as ChatFn, findCards: async () => { throw new Error('não devia orientar') } }))
    const msgs = await prisma.ticketMessage.findMany({ where: { ticket_id: id } })
    expect(msgs.map(m => [m.type, m.text])).toEqual([['internal', '**Orientação IA** — não enviada: comunicado automático ou relatório (97%)']])
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ guidance_status: 'skipped' })
    expect((await prisma.aiAgentRun.findFirst({ where: { ticket_id: id, agent: 'guidance' } }))?.result).toMatchObject({ skipReason: 'gate', gate: { value: 'automatic' } })
  })

  it('sem triagem, a orientação lê o portão ela mesma: teste confiante não orienta', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, 'teste teste')
    await guidanceTicket(id, {}, deps({
      chat: (async m => {
        const t = lastText(m)
        if (t.startsWith('O que é este chamado?')) return pick(t, 'Teste do sistema')
        throw new Error('não devia orientar')
      }) as ChatFn,
    }))
    expect(await prisma.ticketMessage.count({ where: { ticket_id: id, type: 'agent' } })).toBe(0)
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ guidance_status: 'skipped' })
    expect((await prisma.ticketMessage.findFirst({ where: { ticket_id: id } }))?.text).toBe('**Orientação IA** — não enviada: teste (100%)') // só a letra escolhida nos logprobs
  })

  it('roda uma vez: segunda chamada não faz nada', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, 'Outlook não recebe e-mails')
    await guidanceTicket(id, {}, deps())
    await guidanceTicket(id, {}, deps())
    expect(await prisma.aiAgentRun.count({ where: { ticket_id: id } })).toBe(1)
  })

  it('apply: duplicado de chamado aberto do mesmo solicitante → oferta de vínculo e não orienta', async () => {
    setMode('apply')
    const older = await makeTicket(reqId, 'VPN cai toda hora')
    const id = await makeTicket(reqId, 'VPN caindo de novo')
    let round = 0
    await guidanceTicket(id, {}, deps({
      embed: async texts => texts.map(() => [1, 0]),
      findCards: async () => { throw new Error('não devia orientar') },
      chat: (async () => (round++ % 2 === 0
        ? { text: 'A', firstTokenTop: [{ token: 'A', logprob: Math.log(0.98) }, { token: 'B', logprob: Math.log(0.02) }], inputTokens: 50, outputTokens: 1 }
        : { text: 'B', firstTokenTop: [{ token: 'B', logprob: Math.log(0.98) }, { token: 'A', logprob: Math.log(0.02) }], inputTokens: 50, outputTokens: 1 })) as ChatFn,
    }))
    const pub = await prisma.ticketMessage.findFirst({ where: { ticket_id: id, type: 'agent' } })
    expect(pub?.text).toContain(`ISA-${older}`)
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ guidance_status: 'duplicate_offered' })
    const run = await prisma.aiAgentRun.findFirst({ where: { ticket_id: id } })
    expect((run?.result as any).duplicate.ticket.id).toBe(older)
  })

  it('duplicidade só olha chamados ANTERIORES: o original não é oferecido como duplicado do repetido', async () => {
    setMode('apply')
    const original = await makeTicket(reqId, 'Teclado sem resposta', { created_at: new Date(Date.now() - 60_000) })
    await makeTicket(reqId, 'Teclado sem resposta de novo')
    await guidanceTicket(original, {}, deps({ embed: async texts => texts.map(() => [1, 0]) }))
    const run = await prisma.aiAgentRun.findFirst({ where: { ticket_id: original } })
    expect((run?.result as any).duplicate).toBeNull()
    expect(await prisma.ticket.findUnique({ where: { id: original } })).toMatchObject({ guidance_status: 'offered' })
  })

  it('espera o complemento quando o intake perguntou algo', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, 'Outlook', { intake_status: 'incomplete' })
    await guidanceTicket(id, {}, deps())
    expect(await prisma.aiAgentRun.count({ where: { ticket_id: id } })).toBe(0)
  })

  it('aberto pela equipe: pula sem LLM', async () => {
    setMode('apply')
    const id = await makeTicket(staffId, 'Outlook')
    await guidanceTicket(id, {}, deps({ chat: (async () => { throw new Error('não devia chamar') }) as ChatFn }))
    const run = await prisma.aiAgentRun.findFirst({ where: { ticket_id: id } })
    expect(run?.result).toEqual({ skipReason: 'staff' })
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ guidance_status: 'skipped' })
  })

  it('analista já respondeu: não envia e marca none', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, 'Outlook não recebe e-mails')
    await prisma.ticketMessage.create({ data: { ticket_id: id, user_id: staffId, type: 'agent', text: 'Olá, vou verificar' } })
    await guidanceTicket(id, {}, deps())
    expect(await prisma.ticketMessage.count({ where: { ticket_id: id, type: 'agent', user_id: SYSTEM_USER_ID } })).toBe(0)
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ guidance_status: 'none' })
  })

  it('falha da IA: nota curta, chamado intacto', async () => {
    setMode('apply')
    const id = await makeTicket(reqId, 'Outlook')
    await guidanceTicket(id, {}, deps({ chat: (async () => { throw new Error('LLM 500: boom') }) as ChatFn }))
    const note = await prisma.ticketMessage.findFirst({ where: { ticket_id: id, type: 'internal' } })
    expect(note?.text).toContain('não executada: LLM 500')
    expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ status: 'open', guidance_status: null })
  })
})

describe('guidance com a configuração do Motor IA', () => {
  // A linha do agente no Motor IA vale no lugar do env; restaura a que existia.
  let saved: any
  const withConfig = async (config: object) => {
    saved = await prisma.aiAgentSetting.findUnique({ where: { agent: 'guidance' } })
    await prisma.aiAgentSetting.upsert({ where: { agent: 'guidance' }, create: { agent: 'guidance', mode: 'apply', config }, update: { mode: 'apply', config } })
  }
  const restore = async () => {
    if (saved) await prisma.aiAgentSetting.update({ where: { agent: 'guidance' }, data: { mode: saved.mode, config: saved.config ?? undefined } })
    else await prisma.aiAgentSetting.deleteMany({ where: { agent: 'guidance' } })
  }

  it('duplicidade desligada: não compara com os chamados abertos e vai direto à orientação', async () => {
    await withConfig({ detectDuplicates: false })
    try {
      await makeTicket(reqId, 'Outlook não recebe e-mails')
      const id = await makeTicket(reqId, 'Outlook não recebe e-mails de novo')
      await guidanceTicket(id, {}, deps({ embed: async () => { throw new Error('não devia comparar') } }))
      const run = await prisma.aiAgentRun.findFirst({ where: { ticket_id: id } })
      expect((run?.result as any).duplicate).toBeNull()
      expect(await prisma.ticket.findUnique({ where: { id } })).toMatchObject({ guidance_status: 'offered' })
    } finally { await restore() }
  })

  it('mensagem assinada pela Skadi ou pelo antigo Assistente ISA não entra como resolução da equipe', async () => {
    await withConfig({ learnFromClosed: true })
    try {
      const id = await makeTicket(reqId, 'Teams sem áudio', { status: 'closed' })
      await prisma.ticketMessage.createMany({ data: [
        { ticket_id: id, user_id: staffId, type: 'agent', text: 'Orientação automática nova.\n— Skadi' },
        { ticket_id: id, user_id: staffId, type: 'agent', text: 'Orientação automática antiga.\n— Assistente ISA' },
        { ticket_id: id, user_id: staffId, type: 'agent', text: 'Selecionei o microfone certo nas configurações do Teams.' },
      ] })
      let prompt = ''
      await distillTicket(id, { chat: (async (m: ChatMessage[]) => { prompt = JSON.stringify(m); return reply('{}') }) as ChatFn })
      expect(prompt).toContain('Selecionei o microfone certo')
      expect(prompt).not.toContain('Orientação automática')
    } finally { await restore() }
  })

  it('"alimentar a base" desligado: chamado fechado não vira cartão (nem chama a IA)', async () => {
    await withConfig({ learnFromClosed: false })
    try {
      const id = await makeTicket(reqId, 'Teams sem áudio', { status: 'closed', resolution_details: 'Orientado a escolher o microfone certo nas configurações do Teams.' })
      await distillTicket(id, { chat: async () => { throw new Error('não devia destilar') } })
      expect(await prisma.aiAgentRun.count({ where: { ticket_id: id, agent: 'resolution' } })).toBe(0)
    } finally { await restore() }
  })
})
