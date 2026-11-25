import { describe, it, expect, beforeEach, vi } from 'vitest'
import prisma from '../config/prisma'
import { createUser, updateUser, deleteUser } from './users'
import * as socketConfig from '../config/socket'

vi.mock('./email/mailer', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
}))

describe('users socket broadcast events to users:staff', () => {
  let testOrgId: string
  let adminActor: any
  const emittedEvents: Array<{ room: string; event: string; payload: any; excluded: string[] }> = []

  beforeEach(async () => {
    emittedEvents.length = 0

    const mockIo: any = {
      to: vi.fn().mockImplementation((room: string) => {
        let excluded: string[] = []
        const chain: any = {
          to: vi.fn().mockImplementation((_secondRoom: string) => {
            return chain
          }),
          except: vi.fn().mockImplementation((rooms: string[]) => {
            excluded = rooms
            return chain
          }),
          emit: vi.fn().mockImplementation((event: string, payload: any) => {
            emittedEvents.push({ room, event, payload, excluded })
          }),
        }
        return chain
      }),
      in: vi.fn().mockReturnValue({
        disconnectSockets: vi.fn(),
      }),
    }

    vi.spyOn(socketConfig, 'getIo').mockReturnValue(mockIo)

    const org = await prisma.organization.create({
      data: { name: `Org Socket Test ${Date.now()}`, domains: [] },
    })
    testOrgId = org.id

    adminActor = await createUser({
      name: 'Admin Socket Actor',
      email: `admin-actor-${Date.now()}@example.com`,
      role: 'admin',
      orgId: testOrgId,
      password: 'AdminPassword123!',
      authProvider: 'local',
    } as any)

    emittedEvents.length = 0
  })

  it('emite user:created para a sala users:staff ao criar usuário, sem vazar hash de senha', async () => {
    const newUser = await createUser({
      name: 'Carlos Socket Test',
      email: `carlos-${Date.now()}@example.com`,
      role: 'agent',
      orgId: testOrgId,
      password: 'InitialPassword123!',
      authProvider: 'local',
    } as any, { actorId: adminActor.id })

    expect(newUser.id).toBeDefined()

    const createdEvent = emittedEvents.find(e => e.event === 'user:created')
    expect(createdEvent).toBeDefined()
    expect(createdEvent?.room).toBe('users:staff')
    expect(createdEvent?.payload.user.id).toBe(newUser.id)
    expect(createdEvent?.payload.user.name).toBe('Carlos Socket Test')
    expect(createdEvent?.payload.user.role).toBe('agent')
    expect(createdEvent?.payload.actorId).toBe(adminActor.id)
    expect((createdEvent?.payload.user as any).password).toBeUndefined()
  })

  it('emite user:updated para a sala users:staff ao atualizar dados de um usuário', async () => {
    const user = await createUser({
      name: 'Marina Update Test',
      email: `marina-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      password: 'InitialPassword123!',
      authProvider: 'local',
    } as any)

    emittedEvents.length = 0

    const updated = await updateUser(user.id, {
      name: 'Marina Atualizada',
      phone: '11987654321',
    } as any, { actorId: adminActor.id })

    expect(updated.name).toBe('Marina Atualizada')

    const updatedEvent = emittedEvents.find(e => e.event === 'user:updated')
    expect(updatedEvent).toBeDefined()
    expect(updatedEvent?.room).toBe('users:staff')
    expect(updatedEvent?.payload.user.id).toBe(user.id)
    expect(updatedEvent?.payload.user.name).toBe('Marina Atualizada')
    expect(updatedEvent?.payload.actorId).toBe(adminActor.id)
    expect((updatedEvent?.payload.user as any).password).toBeUndefined()
  })

  it('emite user:deleted para a sala users:staff ao excluir um usuário', async () => {
    const user = await createUser({
      name: 'Roberto Delete Test',
      email: `roberto-${Date.now()}@example.com`,
      role: 'user',
      orgId: testOrgId,
      password: 'InitialPassword123!',
      authProvider: 'local',
    } as any)

    emittedEvents.length = 0

    await deleteUser(user.id, { actorId: adminActor.id })

    const deletedEvent = emittedEvents.find(e => e.event === 'user:deleted')
    expect(deletedEvent).toBeDefined()
    expect(deletedEvent?.payload.userId).toBe(user.id)
    expect(deletedEvent?.payload.name).toBe('Roberto Delete Test')
    expect(deletedEvent?.payload.actorId).toBe(adminActor.id)
  })

  describe('quem recebe a ficha', () => {
    const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const mkClient = (orgId: string) => createUser({
      name: 'Cliente Carteira', email: `cliente-${stamp()}@example.com`, role: 'user', orgId,
      password: 'InitialPassword123!', authProvider: 'local',
    } as any)
    const mkAnalyst = async (scope: string[]) => {
      const user = await prisma.user.create({
        data: { name: 'Analista Carteira', email: `analista-${stamp()}@example.com`, password: 'hash-de-fixture', role: 'agent' },
      })
      await prisma.userOrgScope.createMany({ data: scope.map(org_id => ({ user_id: user.id, org_id })) })
      return user
    }
    const lastEvent = (event: string) => emittedEvents.filter(e => e.event === event).at(-1)

    it('cliente: tira da sala quem não tem a empresa na carteira', async () => {
      const otherOrg = await prisma.organization.create({ data: { name: `Outra ${stamp()}`, domains: [] } })
      const inScope = await mkAnalyst([testOrgId])
      const outOfScope = await mkAnalyst([otherOrg.id])

      const client = await mkClient(testOrgId)
      const created = lastEvent('user:created')
      expect(created?.room).toBe('users:staff')
      expect(created?.excluded).toContain(`user:${outOfScope.id}`)
      expect(created?.excluded).not.toContain(`user:${inScope.id}`)

      await updateUser(client.id, { name: 'Cliente Editado' } as any)
      expect(lastEvent('user:updated')?.excluded).toContain(`user:${outOfScope.id}`)

      await deleteUser(client.id)
      expect(lastEvent('user:deleted')?.excluded).toContain(`user:${outOfScope.id}`)
    })

    it('administrador: só para administradores', async () => {
      await updateUser(adminActor.id, { name: 'Admin Editado' } as any)
      expect(lastEvent('user:updated')?.room).toBe('role:admin')

      await deleteUser(adminActor.id)
      expect(lastEvent('user:deleted')?.room).toBe('role:admin')
    })

    it('equipe: para toda a equipe, sem ninguém de fora', async () => {
      const analyst = await mkAnalyst([testOrgId])
      await updateUser(analyst.id, { name: 'Analista Editado' } as any)
      const updated = lastEvent('user:updated')
      expect(updated?.room).toBe('users:staff')
      expect(updated?.excluded).toEqual([])
    })

    it('leva só os campos do painel, com os que o painel usa', async () => {
      const analyst = await mkAnalyst([testOrgId])
      await prisma.user.update({
        where: { id: analyst.id },
        data: { welcome_email_error: 'erro-interno', session_invalidated_at: new Date(), my_tasks_columns: ['a'] },
      })
      await updateUser(analyst.id, { phone: '11999990000', queues: ['fila-x'] } as any)

      const { user } = lastEvent('user:updated')!.payload
      expect(user).toMatchObject({ id: analyst.id, phone: '11999990000', queues: ['fila-x'], role: 'agent', orgScopeIds: [testOrgId] })
      for (const field of ['password', 'welcome_email_error', 'session_invalidated_at', 'my_tasks_columns', 'deleted_at']) {
        expect(user).not.toHaveProperty(field)
      }
    })
  })
})
