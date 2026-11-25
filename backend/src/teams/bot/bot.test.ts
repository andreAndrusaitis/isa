import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
// Grava em banco real: rodar só contra o banco descartável (127.0.0.1:5434).
import { z } from 'zod'
import type { TurnContext } from '@microsoft/agents-hosting'
import prisma from '../../config/prisma'
import { runAssistant } from '../../ai/assistant/orchestrator'
import { resetLimits } from '../../ai/assistant/limits'
import type { ToolChatFn, ToolChatResult } from '../../ai/core/llm'
import type { AssistantTool } from '../../ai/assistant/types'
import { createBotHandler, CANCELLED_TEXT, HELP_TEXT, NOTHING_PENDING_TEXT, type BotCategory, type BotDeps } from './bot'
import type { BotConfig } from './config'
import { findByConversationId, readHistory, readPending } from './conversationStore'
import { TENANT_NOT_ALLOWED_TEXT, UNKNOWN_USER_TEXT } from './identity'

const tag = `teamsbot-${Date.now()}`
const TENANT = '11111111-2222-4333-8444-555555555555'
const AAD = `${tag}-aad`
const config: BotConfig = { enabled: true, appId: 'app', password: 'x', homeTenant: TENANT, tenants: [TENANT], portalUrl: 'https://portal.test' }
let userId = ''
let ticketId = ''
let seq = 0

// ---------- contexto falso do Teams ----------

interface Sent { type?: string; text?: string; attachments?: Array<{ content: any }>; value?: any }

function turn(activity: Record<string, unknown>, conversationId = `${tag}-conv`) {
  const sent: Sent[] = []
  const context = {
    activity: {
      id: `act-${seq++}`,
      channelId: 'msteams',
      serviceUrl: 'https://smba.trafficmanager.net/br/',
      from: { id: '29:user', aadObjectId: AAD, name: 'Nome digitado' },
      recipient: { id: '28:bot', name: 'ISA' },
      conversation: { id: conversationId, tenantId: TENANT, conversationType: 'personal' },
      ...activity,
    },
    sendActivity: vi.fn(async (a: any) => { sent.push(typeof a === 'string' ? { type: 'message', text: a } : a); return { id: 'r' } }),
    turnState: new Map(),
  }
  return { context: context as unknown as TurnContext, sent }
}

const message = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'message', text, ...extra })
const submit = (value: Record<string, unknown>) => ({ type: 'message', text: '', value })
const cardOf = (s: Sent) => s.attachments?.[0]?.content
const texts = (sent: Sent[]) => sent.filter(s => s.text).map(s => s.text!)
const invokeBody = (sent: Sent[]) => sent.find(s => s.type === 'invokeResponse')?.value

// ---------- ferramentas e modelo falsos ----------

const reply = (text: string): ToolChatResult => ({ text, toolCalls: [], inputTokens: 10, outputTokens: 10 })
const call = (name: string, args: unknown): ToolChatResult => ({
  text: '', inputTokens: 10, outputTokens: 10,
  toolCalls: [{ id: `c${seq++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})
function script(...replies: ToolChatResult[]): ToolChatFn {
  return vi.fn(async () => {
    const next = replies.shift()
    if (!next) throw new Error('chamada inesperada ao modelo')
    return next
  }) as unknown as ToolChatFn
}

const learn: AssistantTool = {
  name: 'buscar_learn', description: 'Learn', write: false, schema: z.object({ consulta: z.string() }),
  handler: vi.fn(async () => ({ itens: ['reinicie o Outlook'], sources: [{ title: 'Outlook [desktop]', url: 'https://learn.microsoft.com/outlook' }] })),
}
const meus: AssistantTool = {
  name: 'meus_chamados', description: 'Lista', write: false, schema: z.object({}).passthrough(),
  handler: vi.fn(async () => [{ numero: 'INC-7', titulo: 'VPN caiu', status: 'Aberto' }]),
}
const abrir: AssistantTool = {
  name: 'abrir_chamado', description: 'Abre', write: true,
  schema: z.object({ titulo: z.string().min(3), descricao: z.string().min(3), categoryId: z.string().optional(), subcategoryId: z.string().optional() }),
  describe: (i: any) => `Abrir chamado "${i.titulo}"`,
  handler: vi.fn(async (_i: any, ctx: any) => {
    if (!ctx.confirmed) throw new Error('sem confirmação')
    return { numero: 'INC-9', id: 'ticket-9', status: 'Aberto' }
  }),
}
const responder: AssistantTool = {
  name: 'responder_analista', description: 'Responde', write: true,
  schema: z.object({ chamado: z.string(), mensagem: z.string() }),
  describe: (i: any) => `Responder no chamado ${i.chamado}`,
  handler: vi.fn(async (i: any, ctx: any) => {
    if (!ctx.confirmed) throw new Error('sem confirmação')
    return { numero: 'INC-7', mensagemId: 'm1', enviada: true, chamado: i.chamado }
  }),
}
const tools = [learn, meus, abrir, responder]

const categories: BotCategory[] = [{
  id: 'cat-1', name: 'Infraestrutura', subcategories: [
    { id: 'sub-1', name: 'Rede' },
    { id: 'sub-esp', name: 'Onboarding', is_special: true, special_form_schema: [{ key: 'nome', label: 'Nome', type: 'text', required: true }] },
  ],
}]

const getMember = vi.fn(async () => ({ userPrincipalName: `${tag}@isa.test`, aadObjectId: AAD }))

function bot(extra: Partial<BotDeps> = {}) {
  return createBotHandler({ config: () => config, getMember, tools, assistant: runAssistant, categories: async () => categories, ...extra })
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: tag, email: `${tag}@isa.test`, role: 'user', auth_provider: 'microsoft', active: true } })).id
  ticketId = (await prisma.ticket.create({
    data: { id: `${tag}-t`, title: 'VPN', description: 'd', user_id: userId, display_number: `INC-${tag}`, sla_deadline: new Date(Date.now() + 864e5) } as any,
  })).id
})

afterAll(async () => {
  await prisma.teamsConversation.deleteMany({ where: { conversation_id: { startsWith: tag } } })
  await prisma.auditLog.deleteMany({ where: { user_id: userId } })
  await prisma.ticket.deleteMany({ where: { id: ticketId } })
  await prisma.user.deleteMany({ where: { id: userId } })
})

beforeEach(() => {
  resetLimits()
  vi.clearAllMocks()
})

describe('identidade', () => {
  it('usuário sem conta Microsoft no ISA recebe o aviso para entrar uma vez pela aba', async () => {
    const { context, sent } = turn(message('oi', { from: { id: '29:outro', aadObjectId: `${tag}-desconhecido` } }), `${tag}-unknown`)
    await bot({ getMember: vi.fn(async () => ({ userPrincipalName: 'ninguem@fora.test' })) })(context)
    expect(texts(sent)).toEqual([UNKNOWN_USER_TEXT])
    expect(await findByConversationId(`${tag}-unknown`)).toBeNull()
  })

  it('tenant fora da lista não conversa', async () => {
    const { context, sent } = turn(message('oi', { conversation: { id: `${tag}-other`, tenantId: '99999999-2222-4333-8444-555555555555', conversationType: 'personal' } }))
    await bot()(context)
    expect(texts(sent)).toEqual([TENANT_NOT_ALLOWED_TEXT])
    expect(getMember).not.toHaveBeenCalled()
  })

  it('o AAD de outra pessoa no getMember não vale (nunca confia no nome/e-mail digitado)', async () => {
    const { context, sent } = turn(message('meus chamados', { from: { id: '29:x', aadObjectId: `${tag}-aad-2` } }), `${tag}-mismatch`)
    await bot({ getMember: vi.fn(async () => ({ userPrincipalName: `${tag}@isa.test`, aadObjectId: 'outro-aad' })) })(context)
    expect(texts(sent)).toEqual([UNKNOWN_USER_TEXT])
  })
})

describe('conversa', () => {
  it('pergunta de leitura: responde com o texto do modelo e as fontes do Learn, e guarda conversa e referência', async () => {
    const { context, sent } = turn(message('Meu Outlook não sincroniza'))
    await bot({ chatFn: script(call('buscar_learn', { consulta: 'outlook sincronizar' }), reply('Reinicie o Outlook e confira a conexão.')) })(context)

    expect(texts(sent)).toEqual(['Reinicie o Outlook e confira a conexão.\n\nFontes: [Outlook desktop](https://learn.microsoft.com/outlook)'])
    const conv = await findByConversationId(`${tag}-conv`)
    expect(conv).toMatchObject({ user_id: userId, tenant_id: TENANT, aad_object_id: AAD.toLowerCase() })
    expect((conv!.conversation_reference as any)).toMatchObject({ serviceUrl: 'https://smba.trafficmanager.net/br/', agent: { id: '28:bot' }, conversation: { id: `${tag}-conv` } })
    expect(readHistory(conv!).map(m => m.role)).toEqual(['user', 'assistant'])
  })

  it('a segunda mensagem usa o vínculo salvo, sem consultar o Teams de novo', async () => {
    const { context, sent } = turn(message('ajuda'))
    await bot()(context)
    expect(texts(sent)).toEqual([HELP_TEXT])
    expect(getMember).not.toHaveBeenCalled()
  })

  it('"meus chamados" lista os chamados da pessoa', async () => {
    const { context, sent } = turn(message('Meus chamados!'))
    await bot()(context)
    expect(meus.handler).toHaveBeenCalledWith({ limite: 5 }, { userId, via: 'teams' })
    expect(texts(sent)[0]).toContain('**INC-7** — VPN caiu · Aberto')
  })

  it('escrita proposta pelo modelo vira card de confirmação e fica pendente', async () => {
    const { context, sent } = turn(message('abre um chamado pra VPN'))
    await bot({ chatFn: script(call('abrir_chamado', { titulo: 'VPN não conecta', descricao: 'Desde ontem' })) })(context)

    const card = cardOf(sent.find(s => s.attachments)!)
    expect(card.body[0].text).toBe('Confirma esta ação?')
    const actions = card.actions.map((a: any) => a.data?.acao)
    expect(actions).toEqual(['confirmar', 'cancelar', 'formulario'])
    expect(card.actions[2].data).toMatchObject({ msteams: { type: 'task/fetch' }, titulo: 'VPN não conecta', descricao: 'Desde ontem' })
    expect(abrir.handler).not.toHaveBeenCalled()
    expect(readPending((await findByConversationId(`${tag}-conv`))!)).toMatchObject({ tool: 'abrir_chamado', input: { titulo: 'VPN não conecta' } })
  })

  it('"Confirmar" executa a escrita confirmada, limpa a pendência e mostra o número', async () => {
    const { context, sent } = turn(submit({ acao: 'confirmar', tool: 'abrir_chamado' }))
    await bot()(context)
    expect(abrir.handler).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'VPN não conecta' }), { userId, via: 'teams', confirmed: true })
    expect(texts(sent)[0]).toBe('Chamado **INC-9** aberto. Você recebe as respostas do analista aqui e por e-mail. [Ver chamado](https://portal.test/c/ticket-9)')
    expect(readPending((await findByConversationId(`${tag}-conv`))!)).toBeNull()
  })

  it('segundo clique em "Confirmar" não executa de novo', async () => {
    const { context, sent } = turn(submit({ acao: 'confirmar', tool: 'abrir_chamado' }))
    await bot()(context)
    expect(abrir.handler).not.toHaveBeenCalled()
    expect(texts(sent)).toEqual([NOTHING_PENDING_TEXT])
  })

  it('"Cancelar" descarta a pendência', async () => {
    await bot({ chatFn: script(call('abrir_chamado', { titulo: 'Impressora', descricao: 'Não imprime' })) })(turn(message('abre chamado da impressora')).context)
    const { context, sent } = turn(submit({ acao: 'cancelar', tool: 'abrir_chamado' }))
    await bot()(context)
    expect(texts(sent)).toEqual([CANCELLED_TEXT])
    expect(readPending((await findByConversationId(`${tag}-conv`))!)).toBeNull()
    expect(abrir.handler).not.toHaveBeenCalled()
  })

  it('"Responder" do card do analista roda responder_analista como a própria pessoa', async () => {
    const { context, sent } = turn(submit({ acao: 'responder', ticketId: 'ticket-7', resposta: 'Reiniciei e continua.' }))
    await bot()(context)
    expect(responder.handler).toHaveBeenCalledWith({ chamado: 'ticket-7', mensagem: 'Reiniciei e continua.' }, { userId, via: 'teams', confirmed: true })
    expect(texts(sent)).toEqual(['Resposta enviada no chamado **INC-7**.'])
  })
})

describe('abertura por cards', () => {
  it('categoria → assunto → formulário → confirmação com categoria e subcategoria', async () => {
    const step1 = turn(message('abrir chamado'))
    await bot()(step1.context)
    const catCard = cardOf(step1.sent[0])
    expect(JSON.stringify(catCard)).toContain('"acao":"categoria","id":"cat-1"')
    expect(catCard.actions.at(-1).data.acao).toBe('formulario')

    const step2 = turn(submit({ acao: 'categoria', id: 'cat-1' }))
    await bot()(step2.context)
    expect(JSON.stringify(cardOf(step2.sent[0]))).toContain('"acao":"subcategoria","id":"sub-1"')

    const step3 = turn(submit({ acao: 'subcategoria', id: 'sub-1', categoryId: 'cat-1' }))
    await bot()(step3.context)
    const form = cardOf(step3.sent[0])
    expect(form.actions.map((a: any) => a.data?.acao)).toEqual(['abrir', 'categorias', 'formulario'])

    const step4 = turn(submit({ acao: 'abrir', subcategoryId: 'sub-1', titulo: 'Wi-Fi caindo', descricao: 'Cai a cada 10 min' }))
    await bot()(step4.context)
    const confirmation = cardOf(step4.sent[0])
    expect(confirmation.body[0].text).toBe('Confirma esta ação?')
    expect(confirmation.body[2].facts).toEqual([{ title: 'Categoria', value: 'Infraestrutura' }, { title: 'Assunto', value: 'Rede' }])
    expect(readPending((await findByConversationId(`${tag}-conv`))!)).toEqual({
      tool: 'abrir_chamado',
      input: { titulo: 'Wi-Fi caindo', descricao: 'Cai a cada 10 min', categoryId: 'cat-1', subcategoryId: 'sub-1' },
      summary: 'Abrir chamado "Wi-Fi caindo"',
    })
    expect(abrir.handler).not.toHaveBeenCalled()
  })

  it('formulário incompleto devolve o erro do card', async () => {
    const { context, sent } = turn(submit({ acao: 'abrir', subcategoryId: 'sub-1', titulo: 'Só título' }))
    await bot()(context)
    expect(texts(sent)).toEqual(['Descreva o problema ou pedido'])
  })

  it('subcategoria de outra empresa (fora da lista da pessoa) é recusada', async () => {
    const { context, sent } = turn(submit({ acao: 'abrir', subcategoryId: 'sub-de-outro', titulo: 'x', descricao: 'y' }))
    await bot()(context)
    expect(texts(sent)[0]).toContain('não está mais disponível')
  })

  it('pedido especial vai para o formulário do portal', async () => {
    const { context, sent } = turn(submit({ acao: 'subcategoria', id: 'sub-esp' }))
    await bot()(context)
    const card = cardOf(sent[0])
    expect(card.actions).toEqual([expect.objectContaining({ title: 'Abrir pelo formulário', data: expect.objectContaining({ msteams: { type: 'task/fetch' } }) })])
  })
})

describe('dialog e extensão de mensagem', () => {
  const invoke = (name: string, value: unknown, conversation?: Record<string, unknown>) =>
    ({ type: 'invoke', name, value, ...(conversation ? { conversation } : {}) })

  it('task/fetch abre o wizard com o resumo da conversa', async () => {
    const { context, sent } = turn(invoke('task/fetch', { data: { acao: 'formulario', titulo: 'VPN', descricao: 'Não conecta' } }))
    await bot()(context)
    const body = invokeBody(sent)
    expect(body.status).toBe(200)
    expect(body.body.task.value.url).toBe('https://portal.test/solicitacoes?teams=1&dialog=1&titulo=VPN&descricao=N%C3%A3o+conecta')
  })

  it('task/submit confirma no chat o chamado aberto pelo wizard (só se for da pessoa)', async () => {
    const own = turn(invoke('task/submit', { data: { ticketId, numero: 'INC-FALSO' } }))
    await bot()(own.context)
    expect(invokeBody(own.sent)).toEqual({ status: 200, body: undefined })
    expect(texts(own.sent)[0]).toContain(`Chamado **INC-${tag}** aberto`)

    const other = turn(invoke('task/submit', { data: { ticketId: 'de-outra-pessoa', numero: 'INC-1' } }))
    await bot()(other.context)
    expect(texts(other.sent)).toEqual([])
  })

  it('task/submit de chamado resolvido pela IA diz que foi resolvido, não que o analista vai responder', async () => {
    const resolved = await prisma.ticket.create({
      data: { id: `${tag}-ia`, title: 'VPN', description: 'd', user_id: userId, display_number: `INC-${tag}-IA`, status: 'resolved', ai_resolved: true, sla_deadline: new Date(Date.now() + 864e5) } as any,
    })
    try {
      const { context, sent } = turn(invoke('task/submit', { data: { ticketId: resolved.id } }))
      await bot()(context)
      const [text] = texts(sent)
      expect(text).toContain(`Chamado **INC-${tag}-IA** resolvido`)
      expect(text).toContain('consult')
      expect(text).toContain(`[Ver chamado](https://portal.test/c/${resolved.id})`)
      expect(text).not.toContain('aberto')
      expect(text).not.toContain('analista')
    } finally {
      await prisma.ticket.deleteMany({ where: { id: resolved.id } })
    }
  })

  it('composeExtension/fetchTask monta o wizard a partir da mensagem', async () => {
    const group = { id: `${tag}-group`, tenantId: TENANT, conversationType: 'groupChat' }
    const { context, sent } = turn(invoke('composeExtension/fetchTask', {
      commandId: 'abrirChamadoDaMensagem', commandContext: 'message',
      messagePayload: { subject: '', body: { contentType: 'html', content: '<p>Sistema de ponto fora do ar</p>' } },
    }, group))
    await bot()(context)
    const url = new URL(invokeBody(sent).body.task.value.url)
    expect(url.origin + url.pathname).toBe('https://portal.test/solicitacoes')
    expect(url.searchParams.get('dialog')).toBe('1')
    expect(url.searchParams.get('titulo')).toBe('Sistema de ponto fora do ar')
    expect(url.searchParams.get('descricao')).toBe('Sistema de ponto fora do ar')
    expect(await findByConversationId(`${tag}-group`)).toBeNull()
  })

  it('a ajuda e o aviso de organização apresentam a Skadi', () => {
    expect(HELP_TEXT).toContain('Sou a Skadi, assistente de IA do **ISA**')
    expect(TENANT_NOT_ALLOWED_TEXT).toContain('A Skadi ainda não está liberada')
  })

  it('composeExtension/submitAction de chamado resolvido pela IA diz que foi resolvido, não que o analista vai responder', async () => {
    const resolved = await prisma.ticket.create({
      data: { id: `${tag}-ia2`, title: 'VPN', description: 'd', user_id: userId, display_number: `INC-${tag}-IA2`, status: 'resolved', ai_resolved: true, sla_deadline: new Date(Date.now() + 864e5) } as any,
    })
    try {
      const { context, sent } = turn(invoke('composeExtension/submitAction', { commandId: 'abrirChamadoDaMensagem', data: { ticketId: resolved.id } }, { id: `${tag}-group`, tenantId: TENANT, conversationType: 'groupChat' }))
      await bot()(context)
      const { value } = invokeBody(sent).body.task
      expect(value).toContain(`Chamado INC-${tag}-IA2 resolvido`)
      expect(value).toContain('consult')
      expect(value).not.toContain('aberto')
      expect(value).not.toContain('analista')
    } finally {
      await prisma.ticket.deleteMany({ where: { id: resolved.id } })
    }
  })

  it('composeExtension/submitAction responde no dialog', async () => {
    const { context, sent } = turn(invoke('composeExtension/submitAction', { commandId: 'abrirChamadoDaMensagem', data: { ticketId } }, { id: `${tag}-group`, tenantId: TENANT, conversationType: 'groupChat' }))
    await bot()(context)
    expect(invokeBody(sent).body).toEqual({ task: { type: 'message', value: expect.stringContaining(`Chamado INC-${tag} aberto`) } })
  })

  it('usuário desconhecido no dialog recebe o aviso no próprio dialog', async () => {
    const { context, sent } = turn({ ...invoke('task/fetch', { data: {} }), from: { id: '29:z', aadObjectId: `${tag}-zz` } })
    await bot({ getMember: vi.fn(async () => null) })(context)
    expect(invokeBody(sent).body).toEqual({ task: { type: 'message', value: UNKNOWN_USER_TEXT } })
  })
})
