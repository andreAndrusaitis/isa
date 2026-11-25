import { describe, it, expect, beforeEach, vi } from 'vitest'
import prisma from '../config/prisma'
import { createUser, deleteUser } from './users'
import * as webhookEvents from './webhookEvents'
import * as auditService from './audit'

vi.mock('./email/mailer', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
}))

describe('deleteUser — auditoria, revogação e eventos do sistema', () => {
  let testOrgId: string
  let adminUser: any

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `Org Delete Test ${Date.now()}`, domains: [] },
    })
    testOrgId = org.id

    adminUser = await createUser({
      name: 'Admin Executor',
      email: `admin-${Date.now()}@example.com`,
      role: 'admin',
      orgId: testOrgId,
      password: 'adminPassword123',
      authProvider: 'local',
    } as any)
  })

  it('exclui usuário, grava snapshot forense completo no AuditLog e emite webhook user.deleted', async () => {
    const webhookSpy = vi.spyOn(webhookEvents, 'emitWebhookEvent')
    const auditSpy = vi.spyOn(auditService, 'createAuditLog')

    const targetUser = await createUser({
      name: 'João da Silva',
      email: `joao-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      password: 'password123',
      authProvider: 'local',
    } as any)

    // Cria refresh tokens fictícios para simular sessões ativas
    await prisma.refreshToken.create({
      data: {
        token: `hashed-token-${Date.now()}`,
        user_id: targetUser.id,
        expires_at: new Date(Date.now() + 3600000),
      },
    })

    const initialTokens = await prisma.refreshToken.count({ where: { user_id: targetUser.id } })
    expect(initialTokens).toBe(1)

    const auditInfo = {
      actorId: adminUser.id,
      ip: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    }

    const deleted = await deleteUser(targetUser.id, auditInfo)

    // 1. Valida soft-delete e alteração de e-mail
    expect(deleted.active).toBe(false)
    expect(deleted.deleted_at).not.toBeNull()
    expect(deleted.email).toContain('+deleted-')

    // 2. Valida revogação de tokens de sessão
    const remainingTokens = await prisma.refreshToken.count({ where: { user_id: targetUser.id } })
    expect(remainingTokens).toBe(0)

    // 3. Valida log de auditoria com snapshot completo
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: adminUser.id,
        action: 'DELETE_USER',
        resource: 'USER',
        details: expect.objectContaining({
          deletedUserId: targetUser.id,
          deletedUserName: 'João da Silva',
          deletedUserEmail: targetUser.email,
          deletedUserRole: 'user',
          deletedUserOrgId: testOrgId,
          actorId: adminUser.id,
          actorName: 'Admin Executor',
          actorEmail: adminUser.email,
          actorRole: 'admin',
        }),
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      })
    )

    // 4. Valida emissão do evento webhook 'user.deleted'
    expect(webhookSpy).toHaveBeenCalledWith(
      'user.deleted',
      expect.objectContaining({
        user: expect.objectContaining({
          id: targetUser.id,
          name: 'João da Silva',
          email: targetUser.email,
          role: 'user',
          active: false,
        }),
        actor: expect.objectContaining({
          id: adminUser.id,
          name: 'Admin Executor',
          email: adminUser.email,
          role: 'admin',
        }),
      })
    )

    webhookSpy.mockRestore()
    auditSpy.mockRestore()
  })

  it('exclui usuário com sucesso mesmo sem ator de auditoria informado', async () => {
    const targetUser = await createUser({
      name: 'Maria Sem Auditoria',
      email: `maria-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      password: 'password123',
      authProvider: 'local',
    } as any)

    const deleted = await deleteUser(targetUser.id)

    expect(deleted.active).toBe(false)
    expect(deleted.deleted_at).not.toBeNull()
    expect(deleted.email).toContain('+deleted-')
  })

  it('permite buscar registros de auditoria pelo nome ou email do usuário excluído', async () => {
    const uniqueDeletedName = `Usuario Unico ${Date.now()}`
    const uniqueDeletedEmail = `unico-${Date.now()}@exemplo.com`

    const targetUser = await createUser({
      name: uniqueDeletedName,
      email: uniqueDeletedEmail,
      role: 'user',
      orgId: testOrgId,
      password: 'password123',
      authProvider: 'local',
    } as any)

    await deleteUser(targetUser.id, {
      actorId: adminUser.id,
      ip: '10.0.0.1',
    })

    const searchByName = await auditService.getAuditLogs({ search: uniqueDeletedName })
    expect(searchByName.items.some((log: any) => log.details?.deletedUserName === uniqueDeletedName)).toBe(true)

    const searchByEmail = await auditService.getAuditLogs({ search: uniqueDeletedEmail })
    expect(searchByEmail.items.some((log: any) => log.details?.deletedUserEmail === uniqueDeletedEmail)).toBe(true)
  })
})
