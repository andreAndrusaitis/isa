import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getAuthToken: vi.fn(),
  post: vi.fn(),
  setAuth: vi.fn(),
}))

vi.mock('@microsoft/teams-js', () => ({
  app: { initialize: mocks.initialize },
  authentication: { getAuthToken: mocks.getAuthToken },
}))
vi.mock('axios', () => ({ default: { post: mocks.post } }))
vi.mock('@/store/auth', () => ({
  REMEMBER_KEY: 'isa-remember',
  useAuthStore: { getState: () => ({ setAuth: mocks.setAuth }) },
}))

import { isInTeams, renewTeamsSession, tryTeamsSso } from './teamsSso'

const sessionUser = { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'user', orgId: null, queues: [], avatar: 'AE' }

function runInsideTeamsFrame() {
  Object.defineProperty(window, 'top', { configurable: true, value: {} })
}

function storedValues(): string[] {
  return [...Object.keys(localStorage).map(k => localStorage.getItem(k)), ...Object.keys(sessionStorage).map(k => sessionStorage.getItem(k))]
    .filter((v): v is string => v !== null)
}

describe('isInTeams', () => {
  afterEach(() => {
    Object.defineProperty(window, 'top', { configurable: true, value: window })
    vi.unstubAllGlobals()
    delete (window as { nativeInterface?: unknown }).nativeInterface
  })

  it('is false in a regular browser tab', () => {
    Object.defineProperty(window, 'top', { configurable: true, value: window })
    expect(isInTeams()).toBe(false)
  })

  it('is true inside the Teams iframe (desktop and web)', () => {
    runInsideTeamsFrame()
    expect(isInTeams()).toBe(true)
  })

  it('is true in the Teams mobile webview', () => {
    Object.defineProperty(window, 'top', { configurable: true, value: window })
    ;(window as { nativeInterface?: unknown }).nativeInterface = {}
    expect(isInTeams()).toBe(true)
  })
})

describe('tryTeamsSso', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'top', { configurable: true, value: window })
    localStorage.clear()
  })

  it('does not initialize Teams from a regular browser tab', async () => {
    await expect(tryTeamsSso()).resolves.toBe('not-in-teams')
    expect(mocks.initialize).not.toHaveBeenCalled()
  })

  it('exchanges the Teams token without persisting it in browser storage', async () => {
    runInsideTeamsFrame()
    mocks.getAuthToken.mockResolvedValue('entra-token')
    mocks.post.mockResolvedValue({ data: { data: { user: sessionUser, accessToken: 'isa-token' } } })

    await expect(tryTeamsSso()).resolves.toBe('signed-in')

    expect(mocks.post).toHaveBeenCalledWith('/api/auth/teams', undefined, expect.objectContaining({ headers: { Authorization: 'Bearer entra-token' }, withCredentials: true }))
    expect(mocks.setAuth).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@example.com' }), 'isa-token')
    expect(localStorage.getItem('isa-remember')).toBe('true')
    expect(localStorage.getItem('entra-token')).toBeNull()
  })
})

describe('renewTeamsSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    runInsideTeamsFrame()
  })

  afterEach(() => {
    Object.defineProperty(window, 'top', { configurable: true, value: window })
  })

  it('returns null outside Teams without touching the SDK', async () => {
    Object.defineProperty(window, 'top', { configurable: true, value: window })

    await expect(renewTeamsSession()).resolves.toBeNull()
    expect(mocks.getAuthToken).not.toHaveBeenCalled()
  })

  it('re-exchanges the Teams token for a new ISA access token', async () => {
    mocks.getAuthToken.mockResolvedValue('entra-token-2')
    mocks.post.mockResolvedValue({ data: { data: { user: sessionUser, accessToken: 'isa-token-2' } } })

    await expect(renewTeamsSession()).resolves.toBe('isa-token-2')

    expect(mocks.post).toHaveBeenCalledWith('/api/auth/teams', undefined, expect.objectContaining({ headers: { Authorization: 'Bearer entra-token-2' } }))
    expect(mocks.setAuth).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'isa-token-2')
    expect(storedValues().some(v => v.includes('entra-token-2'))).toBe(false)
  })

  it('shares a single exchange between concurrent callers', async () => {
    let release!: (token: string) => void
    mocks.getAuthToken.mockReturnValue(new Promise<string>(resolve => { release = resolve }))
    mocks.post.mockResolvedValue({ data: { data: { user: sessionUser, accessToken: 'isa-token-3' } } })

    const renewals = [renewTeamsSession(), renewTeamsSession(), renewTeamsSession()]
    await vi.waitFor(() => expect(mocks.getAuthToken).toHaveBeenCalled())
    release('entra-token-3')

    await expect(Promise.all(renewals)).resolves.toEqual(['isa-token-3', 'isa-token-3', 'isa-token-3'])
    expect(mocks.getAuthToken).toHaveBeenCalledTimes(1)
    expect(mocks.post).toHaveBeenCalledTimes(1)
  })

  it('returns null when Teams or the backend refuses, and allows a later retry', async () => {
    mocks.getAuthToken.mockRejectedValueOnce(new Error('consent_required'))

    await expect(renewTeamsSession()).resolves.toBeNull()
    expect(mocks.setAuth).not.toHaveBeenCalled()

    mocks.getAuthToken.mockResolvedValue('entra-token-4')
    mocks.post.mockRejectedValueOnce({ response: { status: 401 } })
    await expect(renewTeamsSession()).resolves.toBeNull()

    expect(mocks.getAuthToken).toHaveBeenCalledTimes(2)
  })
})
