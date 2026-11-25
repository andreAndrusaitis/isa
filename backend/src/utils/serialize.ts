/**
 * Conversão snake_case → camelCase na fronteira da API.
 *
 * O Prisma devolve as colunas em snake_case (`status_id`, `due_date`) porque o
 * banco é snake_case por convenção do projeto, mas os tipos do frontend são
 * camelCase (`statusId`, `dueDate`). Sem esta conversão, `task.statusId` chega
 * `undefined` e o Board agrupa todas as tasks numa coluna inexistente.
 *
 * Feita aqui, num ponto só, e não em cada página: Board, Lista, Calendário,
 * Gantt e Minhas Tarefas leem a mesma Task — converter na view faria a
 * mesma task ter formatos diferentes conforme quem a buscou.
 */

/** Chaves cujo valor é dado opaco e não deve ter suas chaves renomeadas. */
const OPAQUE_KEYS = new Set(['filters', 'conditions', 'actions', 'payload', 'structure', 'recurrence', 'value', 'content'])

// `_` inicial fica (ex.: `_count` do Prisma não vira `Count`).
function toCamel(key: string): string {
  return key.replace(/(?<=[a-zA-Z0-9])_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

export function camelize<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => camelize(item)) as unknown as T
  }

  // Date, Decimal, Buffer e afins passam intactos — só objetos-literais viram
  // mapas de chaves renomeadas.
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
    return input
  }

  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[toCamel(key)] = OPAQUE_KEYS.has(key) ? value : camelize(value)
  }
  return output as unknown as T
}

function toSnake(key: string): string {
  return key.replace(/(?<=[a-z0-9])([A-Z])/g, (_, char: string) => `_${char.toLowerCase()}`)
}

/** Inverso de camelize, para a API pública (snake_case como a de chamados). */
export function snakeize<T>(input: T): T {
  if (Array.isArray(input)) return input.map((item) => snakeize(item)) as unknown as T
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return input
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[toSnake(key)] = OPAQUE_KEYS.has(key) ? value : snakeize(value)
  }
  return output as unknown as T
}

export function snakeizeResponses(_req: unknown, res: { json: (body: unknown) => unknown }, next: () => void) {
  const json = res.json.bind(res)
  res.json = (body: unknown) => json(snakeize(body))
  next()
}

/**
 * Middleware que camelize toda resposta JSON do router onde for montado.
 * Usado em todos os routers do módulo Projetos, para que uma rota nova não
 * consiga esquecer a conversão.
 */
export function camelizeResponses(_req: unknown, res: { json: (body: unknown) => unknown }, next: () => void) {
  const json = res.json.bind(res)
  res.json = (body: unknown) => json(camelize(body))
  next()
}
