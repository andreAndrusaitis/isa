import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import prisma from '../config/prisma'
import { TicketController } from './tickets'

// Cadastro rápido dispara e-mail de boas-vindas — nunca enviar de verdade no teste.
vi.mock('../services/email/mailer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/email/mailer')>()),
  sendWelcomeEmail: vi.fn(async () => ({ status: 'SKIPPED_ACS_NOT_CONFIGURED' as const })),
}))

const SUFFIX = `proactive-ctrl-${Date.now()}`
let inScopeOrgId: string
let outOfScopeOrgId: string
let agentId: string
const createdTicketIds: string[] = []
const createdUserIds: string[] = []

function makeReqRes(body: any, user: any) {
  const req: any = { body, user, ip: '127.0.0.1', headers: {}, socket: {} }
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const res: any = { status, json }
  const next = vi.fn()
  return { req, res, next, json, status }
}

beforeAll(async () => {
  const [inScope, outOfScope] = await Promise.all([
    prisma.organization.create({ data: { name: `InScope ${SUFFIX}` } }),
    prisma.organization.create({ data: { name: `OutOfScope ${SUFFIX}` } }),
  ])
  inScopeOrgId = inScope.id
  outOfScopeOrgId = outOfScope.id
  const agent = await prisma.user.create({ data: { name: `Ag ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })
  agentId = agent.id
  await prisma.userOrgScope.create({ data: { user_id: agentId, org_id: inScopeOrgId } })
})

afterAll(async () => {
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: createdTicketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } }).catch(() => {})
  await prisma.userOrgScope.deleteMany({ where: { user_id: agentId } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [agentId, ...createdUserIds] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [agentId, ...createdUserIds] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: { in: [inScopeOrgId, outOfScopeOrgId] } } }).catch(() => {})
})

describe('TicketController.create — validação de proactiveOrgId', () => {
  it('rejeita quando onBehalfOfUserId e proactiveOrgId vêm juntos', async () => {
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', onBehalfOfUserId: 'x', proactiveOrgId: inScopeOrgId },
      { sub: agentId, role: 'agent', orgId: null },
    )
    await TicketController.create(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(next.mock.calls[0][0].code).toBe('PROACTIVE_AND_ON_BEHALF_CONFLICT')
  })

  it('rejeita organização inexistente', async () => {
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', proactiveOrgId: 'does-not-exist' },
      { sub: agentId, role: 'agent', orgId: null },
    )
    await TicketController.create(req, res, next)
    expect(next.mock.calls[0][0].code).toBe('ORG_NOT_FOUND')
  })

  it('rejeita empresa fora do escopo do ator', async () => {
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', proactiveOrgId: outOfScopeOrgId },
      { sub: agentId, role: 'agent', orgId: null },
    )
    await TicketController.create(req, res, next)
    expect(next.mock.calls[0][0].code).toBe('ON_BEHALF_OUT_OF_SCOPE')
  })

  it('aceita empresa dentro do escopo e cria o chamado', async () => {
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', proactiveOrgId: inScopeOrgId },
      { sub: agentId, role: 'agent', orgId: null },
    )
    await TicketController.create(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(201)
    const created = res.json.mock.calls[0][0].data
    createdTicketIds.push(created.id)
    expect(created.userId).toBe(agentId)
    expect(created.orgId).toBe(inScopeOrgId)
  })
})

describe('TicketController.create — cadastro rápido de cliente (newRequester)', () => {
  const agent = () => ({ sub: agentId, role: 'agent', orgId: null })

  it('cria o cliente local na empresa e abre o chamado em nome dele', async () => {
    const email = `Novo-${SUFFIX}@t.com`
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', newRequester: { name: 'Cliente Novo', email, orgId: inScopeOrgId } },
      agent(),
    )
    await TicketController.create(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(201)
    const created = res.json.mock.calls[0][0].data
    createdTicketIds.push(created.id)
    const u = await prisma.user.findFirst({ where: { email: email.toLowerCase() } })
    expect(u).toBeTruthy()
    createdUserIds.push(u!.id)
    expect(u!.role).toBe('user')
    expect(u!.org_id).toBe(inScopeOrgId)
    expect(u!.auth_provider).toBe('local')
    expect(u!.must_change_password).toBe(true)
    expect(created.userId).toBe(u!.id)
    expect(created.orgId).toBe(inScopeOrgId)
    const log = await prisma.auditLog.findFirst({ where: { user_id: agentId, action: 'USER_QUICK_CREATED' } })
    expect((log?.details as any)?.createdUserId).toBe(u!.id)
  })

  it('domínio autorizado da empresa → conta SSO (microsoft) sem senha', async () => {
    const domain = `sso-${SUFFIX}.com`.toLowerCase()
    await prisma.authorizedDomain.create({ data: { domain, org_id: inScopeOrgId } })
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', newRequester: { name: 'Cliente SSO', email: `fulano@${domain}`, orgId: inScopeOrgId } },
      agent(),
    )
    await TicketController.create(req, res, next)
    expect(next).not.toHaveBeenCalled()
    createdTicketIds.push(res.json.mock.calls[0][0].data.id)
    const u = await prisma.user.findFirst({ where: { email: `fulano@${domain}` } })
    createdUserIds.push(u!.id)
    expect(u!.auth_provider).toBe('microsoft')
    expect(u!.password).toBeNull()
    await prisma.authorizedDomain.deleteMany({ where: { domain } })
  })

  it('e-mail já cadastrado (qualquer caixa) → 409 sem duplicar', async () => {
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', newRequester: { name: 'Dup', email: `AG-${SUFFIX}@T.COM`, orgId: inScopeOrgId } },
      agent(),
    )
    await TicketController.create(req, res, next)
    expect(next.mock.calls[0][0].statusCode).toBe(409)
    expect(next.mock.calls[0][0].code).toBe('REQUESTER_EMAIL_EXISTS')
  })

  it('empresa fora da carteira → 403', async () => {
    const email = `fora-${SUFFIX}@t.com`
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', newRequester: { name: 'Fora', email, orgId: outOfScopeOrgId } },
      agent(),
    )
    await TicketController.create(req, res, next)
    expect(next.mock.calls[0][0].statusCode).toBe(403)
    expect(next.mock.calls[0][0].code).toBe('ON_BEHALF_OUT_OF_SCOPE')
    expect(await prisma.user.findFirst({ where: { email } })).toBeNull()
  })

  it('perfil sem permissão (usuário final) → 403', async () => {
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', newRequester: { name: 'X', email: `x-${SUFFIX}@t.com`, orgId: inScopeOrgId } },
      { sub: agentId, role: 'user', orgId: inScopeOrgId },
    )
    await TicketController.create(req, res, next)
    expect(next.mock.calls[0][0].statusCode).toBe(403)
    expect(next.mock.calls[0][0].code).toBe('ON_BEHALF_FORBIDDEN')
  })

  it('não combina com onBehalfOfUserId', async () => {
    const { req, res, next } = makeReqRes(
      { title: 't', description: 'd', onBehalfOfUserId: agentId, newRequester: { name: 'X', email: `y-${SUFFIX}@t.com`, orgId: inScopeOrgId } },
      agent(),
    )
    await TicketController.create(req, res, next)
    expect(next.mock.calls[0][0].code).toBe('NEW_REQUESTER_CONFLICT')
  })
})
