import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

import api from './api'
import { aiSuggestService } from './aiSuggestService'

const mocked = api as unknown as Record<'get' | 'post', ReturnType<typeof vi.fn>>

beforeEach(() => vi.clearAllMocks())

describe('aiSuggestService', () => {
  it('lê o status; campo ausente conta como desligado', async () => {
    mocked.get.mockResolvedValue({ data: { enabled: true } })
    await expect(aiSuggestService.status()).resolves.toEqual({ enabled: true, shadow: false })
    expect(mocked.get).toHaveBeenCalledWith('/ai/suggest/status')
  })

  it('pede a sugestão com o sinal de cancelamento e devolve só ela', async () => {
    const signal = new AbortController().signal
    const suggestion = { answer: 'a', confidence: 0.9, sources: [], interactionId: 'i1' }
    mocked.post.mockResolvedValue({ data: { suggestion } })
    await expect(aiSuggestService.suggest({ title: 't', description: 'd' }, signal)).resolves.toBe(suggestion)
    expect(mocked.post).toHaveBeenCalledWith('/ai/suggest', { title: 't', description: 'd' }, { signal })
  })

  it('aceite usa o corpo de criação e devolve o chamado como POST /tickets', async () => {
    mocked.post.mockResolvedValue({ data: { data: { id: 't1' } } })
    const body = { title: 't', description: 'd', priority: 'medium' }
    await expect(aiSuggestService.accept('i1', body)).resolves.toEqual({ id: 't1' })
    expect(mocked.post).toHaveBeenCalledWith('/ai/suggest/i1/accept', body)
  })

  it('feedback vai para /ai/feedback', async () => {
    mocked.post.mockResolvedValue({ data: { feedback: 'useful' } })
    await aiSuggestService.feedback('i1', 'useful')
    expect(mocked.post).toHaveBeenCalledWith('/ai/feedback', { interactionId: 'i1', value: 'useful' })
  })
})
