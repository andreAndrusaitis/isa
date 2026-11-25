import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../config/env', () => ({
  env: {
    AZURE_AI_ENDPOINT: 'https://aif.test/', AZURE_AI_KEY: 'k', AZURE_AI_DEPLOYMENT: 'gpt-4.1-mini',
    AZURE_AI_API_VERSION: '2024-10-21', AZURE_AI_TIMEOUT_MS: 1000, AZURE_AI_MAX_CONCURRENCY: 2,
  },
}))

import { z } from 'zod'
import { AiError, chat, aiConfigured, chatWithTools, postFoundry, toolSpec, zodToJsonSchema } from './llm'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200 })
const msgs = [{ role: 'user' as const, content: 'oi' }]
// Provedor que nunca responde: só termina quando o sinal da chamada estoura.
const hang = () => vi.fn((_url: string, init: any) => new Promise<Response>((_, reject) => {
  init.signal.addEventListener('abort', () => reject(init.signal.reason))
}))
const tick = () => new Promise(r => setTimeout(r, 0))

describe('llm', () => {
  it('chama o deployment com a chave e devolve texto, top_logprobs do 1º token e tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: { content: 'B' },
        logprobs: { content: [{ token: 'B', logprob: -0.01, top_logprobs: [{ token: 'B', logprob: -0.01 }, { token: 'A', logprob: -4.6 }] }] },
      }],
      usage: { prompt_tokens: 120, completion_tokens: 1 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await chat([{ role: 'user', content: 'oi' }], { maxTokens: 1, logprobs: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://aif.test/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2024-10-21')
    expect(init.headers['api-key']).toBe('k')
    expect(JSON.parse(init.body)).toMatchObject({ max_tokens: 1, temperature: 0, logprobs: true, top_logprobs: 20 })
    expect(r).toEqual({
      text: 'B',
      firstTokenTop: [{ token: 'B', logprob: -0.01 }, { token: 'A', logprob: -4.6 }],
      inputTokens: 120,
      outputTokens: 1,
    })
  })

  it('pede JSON quando json=true e não pede logprobs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: {} }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await chat([{ role: 'user', content: 'JSON' }], { maxTokens: 10, json: true })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.logprobs).toBeUndefined()
    expect(r.firstTokenTop).toEqual([])
  })

  it('4xx (≠429) falha na hora, sem repetir', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(chat(msgs, { maxTokens: 1 })).rejects.toThrow('LLM 400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('429 espera o Retry-After e repete', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    const p = chat(msgs, { maxTokens: 1 })
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('5xx e erro de rede repetem com backoff; desiste após 6 tentativas', async () => {
    vi.useFakeTimers()
    const flaky = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('x', { status: 503 })).mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', flaky)
    const p = chat(msgs, { maxTokens: 1 })
    await vi.runAllTimersAsync()
    expect((await p).text).toBe('ok')
    expect(flaky).toHaveBeenCalledTimes(3)

    const down = vi.fn().mockImplementation(async () => new Response('quota', { status: 429 }))
    vi.stubGlobal('fetch', down)
    const failed = expect(chat(msgs, { maxTokens: 1 })).rejects.toThrow('LLM 429')
    await vi.runAllTimersAsync()
    await failed
    expect(down).toHaveBeenCalledTimes(6)
  })

  it('429 com retry-after-ms minúsculo: o backoff (~1 s) é o piso', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'retry-after-ms': '5' } }))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    const p = chat(msgs, { maxTokens: 1 })
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect((await p).text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retry-after=30 + retry-after-ms=5 (Azure real): usa o ms e ignora os 30 s — repete em ~1 s (backoff)', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'retry-after': '30', 'retry-after-ms': '5' } }))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    const p = chat(msgs, { maxTokens: 1 })
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect((await p).text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retry-after-ms acima do backoff vale (e o retry-after em segundos segue ignorado)', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'retry-after': '30', 'retry-after-ms': '3000' } }))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    const p = chat(msgs, { maxTokens: 1 })
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('Retry-After acima do orçamento total é ignorado: usa o backoff e tenta de novo', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'retry-after': '120' } }))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    const p = chat(msgs, { maxTokens: 1 })
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect((await p).text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('limita as chamadas simultâneas (fila, não rejeição)', async () => {
    const pending: Array<() => void> = []
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(r => pending.push(() => r(ok()))))
    vi.stubGlobal('fetch', fetchMock)
    const all = Promise.all(Array.from({ length: 5 }, () => chat(msgs, { maxTokens: 1 })))
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    while (pending.length) { pending.shift()!(); await new Promise(r => setTimeout(r, 0)) }
    expect((await all).map(r => r.text)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('aiConfigured exige endpoint e chave', () => {
    expect(aiConfigured()).toBe(true)
  })

  describe('erro padronizado', () => {
    it('4xx vira AI_REJECTED com o status, mantendo a mensagem "LLM 400"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })))
      const err = await chat(msgs, { maxTokens: 1 }).catch(e => e)
      expect(err).toBeInstanceOf(AiError)
      expect(err).toBeInstanceOf(Error)
      expect(err).toMatchObject({ name: 'AiError', code: 'AI_REJECTED', status: 400, message: 'LLM 400: bad' })
    })

    it('429 até esgotar vira AI_RATE_LIMITED', async () => {
      vi.useFakeTimers()
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('rate', { status: 429 })))
      const failed = expect(chat(msgs, { maxTokens: 1 })).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', status: 429 })
      await vi.runAllTimersAsync()
      await failed
    })

    it('5xx até esgotar vira AI_UNAVAILABLE', async () => {
      vi.useFakeTimers()
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('x', { status: 503 })))
      const failed = expect(chat(msgs, { maxTokens: 1 })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', status: 503 })
      await vi.runAllTimersAsync()
      await failed
    })

    it('erro de rede vira AI_UNAVAILABLE e guarda a causa', async () => {
      vi.useFakeTimers()
      const cause = new TypeError('fetch failed')
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause))
      const failed = expect(chat(msgs, { maxTokens: 1 })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', message: 'fetch failed', cause })
      await vi.runAllTimersAsync()
      await failed
    })

    it('corpo 200 ilegível vira AI_UNAVAILABLE', async () => {
      vi.useFakeTimers()
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('<html>', { status: 200 })))
      const failed = expect(chat(msgs, { maxTokens: 1 })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
      await vi.runAllTimersAsync()
      await failed
    })
  })

  describe('orçamento total (timeoutMs)', () => {
    it('sem a opção, cada tentativa usa AZURE_AI_TIMEOUT_MS', async () => {
      const spy = vi.spyOn(AbortSignal, 'timeout')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
      await chat(msgs, { maxTokens: 1 })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(1000)
    })

    it('provedor mudo estoura no orçamento, não no timeout do env', async () => {
      const fetchMock = hang()
      vi.stubGlobal('fetch', fetchMock)
      const started = Date.now()
      const err = await chat(msgs, { maxTokens: 1, timeoutMs: 50 }).catch(e => e)
      expect(err).toBeInstanceOf(AiError)
      expect(err.code).toBe('AI_TIMEOUT')
      expect(Date.now() - started).toBeLessThan(900)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('orçamento maior que o env: a tentativa continua limitada pelo env', async () => {
      const spy = vi.spyOn(AbortSignal, 'timeout')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
      await chat(msgs, { maxTokens: 1, timeoutMs: 30_000 })
      expect(spy).toHaveBeenCalledWith(1000)
    })

    it('não espera o backoff se ele não cabe no orçamento', async () => {
      const fetchMock = vi.fn().mockImplementation(async () => new Response('x', { status: 503 }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(chat(msgs, { maxTokens: 1, timeoutMs: 200 })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', status: 503 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('repete dentro do orçamento, e a nova tentativa só usa o que sobrou', async () => {
      vi.useFakeTimers()
      const spy = vi.spyOn(AbortSignal, 'timeout')
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('x', { status: 503 }))
        .mockResolvedValueOnce(ok())
      vi.stubGlobal('fetch', fetchMock)
      const p = chat(msgs, { maxTokens: 1, timeoutMs: 1500 })
      await vi.runAllTimersAsync()
      expect((await p).text).toBe('ok')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(spy.mock.calls[0][0]).toBe(1000)
      expect(spy.mock.calls[1][0]).toBeLessThanOrEqual(500)
    })

    it('a espera na fila conta: desiste sem chamar o provedor e não perde vaga', async () => {
      const pending: Array<() => void> = []
      const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(r => pending.push(() => r(ok()))))
      vi.stubGlobal('fetch', fetchMock)
      const running = Promise.all([chat(msgs, { maxTokens: 1 }), chat(msgs, { maxTokens: 1 })])
      await tick()

      const err = await chat(msgs, { maxTokens: 1, timeoutMs: 20 }).catch(e => e)
      expect(err).toBeInstanceOf(AiError)
      expect(err.code).toBe('AI_TIMEOUT')
      expect(err.message).toMatch(/^LLM timeout: /)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      while (pending.length) { pending.shift()!(); await tick() }
      await running

      // Quem desistiu saiu da fila: as vagas voltam inteiras, e o limite de 2 continua valendo.
      const next = Promise.all(Array.from({ length: 3 }, () => chat(msgs, { maxTokens: 1 })))
      await tick()
      expect(fetchMock).toHaveBeenCalledTimes(4)
      while (pending.length) { pending.shift()!(); await tick() }
      expect((await next).map(r => r.text)).toEqual(['ok', 'ok', 'ok'])
      expect(fetchMock).toHaveBeenCalledTimes(5)
    })

    it('quem está na fila com orçamento é atendido se a vaga abre a tempo', async () => {
      const pending: Array<() => void> = []
      const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(r => pending.push(() => r(ok()))))
      vi.stubGlobal('fetch', fetchMock)
      const all = Promise.all([
        chat(msgs, { maxTokens: 1 }), chat(msgs, { maxTokens: 1 }), chat(msgs, { maxTokens: 1, timeoutMs: 5000 }),
      ])
      await tick()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      while (pending.length) { pending.shift()!(); await tick() }
      expect((await all).map(r => r.text)).toEqual(['ok', 'ok', 'ok'])
    })

    it('postFoundry aceita a opção direto; o corpo enviado não muda', async () => {
      const fetchMock = vi.fn().mockResolvedValue(ok())
      vi.stubGlobal('fetch', fetchMock)
      await postFoundry('https://aif.test/x', '{"a":1}', { timeoutMs: 100 })
      expect(fetchMock.mock.calls[0][1].body).toBe('{"a":1}')
    })

    it('chat e chatWithTools não mandam timeoutMs ao provedor', async () => {
      const fetchMock = vi.fn().mockImplementation(async () => ok())
      vi.stubGlobal('fetch', fetchMock)
      await chat(msgs, { maxTokens: 1, timeoutMs: 100 })
      await chatWithTools(msgs, [], { maxTokens: 1, timeoutMs: 100 })
      for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(init.body).timeoutMs).toBeUndefined()
    })

    it('chatWithTools respeita o orçamento', async () => {
      vi.stubGlobal('fetch', hang())
      await expect(chatWithTools(msgs, [], { maxTokens: 1, timeoutMs: 30 })).rejects.toMatchObject({ code: 'AI_TIMEOUT' })
    })
  })

  describe('tool calling', () => {
    const reply = (message: unknown, usage: unknown = { prompt_tokens: 300, completion_tokens: 20 }) =>
      new Response(JSON.stringify({ choices: [{ message }], usage }), { status: 200 })
    const spec = toolSpec('buscar_learn', 'Busca no Microsoft Learn', z.object({ query: z.string().min(3) }))

    it('envia tools/tool_choice e devolve os tool_calls pedidos pelo modelo', async () => {
      const fetchMock = vi.fn().mockResolvedValue(reply({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'buscar_learn', arguments: '{"query":"outlook"}' } },
          { id: 'call_x', type: 'other' },
        ],
      }))
      vi.stubGlobal('fetch', fetchMock)

      const r = await chatWithTools(msgs, [spec], { maxTokens: 500 })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.tools).toEqual([{ type: 'function', function: spec }])
      expect(body.tool_choice).toBe('auto')
      expect(body).toMatchObject({ max_tokens: 500, temperature: 0 })
      expect(r).toEqual({
        text: '',
        toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'buscar_learn', arguments: '{"query":"outlook"}' } }],
        inputTokens: 300, outputTokens: 20,
      })
    })

    it('repassa assistant com tool_calls e mensagens role tool; resposta final vem em text', async () => {
      const fetchMock = vi.fn().mockResolvedValue(reply({ content: 'Feche e abra o Outlook.' }))
      vi.stubGlobal('fetch', fetchMock)
      const call = { id: 'call_1', type: 'function' as const, function: { name: 'buscar_learn', arguments: '{"query":"outlook"}' } }
      const r = await chatWithTools([
        ...msgs,
        { role: 'assistant', content: null, tool_calls: [call] },
        { role: 'tool', tool_call_id: 'call_1', content: '{"sources":[]}' },
      ], [spec], { maxTokens: 500, toolChoice: 'none' })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.messages.at(-2)).toEqual({ role: 'assistant', content: null, tool_calls: [call] })
      expect(body.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"sources":[]}' })
      expect(body.tool_choice).toBe('none')
      expect(r.text).toBe('Feche e abra o Outlook.')
      expect(r.toolCalls).toEqual([])
    })

    it('sem ferramentas não manda tools (o Foundry rejeita lista vazia)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(reply({ content: 'oi' }, {}))
      vi.stubGlobal('fetch', fetchMock)
      const r = await chatWithTools(msgs, [], { maxTokens: 10 })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.tools).toBeUndefined()
      expect(body.tool_choice).toBeUndefined()
      expect(r).toMatchObject({ text: 'oi', inputTokens: 0, outputTokens: 0 })
    })

    it('mesmo retry do chat: 429 repete', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'retry-after': '1' } }))
        .mockResolvedValueOnce(reply({ content: 'ok' }))
      vi.stubGlobal('fetch', fetchMock)
      const p = chatWithTools(msgs, [spec], { maxTokens: 10 })
      await vi.runAllTimersAsync()
      expect((await p).text).toBe('ok')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('zodToJsonSchema cobre os tipos usados pelas ferramentas', () => {
      const schema = z.object({
        titulo: z.string().min(5).max(120).describe('Título curto'),
        prioridade: z.enum(['low', 'medium', 'high']).optional(),
        limite: z.number().int().min(1).max(20).default(5),
        urgente: z.boolean(),
        anexos: z.array(z.string().uuid()).max(3).optional(),
        tipo: z.literal('incident'),
        nota: z.string().nullable().optional(),
        busca: z.string().transform(s => s.trim()),
      })
      expect(zodToJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          titulo: { type: 'string', minLength: 5, maxLength: 120, description: 'Título curto' },
          prioridade: { type: 'string', enum: ['low', 'medium', 'high'] },
          limite: { type: 'integer', minimum: 1, maximum: 20 },
          urgente: { type: 'boolean' },
          anexos: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 3 },
          tipo: { type: 'string', enum: ['incident'] },
          nota: { type: 'string' },
          busca: { type: 'string' },
        },
        required: ['titulo', 'urgente', 'tipo', 'busca'],
        additionalProperties: false,
      })
    })
  })
})
