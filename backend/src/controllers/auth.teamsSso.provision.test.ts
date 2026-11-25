import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '../config/prisma'

// Só a assinatura Microsoft é simulada: a política de conta (domínio autorizado,
// criação automática, emissão da sessão) roda de verdade contra o banco de teste.
const mocks = vi.hoisted(() => ({ verifyTeamsSsoToken: vi.fn() }))
vi.mock('../services/teamsSso', () => ({ verifyTeamsSsoToken: mocks.verifyTeamsSsoToken }))

import { teamsSsoLogin } from './auth'

const stamp = Date.now()
const activeDomain = `teams-ativo-${stamp}.test`
const inactiveDomain = `teams-inativo-${stamp}.test`
const bearer = `teams.bearer.${stamp}`
const orgIds: string[] = []

function request() {
  return { get: vi.fn().mockReturnValue(`Bearer ${bearer}`) }
}

function response() {
  const res = { status: vi.fn(), json: vi.fn(), cookie: vi.fn() }
  res.status.mockReturnValue(res)
  return res
}

async function auditsFor(email: string) {
  return prisma.auditLog.findMany({ where: { details: { path: ['email'], equals: email } }, orderBy: { created_at: 'asc' } })
}

describe('teamsSsoLogin com a política de SSO Microsoft', () => {
  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: `Org Teams SSO ${stamp}`, domains: [], active: true } })
    orgIds.push(org.id)
    await prisma.authorizedDomain.create({ data: { domain: activeDomain, org_id: org.id, active: true } })
    await prisma.authorizedDomain.create({ data: { domain: inactiveDomain, org_id: org.id, active: false } })
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { OR: [{ email: { endsWith: `@${activeDomain}` } }, { email: { endsWith: `@${inactiveDomain}` } }] }, select: { id: true } })
    const userIds = users.map(u => u.id)
    await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.auditLog.deleteMany({ where: { user_id: null, details: { path: ['email'], string_ends_with: `@${inactiveDomain}` } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  })

  beforeEach(() => vi.clearAllMocks())

  it('cria automaticamente o usuário de domínio autorizado ativo e registra o login via teams', async () => {
    const email = `nova.pessoa@${activeDomain}`
    mocks.verifyTeamsSsoToken.mockResolvedValue({ email, name: 'Nova Pessoa' })
    const res = response()

    await teamsSsoLogin(request() as never, res as never)

    expect(res.status).not.toHaveBeenCalled()
    const body = res.json.mock.calls[0][0]
    expect(body.data.accessToken).toEqual(expect.any(String))
    expect(body.data.user).toMatchObject({ email, role: 'user', orgId: orgIds[0] })
    expect(res.cookie).toHaveBeenCalledWith('isa_rt', expect.any(String), expect.objectContaining({ httpOnly: true }))

    const created = await prisma.user.findUnique({ where: { email } })
    expect(created).toMatchObject({ role: 'user', auth_provider: 'microsoft', org_id: orgIds[0], password: null, active: true })

    const audits = await auditsFor(email)
    expect(audits.map(a => a.action)).toEqual(['USER_AUTO_CREATED', 'LOGIN'])
    expect(audits[1]).toMatchObject({ user_id: created!.id, details: { email, via: 'teams' } })
    expect(JSON.stringify(audits)).not.toContain(bearer)
  })

  it('reaproveita a conta já criada no login seguinte', async () => {
    const email = `nova.pessoa@${activeDomain}`
    mocks.verifyTeamsSsoToken.mockResolvedValue({ email, name: 'Nova Pessoa' })

    await teamsSsoLogin(request() as never, response() as never)

    expect(await prisma.user.count({ where: { email } })).toBe(1)
  })

  it('recusa domínio cadastrado mas inativo, sem criar usuário', async () => {
    const email = `bloqueada@${inactiveDomain}`
    mocks.verifyTeamsSsoToken.mockResolvedValue({ email, name: 'Bloqueada' })
    const res = response()

    await teamsSsoLogin(request() as never, res as never)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Acesso Microsoft não autorizado para este ISA', code: 'TEAMS_SSO_UNAUTHORIZED' })
    expect(res.cookie).not.toHaveBeenCalled()
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()

    const audits = await auditsFor(email)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'LOGIN_FAILED', details: { reason: 'TEAMS_SSO_DOMAIN_NOT_AUTHORIZED', via: 'teams' } })
    expect(JSON.stringify(audits)).not.toContain(bearer)
  })
})
