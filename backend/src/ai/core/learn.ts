/**
 * Busca na documentação oficial da Microsoft (Microsoft Learn) pelo servidor MCP
 * público (`microsoft_docs_search`, sem chave). Devolve trechos de até ~500 tokens
 * com título e URL. Só documentação: as respostas do fórum Q&A (/answers/) saem,
 * e a URL é trocada para a versão pt-br. Falha ou demora = [] (nunca lança).
 */
export interface LearnDoc { title: string; url: string; content: string }
/** includeAnswers: aceita respostas do Microsoft Q&A (o assistente usa; a triagem não). */
export interface SearchLearnOptions { includeAnswers?: boolean }
export type SearchLearnFn = (query: string, opts?: SearchLearnOptions) => Promise<LearnDoc[]>

const ENDPOINT = 'https://learn.microsoft.com/api/mcp'
const TIMEOUT_MS = 8000
export const MAX_DOCS = 4
const MAX_CONTENT = 1500

/** learn.microsoft.com/<locale?>/x → learn.microsoft.com/pt-br/x; fora do Learn = null. */
export function toPtBr(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.hostname !== 'learn.microsoft.com') return null
  const parts = u.pathname.split('/').filter(Boolean)
  if (/^[a-z]{2}-[a-z]{2}$/i.test(parts[0] ?? '')) parts.shift()
  if (parts[0] === 'answers') return null
  u.pathname = '/pt-br/' + parts.join('/')
  return u.toString()
}

/** learn.microsoft.com/answers/… (Microsoft Q&A): fica na URL original, sem versão pt-br. */
function isAnswersUrl(url: string): boolean {
  try { const u = new URL(url); return u.hostname === 'learn.microsoft.com' && u.pathname.split('/').filter(Boolean).includes('answers') } catch { return false }
}

/** Corpo SSE ("event: message\ndata: {...}") ou JSON puro → resultados do tools/call. */
export function parseLearnResponse(body: string, opts: SearchLearnOptions = {}): LearnDoc[] {
  const line = body.split('\n').find(l => l.startsWith('data: '))
  const rpc = JSON.parse(line ? line.slice(6) : body)
  const text = rpc?.result?.content?.find((c: any) => c.type === 'text')?.text
  if (!text) return []
  const results: any[] = JSON.parse(text)?.results ?? []
  const seen = new Set<string>()
  const docs: LearnDoc[] = []
  for (const r of results) {
    const url = typeof r.contentUrl !== 'string' ? null
      : toPtBr(r.contentUrl) ?? (opts.includeAnswers && isAnswersUrl(r.contentUrl) ? r.contentUrl : null)
    if (!url || seen.has(url) || !r.content) continue
    seen.add(url)
    docs.push({ title: String(r.title ?? '').slice(0, 200), url, content: String(r.content).slice(0, MAX_CONTENT) })
    if (docs.length >= MAX_DOCS) break
  }
  return docs
}

export const searchLearn: SearchLearnFn = async (query, opts) => {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'microsoft_docs_search', arguments: { query } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Learn ${res.status}`)
    return parseLearnResponse(await res.text(), opts)
  } catch (err: any) {
    console.error('[AI:learn] busca falhou:', err?.message ?? err)
    return []
  }
}
