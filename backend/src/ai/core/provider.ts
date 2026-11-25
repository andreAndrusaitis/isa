/**
 * Provedor de IA em vigor: o que o admin salvou em Configurar > Provedor de IA, por cima
 * das variáveis de ambiente. Leitura síncrona (os agentes consultam a cada chamada);
 * o valor do banco é carregado na subida, a cada gravação e a cada REFRESH_MS.
 */
import { z } from 'zod'
import { env } from '../../config/env'
import { AppError } from '../../middlewares/errorHandler'
import { clearSetting, openSecret, readSetting, writeSetting } from '../../services/systemSettings'
import { logger } from '../../utils/logger'
import type { AuditInfo } from '../../utils/audit'

const KEY = 'ai_provider' as const
const REFRESH_MS = 30_000

const model = z.string().trim().min(1).max(120).regex(/^[\w.:/-]+$/, 'Use letras, números, ponto, hífen, barra ou dois-pontos')
const valueSchema = z.object({
  enabled: z.boolean(),
  /** azure: Azure OpenAI/Foundry. openai: OpenAI ou servidor compatível (Ollama, vLLM, LM Studio…). */
  kind: z.enum(['azure', 'openai']),
  endpoint: z.string().trim().url('Informe um endereço completo, com https://').max(500),
  chatModel: model,
  embeddingModel: model,
  apiVersion: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(-preview)?$/, 'Use o formato 2024-10-21').default('2024-10-21'),
  timeoutMs: z.number().int().min(1000).max(120_000),
  maxConcurrency: z.number().int().min(1).max(50),
  assistantRateLimit: z.number().int().min(1).max(1000),
  assistantRateWindowMin: z.number().min(1).max(1440),
  assistantMaxConversationTokens: z.number().int().min(1000).max(2_000_000),
  assistantDailyTokenAlert: z.number().int().min(0).max(1_000_000_000),
})
export const aiInputSchema = valueSchema.extend({ apiKey: z.string().trim().min(1).max(1000).optional() }).strict()
type AiValue = z.infer<typeof valueSchema>
export type AiProvider = AiValue & { apiKey: string }

function fromEnv(): AiProvider {
  return {
    enabled: Boolean(env.AZURE_AI_ENDPOINT && env.AZURE_AI_KEY),
    kind: 'azure',
    endpoint: env.AZURE_AI_ENDPOINT ?? '',
    chatModel: env.AZURE_AI_DEPLOYMENT,
    embeddingModel: env.AZURE_AI_EMBEDDING_DEPLOYMENT,
    apiVersion: env.AZURE_AI_API_VERSION,
    timeoutMs: env.AZURE_AI_TIMEOUT_MS,
    maxConcurrency: env.AZURE_AI_MAX_CONCURRENCY || 6,
    assistantRateLimit: env.AI_ASSISTANT_RATE_LIMIT,
    assistantRateWindowMin: env.AI_ASSISTANT_RATE_WINDOW_MIN,
    assistantMaxConversationTokens: env.AI_ASSISTANT_MAX_CONVERSATION_TOKENS,
    assistantDailyTokenAlert: env.AI_ASSISTANT_DAILY_TOKEN_ALERT,
    apiKey: env.AZURE_AI_KEY ?? '',
  }
}

let saved: AiProvider | null = null

/** Configuração em vigor. */
export const aiProvider = (): AiProvider => saved ?? fromEnv()

export function aiReady(): boolean {
  const p = aiProvider()
  return Boolean(p.enabled && p.endpoint && p.apiKey)
}

const base = (p: AiProvider) => p.endpoint.replace(/\/+$/, '')
const azureUrl = (p: AiProvider, deployment: string, op: string) => `${base(p)}/openai/deployments/${deployment}/${op}?api-version=${p.apiVersion}`

export const chatUrl = (p = aiProvider()) => (p.kind === 'azure' ? azureUrl(p, p.chatModel, 'chat/completions') : `${base(p)}/chat/completions`)
export const embeddingsUrl = (p = aiProvider()) => (p.kind === 'azure' ? azureUrl(p, p.embeddingModel, 'embeddings') : `${base(p)}/embeddings`)
export const aiHeaders = (p = aiProvider()): Record<string, string> => ({
  'content-type': 'application/json',
  ...(p.kind === 'azure' ? { 'api-key': p.apiKey } : { authorization: `Bearer ${p.apiKey}` }),
})
/** Na Azure o modelo vai na URL; nos demais, no corpo. */
export const modelField = (name: string, p = aiProvider()) => (p.kind === 'azure' ? {} : { model: name })

export async function refreshAiProvider({ fresh = false } = {}): Promise<void> {
  const row = await readSetting(KEY, { fresh })
  const parsed = valueSchema.safeParse(row?.value)
  saved = row && parsed.success ? { ...parsed.data, apiKey: openSecret(KEY, row, 'apiKey') ?? '' } : null
}

export function startAiProviderRefresh(): void {
  const tick = () => refreshAiProvider().catch(err => logger.warn(`[IA] leitura do provedor falhou: ${err?.message ?? err}`))
  void tick()
  setInterval(tick, REFRESH_MS).unref()
}

/** O que a tela do admin vê: nunca a chave, só se existe. */
export async function describeAi() {
  const row = await readSetting(KEY, { fresh: true })
  await refreshAiProvider()
  const { apiKey, ...value } = aiProvider()
  return { source: row ? ('admin' as const) : value.enabled ? ('env' as const) : null, active: aiReady(), hasApiKey: Boolean(apiKey), ...value }
}

function assertEndpoint(endpoint: string): void {
  const url = new URL(endpoint)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new AppError(400, 'O endereço precisa usar https (http só para localhost).', 'AI_ENDPOINT_INSECURE')
  if (url.username || url.password) throw new AppError(400, 'Não coloque usuário ou senha no endereço.', 'AI_ENDPOINT_INVALID')
}

/** Valida a entrada e resolve a chave. Trocar o servidor exige digitar a chave de novo: a guardada não vaza para outro host. */
async function resolveInput(input: unknown): Promise<{ value: AiValue; apiKey?: string; candidate: AiProvider }> {
  const { apiKey, ...value } = aiInputSchema.parse(input)
  assertEndpoint(value.endpoint)
  const row = await readSetting(KEY, { fresh: true })
  const stored = valueSchema.safeParse(row?.value)
  const sameHost = stored.success && new URL(stored.data.endpoint).host === new URL(value.endpoint).host
  const kept = sameHost ? openSecret(KEY, row, 'apiKey') : null
  if (!apiKey && !kept && (value.enabled || row?.secrets.apiKey)) {
    throw new AppError(400, 'Digite a chave da API para este endereço.', 'AI_KEY_REQUIRED')
  }
  return { value, apiKey, candidate: { ...value, apiKey: apiKey ?? kept ?? '' } }
}

export async function updateAi(input: unknown, audit: AuditInfo) {
  const { value, apiKey } = await resolveInput(input)
  await writeSetting(KEY, value, { apiKey }, audit)
  return describeAi()
}

export async function resetAi(audit: AuditInfo) {
  await clearSetting(KEY, audit)
  return describeAi()
}

/** Botão "Testar": uma chamada curta ao chat e uma ao embedding, sem gravar nada. */
export async function testAi(input: unknown): Promise<{ ok: boolean; message: string }> {
  const { candidate: p } = await resolveInput(input)
  const call = async (what: string, url: string, body: object) => {
    try {
      const res = await fetch(url, { method: 'POST', headers: aiHeaders(p), body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(p.timeoutMs, 20_000)), redirect: 'error' })
      if (res.ok) return null
      const why = res.status === 401 || res.status === 403 ? 'chave recusada' : res.status === 404 ? 'modelo ou endereço não encontrado' : `erro ${res.status}`
      return `${what}: ${why}`
    } catch (err) {
      return `${what}: ${(err as Error)?.name === 'TimeoutError' ? 'sem resposta no tempo limite' : 'endereço inacessível'}`
    }
  }
  const problems = (await Promise.all([
    call('Modelo de conversa', chatUrl(p), { ...modelField(p.chatModel, p), messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    call('Modelo de embedding', embeddingsUrl(p), { ...modelField(p.embeddingModel, p), input: ['ping'] }),
  ])).filter(Boolean)
  return problems.length ? { ok: false, message: problems.join('. ') + '.' } : { ok: true, message: 'Conversa e embedding responderam.' }
}
