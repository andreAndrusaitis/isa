/** Funções puras dos exemplos de chamada da API externa (fora do arquivo de componentes por causa do fast refresh). */

/** Base pública das APIs de integração (chamados e Projetos). */
export function apiBaseUrl() {
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  return `${base}/integrations/v1`
}

export type ApiExampleSpec = { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: Record<string, any>; response: any; note?: string }

/**
 * JSON Schema (draft-07) gerado a partir da resposta de exemplo. Sem "required" e com
 * null aceito em todo campo: o Power Automate falha o "Analisar JSON" se um campo
 * obrigatório faltar (ex.: resposta duplicate) ou vier null (ex.: assigned_to).
 */
export function jsonSchemaFrom(sample: any, root = true): any {
  const head = root ? { $schema: 'http://json-schema.org/draft-07/schema#' } : {}
  if (sample === null) return {}
  const nullable = (t: string) => (root ? t : [t, 'null'])
  if (Array.isArray(sample)) return { ...head, type: nullable('array'), items: sample.length ? jsonSchemaFrom(sample[0], false) : {} }
  if (typeof sample === 'object') {
    return { ...head, type: nullable('object'), properties: Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, jsonSchemaFrom(v, false)])) }
  }
  return { type: nullable(typeof sample === 'number' ? (Number.isInteger(sample) ? 'integer' : 'number') : typeof sample) }
}

export function exampleCurl(spec: ApiExampleSpec, key: string) {
  const url = `${apiBaseUrl()}${spec.path}`
  if (!spec.body) return `curl "${url}" -H "Authorization: Bearer ${key}"`
  return `curl -X ${spec.method} "${url}" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(spec.body, null, 2)}'`
}
