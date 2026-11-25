import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// Grava em banco real: rodar só contra o banco descartável (127.0.0.1:5434).
import type { CloudAdapter } from '@microsoft/agents-hosting'
import prisma from '../../config/prisma'
import type { BotConfig } from './config'
import { getOrCreate } from './conversationStore'
import { isPublicAgentReply, notifyAgentReply, type AgentReplyEvent } from './notifier'

const tag = `teamsnotify-${Date.now()}`
const TENANT = 'aaaaaaaa-2222-4333-8444-555555555555'
const OTHER_TENANT = 'bbbbbbbb-2222-4333-8444-555555555555'
const config: BotConfig = { enabled: true, appId: 'bot-app-id', password: 'x', homeTenant: TENANT, tenants: [TENANT], portalUrl: 'https://portal.test' }
let requesterId = ''
let withoutTeamsId = ''

const reference = (conversationId: string, tenantId: string) => ({
  conversation: { id: conversationId, tenantId, conversationType: 'personal' },
  serviceUrl: 'https://smba.trafficmanager.net/br/',
  channelId: 'msteams',
  user: { id: '29:user', aadObjectId: `${tag}-aad` },
  agent: { id: '28:bot' },
  bot: { id: '28:bot' },
})

function fakeAdapter(fail = false) {
  const sent: any[] = []
  const continueConversation = vi.fn(async (_appId: string, _ref: unknown, logic: (ctx: any) => Promise<void>) => {
    if (fail) throw new Error('serviço do Teams fora')
    await logic({ sendActivity: async (a: any) => { sent.push(a); return { id: 'x' } } })
  })
  return { adapter: { continueConversation } as unknown as CloudAdapter, continueConversation, sent }
}

const event = (over: Partial<AgentReplyEvent> = {}): AgentReplyEvent => ({
  ticket: { id: 'ticket-1', display_number: 'INC-55', title: 'VPN não conecta', user_id: requesterId },
  authorId: 'agente-1',
  authorName: 'Ana Analista',
  type: 'agent',
  text: '<p>Pode reiniciar o cliente da VPN e testar de novo?</p>',
  ...over,
})

beforeAll(async () => {
  requesterId = (await prisma.user.create({ data: { name: tag, email: `${tag}@isa.test`, role: 'user', auth_provider: 'microsoft', active: true } })).id
  withoutTeamsId = (await prisma.user.create({ data: { name: `${tag}-2`, email: `${tag}-2@isa.test`, role: 'user', auth_provider: 'microsoft', active: true } })).id
  for (const [n, tenant] of [[1, TENANT], [2, OTHER_TENANT]] as const) {
    await getOrCreate({
      conversationId: `${tag}-conv-${n}`, tenantId: tenant, aadObjectId: `${tag}-aad`,
      serviceUrl: 'https://smba.trafficmanager.net/br/', reference: reference(`${tag}-conv-${n}`, tenant), userId: requesterId,
    })
  }
})

afterAll(async () => {
  await prisma.teamsConversation.deleteMany({ where: { conversation_id: { startsWith: tag } } })
  await prisma.user.deleteMany({ where: { id: { in: [requesterId, withoutTeamsId] } } })
})

describe('isPublicAgentReply', () => {
  it('só resposta pública da equipe, fora do chat ao vivo e de outra pessoa', () => {
    expect(isPublicAgentReply(event())).toBe(true)
    expect(isPublicAgentReply(event({ type: 'internal' }))).toBe(false)
    expect(isPublicAgentReply(event({ type: 'user' }))).toBe(false)
    expect(isPublicAgentReply(event({ authorId: 'system' }))).toBe(false)
    expect(isPublicAgentReply(event({ authorId: '00000000-0000-0000-0000-000000000000' }))).toBe(false)
    expect(isPublicAgentReply(event({ authorId: requesterId }))).toBe(false)
    expect(isPublicAgentReply(event({ isRealtime: true }))).toBe(false)
    expect(isPublicAgentReply(event({ skipRequester: true }))).toBe(false)
  })
})

describe('notifyAgentReply', () => {
  it('manda o card "o analista respondeu" na conversa salva do tenant liberado', async () => {
    const { adapter, continueConversation, sent } = fakeAdapter()
    expect(await notifyAgentReply(event(), { adapter, config })).toBe(1)

    expect(continueConversation).toHaveBeenCalledTimes(1)
    const [appId, ref] = continueConversation.mock.calls[0]
    expect(appId).toBe('bot-app-id')
    expect(ref).toMatchObject({ conversation: { id: `${tag}-conv-1`, tenantId: TENANT }, serviceUrl: 'https://smba.trafficmanager.net/br/' })

    const card = sent[0].attachments[0].content
    expect(card.body[0].text).toBe('Ana Analista respondeu o chamado INC-55')
    expect(JSON.stringify(card)).toContain('Pode reiniciar o cliente da VPN e testar de novo?')
    expect(JSON.stringify(card)).not.toContain('<p>')
    expect(card.actions[0]).toMatchObject({ title: 'Responder', data: { acao: 'responder', ticketId: 'ticket-1' } })
    expect(card.actions[1]).toMatchObject({ type: 'Action.OpenUrl', url: 'https://portal.test/c/ticket-1' })
  })

  it('nota interna e mensagem do próprio solicitante não avisam', async () => {
    const { adapter, continueConversation } = fakeAdapter()
    expect(await notifyAgentReply(event({ type: 'internal' }), { adapter, config })).toBe(0)
    expect(await notifyAgentReply(event({ authorId: requesterId, type: 'user' }), { adapter, config })).toBe(0)
    expect(continueConversation).not.toHaveBeenCalled()
  })

  it('sem conversa com o bot ou com o bot desligado não faz nada', async () => {
    const { adapter, continueConversation } = fakeAdapter()
    const noTeams = event({ ticket: { id: 't2', display_number: 'INC-56', user_id: withoutTeamsId } })
    expect(await notifyAgentReply(noTeams, { adapter, config })).toBe(0)
    expect(await notifyAgentReply(event(), { adapter: null, config })).toBe(0)
    expect(continueConversation).not.toHaveBeenCalled()
  })

  it('falha do Teams só vai para o log: não derruba a resposta do analista', async () => {
    const { adapter } = fakeAdapter(true)
    await expect(notifyAgentReply(event(), { adapter, config })).resolves.toBe(0)
  })
})
