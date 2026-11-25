/**
 * Cliente LLM compartilhado por todos os agentes (Azure OpenAI no Foundry,
 * chat/completions). fetch nativo, sem SDK: os agentes só precisam de chamadas
 * de 1 token com logprobs (múltipla escolha), de chamadas com JSON e, no
 * assistente, de tool calling (chatWithTools).
 */
import type { ZodTypeAny } from 'zod'
import { aiHeaders, aiProvider, aiReady, chatUrl, modelField } from './provider'

export type ChatContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' | 'auto' } }
    >
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: ChatContent }
export interface TopLogprob { token: string; logprob: number }
export interface FoundryOptions {
  /** Orçamento total em ms: fila, tentativas e esperas. Sem ele, valem o timeout por tentativa e os ~60 s de sempre. */
  timeoutMs?: number
}
export interface ChatOptions extends FoundryOptions { maxTokens: number; logprobs?: boolean; json?: boolean }
export interface ChatResult {
  text: string
  /** top_logprobs do 1º token gerado (vazio quando logprobs não foi pedido). */
  firstTokenTop: TopLogprob[]
  inputTokens: number
  outputTokens: number
}
export type ChatFn = (messages: ChatMessage[], opts: ChatOptions) => Promise<ChatResult>

export type AiErrorCode = 'AI_TIMEOUT' | 'AI_RATE_LIMITED' | 'AI_UNAVAILABLE' | 'AI_REJECTED'

/**
 * Falha ao falar com o Foundry. A mensagem continua a original ("LLM 429: ...")
 * porque recordRun a grava e shortError extrai dela o motivo curto da nota.
 */
export class AiError extends Error {
  readonly code: AiErrorCode
  /** Status HTTP do Foundry, quando houve resposta. */
  readonly status?: number

  constructor(code: AiErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'AiError'
    this.code = code
    this.status = options.status
  }
}

function toAiError(err: any, res?: Response): AiError {
  const status = res && !res.ok ? res.status : undefined
  const code: AiErrorCode = err?.name === 'TimeoutError' ? 'AI_TIMEOUT'
    : status === 429 ? 'AI_RATE_LIMITED'
    : status !== undefined && status < 500 ? 'AI_REJECTED'
    : 'AI_UNAVAILABLE'
  return new AiError(code, String(err?.message ?? err), { status, cause: err })
}

export function aiConfigured(): boolean {
  return aiReady()
}

const MAX_ATTEMPTS = 6
const MAX_TOTAL_MS = 60_000
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 20_000

// Semáforo do processo: cada triagem dispara ~8 chamadas em paralelo e o
// Foundry devolve 429 sem isso. Excedente espera na fila, nunca é rejeitado.
// Limite por processo — com várias instâncias o teto real é N × limite.
let active = 0
const queue: Array<() => void> = []
/** Devolve false se `maxWaitMs` passar sem vaga; nesse caso quem chamou não tem vaga a liberar. */
async function acquire(maxWaitMs?: number): Promise<boolean> {
  if (active < aiProvider().maxConcurrency) { active++; return true }
  return new Promise<boolean>(resolve => {
    const grant = () => { clearTimeout(timer); resolve(true) }
    const timer = maxWaitMs === undefined ? undefined : setTimeout(() => {
      queue.splice(queue.indexOf(grant), 1)
      resolve(false)
    }, Math.max(0, maxWaitMs))
    queue.push(grant)
  })
}
function release(): void {
  const next = queue.shift()
  if (next) next() // passa a vaga direto para o próximo da fila
  else active--
}

/**
 * Espera antes da próxima tentativa: backoff exponencial com jitter (1 s, 2 s,
 * 4 s… teto 20 s) como piso. Dica do servidor: `retry-after-ms` quando vier (o
 * Azure manda 3–300 ms junto com um `retry-after: 30` genérico, que então é
 * ignorado); sem ela, `retry-after` em segundos. Dica acima do orçamento restante
 * é ignorada e fica o backoff.
 */
function retryDelayMs(attempt: number, remainingMs: number, res?: Response): number {
  const backoff = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1) * (1 + Math.random() / 5), MAX_DELAY_MS)
  const ms = res?.headers.get('retry-after-ms')
  const hint = ms != null ? Number(ms) : Number(res?.headers.get('retry-after')) * 1000
  return hint > 0 && hint <= remainingMs ? Math.max(backoff, hint) : backoff
}

/**
 * POST no Foundry com fila de concorrência e retry em 429, 5xx e erro de
 * rede/timeout (máx. 6 tentativas, ~60 s no total). Outros 4xx falham na hora.
 * Com `timeoutMs`, a espera na fila entra na conta: quem tem orçamento curto (a
 * sugestão no Wizard) não pode ficar preso atrás de uma rajada de triagens.
 * Toda falha sai como AiError.
 */
export async function postFoundry(url: string, body: string, opts: FoundryOptions = {}): Promise<any> {
  const started = Date.now()
  const { timeoutMs } = opts
  const remaining = () => (timeoutMs ?? MAX_TOTAL_MS) - (Date.now() - started)
  for (let attempt = 1; ; attempt++) {
    let res: Response | undefined
    let error: unknown
    if (!await acquire(timeoutMs === undefined ? undefined : remaining())) {
      throw new AiError('AI_TIMEOUT', `LLM timeout: orçamento de ${timeoutMs} ms esgotado na fila`)
    }
    try {
      const attemptMs = timeoutMs === undefined ? aiProvider().timeoutMs : Math.max(1, Math.min(aiProvider().timeoutMs, remaining()))
      res = await fetch(url, {
        method: 'POST',
        headers: aiHeaders(),
        body,
        signal: AbortSignal.timeout(attemptMs),
        redirect: 'error', // a chave não segue para outro endereço
      })
      if (res.ok) return await res.json()
      error = new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
    } catch (err) {
      error = err // rede/timeout (ou corpo 200 ilegível)
    } finally {
      release()
    }
    if (res && !res.ok && res.status !== 429 && res.status < 500) throw toAiError(error, res)
    const wait = retryDelayMs(attempt, remaining(), res)
    if (attempt >= MAX_ATTEMPTS || wait > remaining()) throw toAiError(error, res)
    await new Promise(resolve => setTimeout(resolve, wait))
  }
}

export const chat: ChatFn = async (messages, opts) => {
  const data = await postFoundry(chatUrl(), JSON.stringify({
    ...modelField(aiProvider().chatModel),
    messages,
    max_tokens: opts.maxTokens,
    temperature: 0,
    ...(opts.logprobs ? { logprobs: true, top_logprobs: 20 } : {}),
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  }), { timeoutMs: opts.timeoutMs })
  const choice = data.choices?.[0]
  return {
    text: choice?.message?.content ?? '',
    firstTokenTop: choice?.logprobs?.content?.[0]?.top_logprobs ?? [],
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  }
}

// ── Tool calling (formato OpenAI: tools + tool_calls + mensagens role 'tool') ──

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type ToolChatMessage =
  | ChatMessage
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolChatOptions extends FoundryOptions { maxTokens: number; toolChoice?: 'auto' | 'none' | 'required' }
export interface ToolChatResult {
  text: string
  /** Chamadas de ferramenta pedidas pelo modelo (vazio = resposta final em `text`). */
  toolCalls: ToolCall[]
  inputTokens: number
  outputTokens: number
}
export type ToolChatFn = (messages: ToolChatMessage[], tools: ToolSpec[], opts: ToolChatOptions) => Promise<ToolChatResult>

/**
 * JSON Schema a partir do zod, só para os tipos que as ferramentas usam
 * (object, string, number, boolean, enum, literal, array, optional/nullable/default,
 * effects). Tipo desconhecido vira {} (aceita qualquer coisa; o zod valida depois).
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const def = (schema as any)._def
  const described = (out: Record<string, unknown>) => (schema.description ? { ...out, description: schema.description } : out)
  switch (def.typeName) {
    case 'ZodObject': {
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(def.shape() as Record<string, ZodTypeAny>)) {
        properties[key] = zodToJsonSchema(value)
        if (!value.isOptional()) required.push(key)
      }
      return described({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false })
    }
    case 'ZodString': {
      const out: Record<string, unknown> = { type: 'string' }
      for (const c of def.checks ?? []) {
        if (c.kind === 'min') out.minLength = c.value
        else if (c.kind === 'max') out.maxLength = c.value
        else if (c.kind === 'length') out.minLength = out.maxLength = c.value
        else if (c.kind === 'uuid' || c.kind === 'email' || c.kind === 'url') out.format = c.kind === 'url' ? 'uri' : c.kind
      }
      return described(out)
    }
    case 'ZodNumber': {
      const out: Record<string, unknown> = { type: 'number' }
      for (const c of def.checks ?? []) {
        if (c.kind === 'int') out.type = 'integer'
        else if (c.kind === 'min') out[c.inclusive ? 'minimum' : 'exclusiveMinimum'] = c.value
        else if (c.kind === 'max') out[c.inclusive ? 'maximum' : 'exclusiveMaximum'] = c.value
      }
      return described(out)
    }
    case 'ZodBoolean': return described({ type: 'boolean' })
    case 'ZodEnum': return described({ type: 'string', enum: [...def.values] })
    case 'ZodLiteral': return described({ type: typeof def.value, enum: [def.value] })
    case 'ZodArray': {
      const out: Record<string, unknown> = { type: 'array', items: zodToJsonSchema(def.type) }
      if (def.minLength) out.minItems = def.minLength.value
      if (def.maxLength) out.maxItems = def.maxLength.value
      return described(out)
    }
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault': return described(zodToJsonSchema(def.innerType))
    case 'ZodEffects': return described(zodToJsonSchema(def.schema))
    default: return described({})
  }
}

export function toolSpec(name: string, description: string, schema: ZodTypeAny): ToolSpec {
  return { name, description, parameters: zodToJsonSchema(schema) }
}

/**
 * chat/completions com ferramentas: o modelo responde texto ou pede tool_calls,
 * que voltam para quem chamou executar (este cliente nunca executa nada).
 * Mesma fila, retry e tratamento de 429 do chat (postFoundry).
 */
export const chatWithTools: ToolChatFn = async (messages, tools, opts) => {
  const data = await postFoundry(chatUrl(), JSON.stringify({
    ...modelField(aiProvider().chatModel),
    messages,
    max_tokens: opts.maxTokens,
    temperature: 0,
    ...(tools.length ? {
      tools: tools.map(t => ({ type: 'function', function: t })),
      tool_choice: opts.toolChoice ?? 'auto',
    } : {}),
  }), { timeoutMs: opts.timeoutMs })
  const message = data.choices?.[0]?.message
  const toolCalls: ToolCall[] = (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
    .filter((c: any) => c?.type === 'function' && c.id && c.function?.name)
    .map((c: any) => ({
      id: String(c.id), type: 'function' as const,
      function: { name: String(c.function.name), arguments: typeof c.function.arguments === 'string' ? c.function.arguments : '{}' },
    }))
  return {
    text: message?.content ?? '',
    toolCalls,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  }
}
