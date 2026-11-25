import { describe, it, expect, beforeEach } from 'vitest'
import prisma from '../config/prisma'
import { createUser, updateUser } from './users'
import bcrypt from 'bcryptjs'

describe('updateUser — alteração do método de autenticação (SSO vs Local)', () => {
  let testOrgId: string

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `Org Auth Test ${Date.now()}`, domains: [] },
    })
    testOrgId = org.id
  })

  it('impede alterar de Microsoft SSO para Senha Local sem fornecer uma senha', async () => {
    const user = await createUser({
      name: 'SSO User',
      email: `sso-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      authProvider: 'microsoft',
    } as any)

    await expect(
      updateUser(user.id, { authProvider: 'local' })
    ).rejects.toThrow('Senha de no mínimo 6 caracteres é obrigatória ao alterar para autenticação local.')
  })

  it('impede alterar de Microsoft SSO para Senha Local com senha menor que 6 caracteres', async () => {
    const user = await createUser({
      name: 'SSO User 2',
      email: `sso2-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      authProvider: 'microsoft',
    } as any)

    await expect(
      updateUser(user.id, { authProvider: 'local', password: '123' })
    ).rejects.toThrow()
  })

  it('altera com sucesso de Microsoft SSO para Senha Local com senha válida e ativa must_change_password', async () => {
    const user = await createUser({
      name: 'SSO User 3',
      email: `sso3-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      authProvider: 'microsoft',
    } as any)

    const updated = await updateUser(user.id, {
      authProvider: 'local',
      password: 'novaSenhaForte123',
    })

    expect(updated.auth_provider).toBe('local')
    expect(updated.authProvider).toBe('local')
    expect(updated.must_change_password).toBe(true)

    const fresh = await prisma.user.findUnique({ where: { id: user.id } })
    expect(fresh?.password).not.toBeNull()
    const match = await bcrypt.compare('novaSenhaForte123', fresh!.password!)
    expect(match).toBe(true)
  })

  it('altera com sucesso de Senha Local para Microsoft SSO, limpando a senha e sessões', async () => {
    const user = await createUser({
      name: 'Local User',
      email: `local-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      authProvider: 'local',
      password: 'senhaInicial123',
    } as any)

    // Simula um refresh token existente
    await prisma.refreshToken.create({
      data: {
        token: `token-${Date.now()}`,
        user_id: user.id,
        expires_at: new Date(Date.now() + 100000),
      },
    })

    const updated = await updateUser(user.id, {
      authProvider: 'microsoft',
    })

    expect(updated.auth_provider).toBe('microsoft')
    expect(updated.authProvider).toBe('microsoft')
    expect(updated.password).toBeNull()
    expect(updated.must_change_password).toBe(false)

    // Garante que o refresh token foi revogado
    const remainingTokens = await prisma.refreshToken.count({ where: { user_id: user.id } })
    expect(remainingTokens).toBe(0)
  })

  it('permite que conta Local edite outros dados sem exigir redigitar a senha', async () => {
    const user = await createUser({
      name: 'Local User Persist',
      email: `localpers-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      authProvider: 'local',
      password: 'senhaAntiga123',
    } as any)

    const updated = await updateUser(user.id, {
      name: 'Local User Persist Renamed',
      authProvider: 'local',
    })

    expect(updated.name).toBe('Local User Persist Renamed')
    expect(updated.auth_provider).toBe('local')

    const fresh = await prisma.user.findUnique({ where: { id: user.id } })
    const match = await bcrypt.compare('senhaAntiga123', fresh!.password!)
    expect(match).toBe(true)
  })
})
