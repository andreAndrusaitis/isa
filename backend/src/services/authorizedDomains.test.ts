import { describe, it, expect, beforeEach } from 'vitest'
import prisma from '../config/prisma'
import { AuthorizedDomainService } from './authorizedDomains'

describe('AuthorizedDomainService', () => {
  let orgId: string
  let otherOrgId: string

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `Org Domains Test ${Date.now()}`, domains: [] },
    })
    orgId = org.id
    const other = await prisma.organization.create({
      data: { name: `Org Domains Test B ${Date.now()}`, domains: [] },
    })
    otherOrgId = other.id
  })

  it('cria um domínio autorizado normalizado (minúsculo, sem @)', async () => {
    const created = await AuthorizedDomainService.create(orgId, 'Empresa.COM.BR')
    expect(created.domain).toBe('empresa.com.br')
    expect(created.org_id).toBe(orgId)
    expect(created.active).toBe(true)
  })

  it('adiciona o domínio autorizado aos domínios da organização, sem duplicar', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { domains: ['ja-existe.com'] } })
    await AuthorizedDomainService.create(orgId, 'nova.com')
    await AuthorizedDomainService.create(orgId, 'ja-existe.com')
    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    expect(org?.domains).toEqual(['ja-existe.com', 'nova.com'])
  })

  it('rejeita domínio em formato inválido', async () => {
    await expect(AuthorizedDomainService.create(orgId, 'nao-e-dominio')).rejects.toThrow()
  })

  it('rejeita domínio duplicado mesmo em organizações diferentes', async () => {
    await AuthorizedDomainService.create(orgId, 'duplicado.com')
    await expect(AuthorizedDomainService.create(otherOrgId, 'duplicado.com')).rejects.toThrow()
  })

  it('lista apenas os domínios da organização informada', async () => {
    await AuthorizedDomainService.create(orgId, 'dominio-a.com')
    await AuthorizedDomainService.create(otherOrgId, 'dominio-b.com')

    const list = await AuthorizedDomainService.listByOrg(orgId)
    expect(list).toHaveLength(1)
    expect(list[0].domain).toBe('dominio-a.com')
  })

  it('alterna active via setActive', async () => {
    const created = await AuthorizedDomainService.create(orgId, 'toggle.com')
    const updated = await AuthorizedDomainService.setActive(orgId, created.id, false)
    expect(updated.active).toBe(false)
  })

  it('remove um domínio', async () => {
    const created = await AuthorizedDomainService.create(orgId, 'remover.com')
    await AuthorizedDomainService.delete(orgId, created.id)
    const list = await AuthorizedDomainService.listByOrg(orgId)
    expect(list).toHaveLength(0)
  })

  it('rejeita setActive/delete quando o domínio pertence a outra organização (IDOR)', async () => {
    const created = await AuthorizedDomainService.create(orgId, 'protegido.com')
    await expect(AuthorizedDomainService.setActive(otherOrgId, created.id, false)).rejects.toThrow()
    await expect(AuthorizedDomainService.delete(otherOrgId, created.id)).rejects.toThrow()
  })

  it('rejeita criação de domínio para organização inexistente', async () => {
    await expect(AuthorizedDomainService.create('org-inexistente-id', 'orfao.com')).rejects.toThrow()
  })
})
