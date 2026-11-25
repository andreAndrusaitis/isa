import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'

vi.mock('./email/mailer', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendWelcomeEmail: vi.fn(async () => ({ status: 'SUCCESS' as const })),
}))
import { createTicket, createExternalUser, updateExternalUser } from './externalApi'
import type { ApiKeyContext } from '../middlewares/apiKeyAuth'

// Banco real. A key está travada na empresa A; a B é de outro cliente.
const S = `lock-${Date.now()}`
const domainA = `a-${S}.example.com`
const domainB = `b-${S}.example.com`
const sharedDomain = `dup-${S}.example.com`
const outOfScope = { statusCode: 404, code: 'API_KEY_OUT_OF_SCOPE' }

let locked: ApiKeyContext
let multi: ApiKeyContext
const orgs: Record<string, string> = {}
const tickets: string[] = []
let seq = 0

const requestId = () => `${S}-${++seq}`
const ticketBody = (email: string) => ({
  external_request_id: requestId(), requester: { email }, ticket: { title: `T ${S}`, description: 'Descrição do teste' },
})
const countTickets = (userId: string) => prisma.ticket.count({ where: { user_id: userId } })

async function mkUser(email: string, org_id: string | null, role: 'user' | 'agent' = 'user') {
  return prisma.user.create({ data: { name: email.split('@')[0], email, password: 'hash-de-fixture', role, org_id } })
}

beforeAll(async () => {
  orgs.a = (await prisma.organization.create({ data: { name: `A ${S}`, domains: [domainA] } })).id
  orgs.b = (await prisma.organization.create({ data: { name: `B ${S}`, domains: [domainB] } })).id
  // A mais nova entra primeiro: sem ordenação, a ordem física devolveria ela.
  orgs.nova = (await prisma.organization.create({ data: { name: `Nova ${S}`, domains: [sharedDomain], created_at: new Date('2024-01-01') } })).id
  orgs.antiga = (await prisma.organization.create({ data: { name: `Antiga ${S}`, domains: [sharedDomain], created_at: new Date('2020-01-01') } })).id
  const lockedKey = await prisma.apiKey.create({ data: { name: `L ${S}`, key_hash: `l-${S}`, key_prefix: 'isakey_lock', scopes: [], org_id: orgs.a } })
  const multiKey = await prisma.apiKey.create({ data: { name: `M ${S}`, key_hash: `m-${S}`, key_prefix: 'isakey_mult', scopes: [], org_id: null } })
  locked = { id: lockedKey.id, scopes: ['create_ticket', 'create_user', 'update_user'], org_id: orgs.a }
  multi = { id: multiKey.id, scopes: ['create_ticket', 'update_user'], org_id: null }
})

afterAll(async () => {
  await prisma.surveyInstance.deleteMany({ where: { ticket_id: { in: tickets } } }).catch(() => undefined)
  await prisma.ticket.deleteMany({ where: { id: { in: tickets } } }).catch(() => undefined)
  await prisma.user.deleteMany({ where: { email: { endsWith: S + '.example.com' } } }).catch(() => undefined)
  await prisma.apiRequestLog.deleteMany({ where: { api_key_id: { in: [locked.id, multi.id] } } }).catch(() => undefined)
  await prisma.apiKey.deleteMany({ where: { id: { in: [locked.id, multi.id] } } }).catch(() => undefined)
  await prisma.organization.deleteMany({ where: { id: { in: Object.values(orgs) } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('createTicket com key travada', () => {
  it('não abre chamado para solicitante de outra empresa', async () => {
    const vitima = await mkUser(`vitima@${domainB}`, orgs.b)
    await expect(createTicket(locked, ticketBody(vitima.email), {})).rejects.toMatchObject(outOfScope)
    expect(await countTickets(vitima.id)).toBe(0)
  })

  it('não adota quem está sem empresa', async () => {
    const semEmpresa = await mkUser(`sem-empresa@${domainB}`, null)
    await expect(createTicket(locked, ticketBody(semEmpresa.email), {})).rejects.toMatchObject(outOfScope)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: semEmpresa.id } })).org_id).toBeNull()
  })

  it('segue abrindo para solicitante da empresa dela', async () => {
    const cliente = await mkUser(`cliente@${domainA}`, orgs.a)
    const result = await createTicket(locked, ticketBody(cliente.email), {})
    const body = result.body as { resource_id: string; ticket: { org_id: string } }
    tickets.push(body.resource_id)
    expect(result.statusCode).toBe(201)
    expect(body.ticket.org_id).toBe(orgs.a)
  })

  it('segue criando solicitante novo na empresa dela', async () => {
    const result = await createTicket(locked, ticketBody(`novo@${domainA}`), {})
    const body = result.body as { resource_id: string }
    tickets.push(body.resource_id)
    expect((await prisma.user.findUniqueOrThrow({ where: { email: `novo@${domainA}` } })).org_id).toBe(orgs.a)
  })
})

describe('createTicket com key multi-empresa', () => {
  it('não muda: usa a empresa do solicitante e adota quem está sem empresa', async () => {
    const vitima = await mkUser(`multi@${domainB}`, orgs.b)
    const a = await createTicket(multi, ticketBody(vitima.email), {})
    tickets.push((a.body as { resource_id: string }).resource_id)
    expect((a.body as any).ticket.org_id).toBe(orgs.b)

    const semEmpresa = await mkUser(`multi-sem@${domainB}`, null)
    const b = await createTicket(multi, ticketBody(semEmpresa.email), {})
    tickets.push((b.body as { resource_id: string }).resource_id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: semEmpresa.id } })).org_id).toBe(orgs.b)
  })

  it('domínio em duas empresas resolve sempre para a mais antiga', async () => {
    const result = await createTicket(multi, ticketBody(`pessoa@${sharedDomain}`), {})
    tickets.push((result.body as { resource_id: string }).resource_id)
    expect((result.body as any).ticket.org_id).toBe(orgs.antiga)
  })
})

describe('updateExternalUser com key travada', () => {
  const change = (organization_id: string | null) => ({ external_request_id: requestId(), changes: { organization_id } })

  it('não move usuário para outra empresa', async () => {
    const user = await mkUser(`mover@${domainA}`, orgs.a)
    await expect(updateExternalUser(locked, user.id, change(orgs.b), {})).rejects.toMatchObject(outOfScope)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).org_id).toBe(orgs.a)
  })

  it('não tira o usuário da empresa', async () => {
    const user = await mkUser(`tirar@${domainA}`, orgs.a)
    await expect(updateExternalUser(locked, user.id, change(null), {})).rejects.toMatchObject(outOfScope)
  })

  it('aceita a própria empresa e os demais campos', async () => {
    const user = await mkUser(`editar@${domainA}`, orgs.a)
    const result = await updateExternalUser(locked, user.id, { external_request_id: requestId(), changes: { organization_id: orgs.a, name: 'Novo Nome' } }, {})
    expect(result.statusCode).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('Novo Nome')
  })

  it('key multi-empresa segue movendo', async () => {
    const user = await mkUser(`multi-mover@${domainA}`, orgs.a)
    await updateExternalUser(multi, user.id, change(orgs.b), {})
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).org_id).toBe(orgs.b)
  })

  it('createExternalUser segue preso à empresa da key', async () => {
    const result = await createExternalUser(locked, { external_request_id: requestId(), name: 'Criado', email: `criado@${domainA}`, organization_id: orgs.b }, {})
    expect(result.statusCode).toBe(201)
    expect((await prisma.user.findUniqueOrThrow({ where: { email: `criado@${domainA}` } })).org_id).toBe(orgs.a)
  })
})
