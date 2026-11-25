import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../config/env', () => ({
  env: {
    AZURE_AI_ENDPOINT: 'https://aif.test/', AZURE_AI_KEY: 'k', AZURE_AI_EMBEDDING_DEPLOYMENT: 'text-embedding-3-small',
    AZURE_AI_API_VERSION: '2024-10-21', AZURE_AI_TIMEOUT_MS: 1000,
  },
}))

import { embed } from './embeddings'
import { AiError } from './llm'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const reply = (inputs: string[]) => new Response(JSON.stringify({
  // fora de ordem de propósito: o cliente reordena por index
  data: inputs.map((s, i) => ({ index: i, embedding: [s.length, i] })).reverse(),
}), { status: 200 })

describe('embed', () => {
  it('chama o deployment de embeddings em lotes de 100 e preserva a ordem', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => reply(JSON.parse(init.body).input))
    vi.stubGlobal('fetch', fetchMock)
    const texts = Array.from({ length: 150 }, (_, i) => 'x'.repeat(i + 1))

    const out = await embed(texts)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://aif.test/openai/deployments/text-embedding-3-small/embeddings?api-version=2024-10-21')
    expect(init.headers['api-key']).toBe('k')
    expect(JSON.parse(init.body).input).toHaveLength(100)
    expect(out).toHaveLength(150)
    expect(out[0]).toEqual([1, 0])
    expect(out[149]).toEqual([150, 49])
  })

  // text-embedding-3-small recusa input acima de 8192 tokens (400) — um título de 100 KB derrubava a orientação.
  it('corta texto longo para caber no limite de tokens do modelo', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => reply(JSON.parse(init.body).input))
    vi.stubGlobal('fetch', fetchMock)

    await embed(['A'.repeat(100_000), 'curto'])

    const input = JSON.parse(fetchMock.mock.calls[0][1].body).input
    expect(input[0].length).toBeLessThanOrEqual(8000)
    expect(input[1]).toBe('curto')
  })

  it('lista vazia não chama a API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await embed([])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lança erro com o status quando o Foundry falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })))
    await expect(embed(['oi'])).rejects.toThrow('LLM 400')
  })

  it('falha do Foundry chega como AiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 401 })))
    const err = await embed(['oi']).catch(e => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err).toMatchObject({ code: 'AI_REJECTED', status: 401 })
  })

  it('sem orçamento, cada lote usa AZURE_AI_TIMEOUT_MS', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => reply(JSON.parse(init.body).input)))
    await embed(Array.from({ length: 150 }, () => 'x'))
    expect(spy.mock.calls).toEqual([[1000], [1000]])
  })

  it('provedor mudo estoura no orçamento com AI_TIMEOUT', async () => {
    const fetchMock = vi.fn((_url: string, init: any) => new Promise<Response>((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason))
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(embed(['oi'], { timeoutMs: 30 })).rejects.toMatchObject({ code: 'AI_TIMEOUT' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('o orçamento vale para o conjunto dos lotes, não para cada um', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      await new Promise(r => setTimeout(r, 60))
      return reply(JSON.parse(init.body).input)
    })
    vi.stubGlobal('fetch', fetchMock)
    const spy = vi.spyOn(AbortSignal, 'timeout')

    await embed(Array.from({ length: 150 }, () => 'x'), { timeoutMs: 500 })

    expect(spy.mock.calls[0][0]).toBeLessThanOrEqual(500)
    expect(spy.mock.calls[1][0]).toBeLessThanOrEqual(440)
  })
})
