import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'

const prismaMock = vi.hoisted(() => ({ projectMember: { findUnique: vi.fn() } }))
const collabMock = vi.hoisted(() => ({ addWatcher: vi.fn(), removeWatcher: vi.fn(), listWatchers: vi.fn() }))

vi.mock('../config/prisma', () => ({ default: prismaMock }))
vi.mock('../services/taskCollab', () => collabMock)
vi.mock('../services/taskCompletion', () => ({}))
vi.mock('../services/projectDashboard', () => ({}))
vi.mock('../services/projectWebhooks', () => ({}))
vi.mock('../services/webhookDelivery', () => ({}))
vi.mock('../services/projectAccess', () => ({ effectiveProjectRole: vi.fn() }))

import { addWatcher, removeWatcher } from './projectCollab'

const ME = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

function call(handler: typeof addWatcher, role: string, opts: { body?: object; userId?: string }) {
  const req = {
    params: { projectId: 'p1', taskId: 't1', userId: opts.userId },
    body: opts.body ?? {},
    user: { sub: ME },
    projectMembership: { role },
  } as unknown as Request
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn() } as unknown as Response
  const next = vi.fn()
  return handler(req, res, next).then(() => ({ res, error: next.mock.calls[0]?.[0] }))
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.projectMember.findUnique.mockResolvedValue({ role: 'member' })
})

describe('watchers da task', () => {
  it('leitor segue e deixa de seguir por conta própria', async () => {
    expect((await call(addWatcher, 'viewer', {})).error).toBeUndefined()
    expect(collabMock.addWatcher).toHaveBeenCalledWith('t1', ME, ME)
    expect((await call(addWatcher, 'viewer', { body: { userId: ME } })).error).toBeUndefined()
    expect((await call(removeWatcher, 'viewer', { userId: ME })).error).toBeUndefined()
    expect(collabMock.removeWatcher).toHaveBeenCalledWith('t1', ME, ME)
  })

  it('leitor não mexe na lista de outra pessoa', async () => {
    expect((await call(addWatcher, 'viewer', { body: { userId: OTHER } })).error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' })
    expect((await call(removeWatcher, 'viewer', { userId: OTHER })).error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' })
    expect(collabMock.addWatcher).not.toHaveBeenCalled()
    expect(collabMock.removeWatcher).not.toHaveBeenCalled()
  })

  it('quem edita segue adicionando e tirando colegas', async () => {
    for (const role of ['owner', 'manager', 'member']) {
      expect((await call(addWatcher, role, { body: { userId: OTHER } })).error).toBeUndefined()
      expect((await call(removeWatcher, role, { userId: OTHER })).error).toBeUndefined()
    }
    expect(collabMock.addWatcher).toHaveBeenCalledTimes(3)
    expect(collabMock.removeWatcher).toHaveBeenCalledTimes(3)
  })

  it('adicionar quem não é membro segue recusado', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue(null)
    expect((await call(addWatcher, 'member', { body: { userId: OTHER } })).error).toMatchObject({ statusCode: 400, code: 'NOT_A_MEMBER' })
  })
})
