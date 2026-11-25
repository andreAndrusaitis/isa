import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// Grava em banco real: rodar só contra o banco descartável (127.0.0.1:5434).
import prisma from '../../config/prisma'
import {
  addTokens, appendMessages, clearPending, findByConversationId, findByUser, getOrCreate,
  readHistory, readPending, setPending, type TeamsConversationReference,
} from './conversationStore'

const tag = `teamsconv-${Date.now()}`
let userId = ''

const ref = (conversationId: string, tenantId = `${tag}-tenant`): TeamsConversationReference => ({
  conversation: { id: conversationId, tenantId, conversationType: 'personal' },
  serviceUrl: 'https://smba.trafficmanager.net/br/',
  channelId: 'msteams',
  user: { id: '29:user', aadObjectId: `${tag}-aad` },
  bot: { id: '28:bot', name: 'ISA' },
})

const input = (n: number, tenantId = `${tag}-tenant`) => ({
  conversationId: `${tag}-conv-${n}`,
  tenantId,
  aadObjectId: `${tag}-aad`,
  serviceUrl: 'https://smba.trafficmanager.net/br/',
  reference: ref(`${tag}-conv-${n}`, tenantId),
  userId,
})

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: tag, email: `${tag}@t.local`, role: 'user', auth_provider: 'local', active: true } })).id
})

afterAll(async () => {
  await prisma.teamsConversation.deleteMany({ where: { conversation_id: { startsWith: tag } } })
  await prisma.user.deleteMany({ where: { id: userId } })
})

describe('getOrCreate', () => {
  it('cria na primeira atividade e atualiza referência/service_url nas seguintes, sem duplicar', async () => {
    const created = await getOrCreate(input(1))
    expect(created).toMatchObject({ conversation_id: `${tag}-conv-1`, user_id: userId, tokens_used: 0, pending_action: null, history: [] })

    const again = await getOrCreate({ ...input(1), serviceUrl: 'https://smba.trafficmanager.net/amer/', userId: null })
    expect(again.id).toBe(created.id)
    expect(again.service_url).toBe('https://smba.trafficmanager.net/amer/')
    // userId ausente não desvincula o usuário já resolvido.
    expect(again.user_id).toBe(userId)
    expect((again.conversation_reference as any).conversation.id).toBe(`${tag}-conv-1`)
    expect(await prisma.teamsConversation.count({ where: { conversation_id: `${tag}-conv-1` } })).toBe(1)
  })

  it('aceita conversa sem usuário resolvido', async () => {
    const c = await getOrCreate({ ...input(2), userId: undefined })
    expect(c.user_id).toBeNull()
  })
})

describe('appendMessages', () => {
  it('acrescenta em ordem e mantém só as últimas N', async () => {
    await getOrCreate(input(3))
    await appendMessages(`${tag}-conv-3`, [{ role: 'user', content: 'm1' }, { role: 'assistant', content: 'm2' }], 3)
    const history = await appendMessages(`${tag}-conv-3`, [{ role: 'user', content: 'm3' }, { role: 'assistant', content: 'm4' }], 3)
    expect(history.map(m => m.content)).toEqual(['m2', 'm3', 'm4'])
    expect(history[0]).toMatchObject({ role: 'assistant', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })

    const row = await findByConversationId(`${tag}-conv-3`)
    expect(readHistory(row!).map(m => m.content)).toEqual(['m2', 'm3', 'm4'])
    expect(row!.last_message_at).toBeInstanceOf(Date)
  })

  it('usa 20 por padrão e não perde mensagens em chamadas simultâneas', async () => {
    await getOrCreate(input(4))
    await Promise.all(Array.from({ length: 25 }, (_, i) => appendMessages(`${tag}-conv-4`, [{ role: 'user', content: `c${i}` }])))
    const row = await findByConversationId(`${tag}-conv-4`)
    const history = readHistory(row!)
    expect(history).toHaveLength(20)
    expect(new Set(history.map(m => m.content)).size).toBe(20)
  })

  it('preserva o "at" informado e recusa limite inválido ou conversa inexistente', async () => {
    await getOrCreate(input(5))
    const [m] = await appendMessages(`${tag}-conv-5`, [{ role: 'user', content: 'x', at: '2026-11-01T10:00:00.000Z' }])
    expect(m.at).toBe('2026-11-01T10:00:00.000Z')
    await expect(appendMessages(`${tag}-conv-5`, [], 0)).rejects.toThrow('limit')
    await expect(appendMessages(`${tag}-nao-existe`, [{ role: 'user', content: 'x' }])).rejects.toThrow('não encontrada')
  })
})

describe('pendente e tokens', () => {
  it('setPending/clearPending e addTokens acumulando', async () => {
    await getOrCreate(input(6))
    const pending = { tool: 'abrir_chamado', input: { title: 'VPN' }, summary: 'Abrir chamado "VPN"' }
    await setPending(`${tag}-conv-6`, pending)
    expect(readPending((await findByConversationId(`${tag}-conv-6`))!)).toEqual(pending)

    await clearPending(`${tag}-conv-6`)
    const cleared = await findByConversationId(`${tag}-conv-6`)
    expect(cleared!.pending_action).toBeNull()
    expect(readPending(cleared!)).toBeNull()

    expect(await addTokens(`${tag}-conv-6`, 120)).toBe(120)
    expect(await addTokens(`${tag}-conv-6`, 30.4)).toBe(150)
    expect(await addTokens(`${tag}-conv-6`, -5)).toBe(150)
  })
})

describe('findByUser', () => {
  it('devolve a conversa mais recente de cada tenant do usuário', async () => {
    const tA = `${tag}-tA`
    const tB = `${tag}-tB`
    await getOrCreate(input(10, tA))
    await getOrCreate(input(11, tA))
    await getOrCreate(input(12, tB))
    await appendMessages(`${tag}-conv-10`, [{ role: 'user', content: 'antiga' }])
    await appendMessages(`${tag}-conv-11`, [{ role: 'user', content: 'nova' }])
    await appendMessages(`${tag}-conv-12`, [{ role: 'user', content: 'b' }])

    const all = (await findByUser(userId)).filter(c => c.tenant_id === tA || c.tenant_id === tB)
    expect(all.map(c => c.conversation_id).sort()).toEqual([`${tag}-conv-11`, `${tag}-conv-12`])

    const onlyB = await findByUser(userId, tB)
    expect(onlyB.map(c => c.conversation_id)).toEqual([`${tag}-conv-12`])
    expect(await findByUser('00000000-0000-0000-0000-000000000000')).toEqual([])
  })

  it('apagar o usuário mantém a conversa e zera o vínculo (SET NULL)', async () => {
    const other = await prisma.user.create({ data: { name: `${tag}-b`, email: `${tag}-b@t.local`, role: 'user', auth_provider: 'local', active: true } })
    await getOrCreate({ ...input(20), userId: other.id })
    await prisma.user.delete({ where: { id: other.id } })
    expect((await findByConversationId(`${tag}-conv-20`))!.user_id).toBeNull()
  })
})
