import { describe, it, expect, beforeEach } from 'vitest'
import prisma from '../config/prisma'
import { resolveOrCreateSsoUser } from './authSso'

describe('resolveOrCreateSsoUser', () => {
  let orgId: string

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `Org SSO AutoProvision ${Date.now()}`, domains: [], active: true },
    })
    orgId = org.id
  })

  it('retorna o usuário existente sem criar duplicata', async () => {
    const email = `existente-${Date.now()}@jafoi.com`
    const existing = await prisma.user.create({
      data: { name: 'Já Existe', email, role: 'user', org_id: orgId, auth_provider: 'microsoft', active: true },
    })

    const result = await resolveOrCreateSsoUser(email, { name: 'Nome Do Claim' })

    expect(result.outcome).toBe('found')
    expect(result.user?.id).toBe(existing.id)
  })

  it('cria usuário automaticamente quando domínio está autorizado e ativo', async () => {
    await prisma.authorizedDomain.create({ data: { domain: 'autorizado.com', org_id: orgId, active: true } })
    const email = `novo-${Date.now()}@autorizado.com`

    const result = await resolveOrCreateSsoUser(email, { name: 'Fulano Novo' })

    expect(result.outcome).toBe('created')
    expect(result.user?.role).toBe('user')
    expect(result.user?.auth_provider).toBe('microsoft')
    expect(result.user?.org_id).toBe(orgId)
    expect(result.user?.password).toBeNull()

    const persisted = await prisma.user.findUnique({ where: { email } })
    expect(persisted).not.toBeNull()
  })

  it('nega acesso quando o domínio não está cadastrado', async () => {
    const email = `desconhecido-${Date.now()}@naoexiste.com`

    const result = await resolveOrCreateSsoUser(email, { name: 'Ninguém' })

    expect(result.outcome).toBe('denied')
    expect(result.user).toBeNull()

    const persisted = await prisma.user.findUnique({ where: { email } })
    expect(persisted).toBeNull()
  })

  it('nega acesso quando o domínio está cadastrado mas desativado', async () => {
    await prisma.authorizedDomain.create({ data: { domain: 'desativado.com', org_id: orgId, active: false } })
    const email = `teste-${Date.now()}@desativado.com`

    const result = await resolveOrCreateSsoUser(email, { name: 'Bloqueado' })

    expect(result.outcome).toBe('denied')
    const persisted = await prisma.user.findUnique({ where: { email } })
    expect(persisted).toBeNull()
  })

  it('nega acesso quando a organização do domínio está inativa', async () => {
    const inactiveOrg = await prisma.organization.create({
      data: { name: `Org Inativa ${Date.now()}`, domains: [], active: false },
    })
    await prisma.authorizedDomain.create({ data: { domain: 'empresa-inativa.test', org_id: inactiveOrg.id, active: true } })
    const email = `teste-${Date.now()}@empresa-inativa.test`

    const result = await resolveOrCreateSsoUser(email, { name: 'Org Inativa' })

    expect(result.outcome).toBe('denied')
  })

  it('não reaproveita conta local (auth_provider diferente de microsoft) com o mesmo e-mail', async () => {
    await prisma.authorizedDomain.create({ data: { domain: 'local-existente.com', org_id: orgId, active: true } })
    const email = `local-${Date.now()}@local-existente.com`
    await prisma.user.create({
      data: { name: 'Conta Local', email, role: 'user', org_id: orgId, auth_provider: 'local', password: 'x', active: true },
    })

    const result = await resolveOrCreateSsoUser(email, { name: 'Tentando Via SSO' })

    // Domínio autorizado, mas já existe conta local com esse e-mail. User.email
    // é @unique no schema — criar uma segunda conta microsoft com o mesmo
    // e-mail violaria a constraint (e geraria um 500 cru). A decisão correta
    // é negar: mantém a conta local existente e não cria duplicidade.
    expect(result.outcome).toBe('denied')

    const stillLocal = await prisma.user.findUnique({ where: { email } })
    expect(stillLocal?.auth_provider).toBe('local')
  })
})
