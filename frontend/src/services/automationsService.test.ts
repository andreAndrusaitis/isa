import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

import api from './api'
import { createAutomation, listAutomations } from './automationsService'

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> }

beforeEach(() => {
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
})

describe('automationsService', () => {
  it('listAutomations calls the project-scoped endpoint', async () => {
    mockedApi.get.mockResolvedValue({ data: { data: [{ id: 'auto-1' }] } })
    const result = await listAutomations('proj-1')
    expect(mockedApi.get).toHaveBeenCalledWith('/projects/proj-1/automations')
    expect(result).toEqual([{ id: 'auto-1' }])
  })

  it('createAutomation posts trigger/actions', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { id: 'auto-1' } } })
    const result = await createAutomation('proj-1', {
      name: 'Auto', trigger: 'status_changed', actions: [{ type: 'send_notification', userId: 'u1', message: 'oi' }],
    })
    expect(mockedApi.post).toHaveBeenCalledWith('/projects/proj-1/automations', {
      name: 'Auto', trigger: 'status_changed', actions: [{ type: 'send_notification', userId: 'u1', message: 'oi' }],
    })
    expect(result).toEqual({ id: 'auto-1' })
  })
})
