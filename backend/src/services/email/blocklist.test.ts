import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '../../config/prisma'

vi.mock('./mailer', () => ({
  sendWelcomeEmail: vi.fn(async () => ({ status: 'SUCCESS' as const })),
}))
import { blockedReason, createBlock, deleteBlock, listBlocks } from './blocklist'
import { createTicket } from '../externalApi'
import type { ApiKeyContext } from '../../middlewares/apiKeyAuth'

// Admin → E-mail → Bloqueios: remetente bloqueado não abre chamado (API e caixa).
const SUFFIX = `blk${Date.now()}`
const DOMAIN = `${SUFFIX}.com`
let orgId: string
let ctx: ApiKeyContext
const blockIds: string[] = []

const block = async (kind: 'email' | 'domain', value: string, reason?: string) => {
  const row = await createBlock({ kind, value, reason }, undefined)
  blockIds.push(row.id)
  return row
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}`, domains: [DOMAIN] } })).id
  const key = await prisma.apiKey.create({ data: { name: `Key ${SUFFIX}`, key_hash: `hash-${SUFFIX}`, key_prefix: 'isakey_blkt', scopes: [], org_id: null } })
  ctx = { id: key.id, scopes: ['create_ticket'], org_id: null }
})

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } })
  await prisma.ticket.deleteMany({ where: { user_id: { in: users.map(u => u.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } })
  await prisma.emailBlock.deleteMany({ where: { id: { in: blockIds } } })
  await prisma.apiRequestLog.deleteMany({ where: { api_key_id: ctx.id } })
  await prisma.apiKey.deleteMany({ where: { id: ctx.id } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe('regras', () => {
  it('avisos automáticos (não entrega, Exchange) nunca abrem chamado', async () => {
    expect(await blockedReason('MAILER-DAEMON@qualquer.com')).toMatch(/automático/)
    expect(await blockedReason('postmaster@example.com')).toMatch(/automático/)
    expect(await blockedReason('microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@example.com')).toMatch(/Exchange/)
    expect(await blockedReason(`ana@${DOMAIN}`)).toBeNull()
  })

  it('e-mail exato bloqueia só aquele endereço (sem diferenciar maiúsculas)', async () => {
    await block('email', ` Spam@${DOMAIN.toUpperCase()} `)
    expect(await blockedReason(`spam@${DOMAIN}`)).toMatch(/e-mail spam@/)
    expect(await blockedReason(`outro@${DOMAIN}`)).toBeNull()
  })

  it('domínio bloqueia o domínio e os subdomínios, não domínios parecidos', async () => {
    const d = `promo-${SUFFIX}.net`
    await block('domain', `@${d.toUpperCase()}`)
    expect(await blockedReason(`x@${d}`)).toMatch(/domínio/)
    expect(await blockedReason(`x@mail.${d}`)).toMatch(/domínio/)
    expect(await blockedReason(`x@not${d}`)).toBeNull()
  })

  it('conta quantas vezes bloqueou', async () => {
    const row = await block('email', `conta@${DOMAIN}`)
    await blockedReason(`conta@${DOMAIN}`)
    await blockedReason(`conta@${DOMAIN}`)
    await vi.waitFor(async () => {
      const r = await prisma.emailBlock.findUniqueOrThrow({ where: { id: row.id } })
      expect(r.hits).toBe(2)
      expect(r.last_hit_at).not.toBeNull()
    })
  })

  it('valor inválido ou repetido é recusado', async () => {
    await expect(createBlock({ kind: 'email', value: 'sem-arroba' }, undefined)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createBlock({ kind: 'domain', value: 'nao é domínio' }, undefined)).rejects.toMatchObject({ statusCode: 400 })
    await block('domain', `dup-${SUFFIX}.com`)
    await expect(createBlock({ kind: 'domain', value: `DUP-${SUFFIX}.com` }, undefined)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lista com as regras fixas e exclui', async () => {
    const row = await block('email', `apagar@${DOMAIN}`)
    const list = await listBlocks()
    expect(list.data.some(r => r.id === row.id)).toBe(true)
    expect(list.system.length).toBeGreaterThan(0)
    await deleteBlock(row.id, undefined)
    expect(await blockedReason(`apagar@${DOMAIN}`)).toBeNull()
  })
})

describe('abertura pela API', () => {
  it('remetente bloqueado: 422 SENDER_BLOCKED, sem chamado e sem usuário', async () => {
    await block('email', `bloqueado@${DOMAIN}`, 'spam')
    await expect(createTicket(ctx, { requester: { email: `bloqueado@${DOMAIN}` }, ticket: { title: 'Promoção', description: 'Compre já' } }, {}))
      .rejects.toMatchObject({ statusCode: 422, code: 'SENDER_BLOCKED' })
    expect(await prisma.user.count({ where: { email: `bloqueado@${DOMAIN}` } })).toBe(0)
  })

  it('aviso de não entrega do Exchange não vira chamado', async () => {
    const exch = `microsoftexchange00ff@${DOMAIN}`
    await expect(createTicket(ctx, { requester: { email: exch }, ticket: { title: 'Não é possível entregar: x', description: 'NDR' } }, {}))
      .rejects.toMatchObject({ code: 'SENDER_BLOCKED' })
    expect(await prisma.user.count({ where: { email: exch } })).toBe(0)
  })

  it('remetente liberado continua abrindo chamado', async () => {
    const r = await createTicket(ctx, { requester: { email: `cliente@${DOMAIN}` }, ticket: { title: 'Impressora', description: 'Parou' } }, {})
    expect(r.statusCode).toBe(201)
  })
})
