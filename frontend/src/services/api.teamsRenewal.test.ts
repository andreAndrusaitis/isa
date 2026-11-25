import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

const mocks = vi.hoisted(() => ({
  isInTeams: vi.fn(),
  renewTeamsSession: vi.fn(),
}))

vi.mock('@/services/teamsSso', () => ({ isInTeams: mocks.isInTeams, renewTeamsSession: mocks.renewTeamsSession }))
vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn() } }))

import api from './api'
import { useAuthStore, type AuthUser } from '@/store/auth'

const user: AuthUser = { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'user', orgId: null, queues: [], avatar: 'AE' }

function unauthorized(config: InternalAxiosRequestConfig) {
  return new AxiosError('401', 'ERR_BAD_REQUEST', config, null, { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config })
}

// Backend fake: só aceita o token "válido"; o resto responde 401.
let validToken = 'fresh-token'
const seenTokens: string[] = []
const originalAdapter = api.defaults.adapter

// Como o renewTeamsSession real, grava a nova sessão na store antes de devolver o token.
function teamsSessionFor(token: string) {
  useAuthStore.getState().setAuth(user, token)
  return token
}

function refreshRefused() {
  return vi.spyOn(axios, 'post').mockRejectedValue({ response: { status: 401 } })
}

describe('api 401 handling inside Teams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    seenTokens.length = 0
    validToken = 'fresh-token'
    useAuthStore.getState().setAuth(user, 'expired-token')
    api.defaults.adapter = async (config) => {
      const token = String(config.headers.Authorization ?? '').replace('Bearer ', '')
      seenTokens.push(token)
      if (token !== validToken) throw unauthorized(config)
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config }
    }
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
  })

  it('keeps using the cookie refresh when it works, without asking Teams', async () => {
    mocks.isInTeams.mockReturnValue(true)
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { data: { accessToken: 'fresh-token', user } } })

    const res = await api.get('/tickets')

    expect(res.data).toEqual({ ok: true })
    expect(mocks.renewTeamsSession).not.toHaveBeenCalled()
    expect(useAuthStore.getState().accessToken).toBe('fresh-token')
  })

  it('falls back to the Teams re-exchange when the refresh cookie is refused and retries once', async () => {
    mocks.isInTeams.mockReturnValue(true)
    const post = refreshRefused()
    mocks.renewTeamsSession.mockImplementation(async () => teamsSessionFor('fresh-token'))

    const res = await api.get('/tickets')

    expect(res.data).toEqual({ ok: true })
    expect(post).toHaveBeenCalledWith('/api/auth/refresh', {}, expect.objectContaining({ withCredentials: true }))
    expect(mocks.renewTeamsSession).toHaveBeenCalledTimes(1)
    expect(seenTokens).toEqual(['expired-token', 'fresh-token'])
    expect(useAuthStore.getState().user).not.toBeNull()
  })

  it('shares one renewal between concurrent 401s', async () => {
    mocks.isInTeams.mockReturnValue(true)
    const post = refreshRefused()
    let release!: () => void
    mocks.renewTeamsSession.mockImplementation(() => new Promise<string>(resolve => {
      release = () => resolve(teamsSessionFor('fresh-token'))
    }))

    const calls = Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])
    await vi.waitFor(() => expect(mocks.renewTeamsSession).toHaveBeenCalled())
    release()

    await expect(calls).resolves.toHaveLength(3)
    expect(post).toHaveBeenCalledTimes(1)
    expect(mocks.renewTeamsSession).toHaveBeenCalledTimes(1)
  })

  it('logs out as before when the Teams re-exchange also fails', async () => {
    mocks.isInTeams.mockReturnValue(true)
    refreshRefused()
    mocks.renewTeamsSession.mockResolvedValue(null)

    await expect(api.get('/tickets')).rejects.toMatchObject({ response: { status: 401 } })

    expect(mocks.renewTeamsSession).toHaveBeenCalledTimes(1)
    expect(seenTokens).toEqual(['expired-token'])
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('does not loop when the renewed token is still refused', async () => {
    mocks.isInTeams.mockReturnValue(true)
    refreshRefused()
    validToken = 'never'
    mocks.renewTeamsSession.mockImplementation(async () => teamsSessionFor('fresh-token'))

    await expect(api.get('/tickets')).rejects.toMatchObject({ response: { status: 401 } })

    expect(mocks.renewTeamsSession).toHaveBeenCalledTimes(1)
    expect(seenTokens).toEqual(['expired-token', 'fresh-token'])
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('never calls Teams outside the Teams host', async () => {
    mocks.isInTeams.mockReturnValue(false)
    refreshRefused()

    await expect(api.get('/tickets')).rejects.toMatchObject({ response: { status: 401 } })

    expect(mocks.renewTeamsSession).not.toHaveBeenCalled()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('does not try Teams when the refresh fails for a network reason', async () => {
    mocks.isInTeams.mockReturnValue(true)
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('Network Error'))

    await expect(api.get('/tickets')).rejects.toMatchObject({ response: { status: 401 } })

    expect(mocks.renewTeamsSession).not.toHaveBeenCalled()
    expect(useAuthStore.getState().user).not.toBeNull()
  })
})
