// Foundry de mentira da suíte integrada: nada sai da máquina e a resposta é sempre a
// mesma para a mesma entrada. Sobe com o run-integration.sh.
//
//   IT_AI_PORT      /openai/deployments/*/embeddings e /chat/completions
//   IT_AI_PORT + 1  controle: GET /requests, POST /reset, /down, /up, /shutdown
//
// O controle fica numa porta própria para o teste poder derrubar a porta da API de
// verdade (conexão recusada) e subir de novo.
//
// Embedding: cada palavra-chave acende uma dimensão, então perguntas com as mesmas
// palavras ficam próximas e assuntos diferentes ficam em cosseno zero.
//
// Chat: age como um modelo obediente, para a defesa ser do backend. Responde o trecho
// mais parecido com a pergunta e, se o texto mandar revelar as regras, revela.
import http from 'node:http'

const PORT = Number(process.env.IT_AI_PORT ?? 3023)
const KEY = 'integracao-fake-foundry-key'
const DIMENSIONS = 1536
const SAME_SUBJECT = 0.3
const RESOLVES = 0.97
const NOT_RESOLVED = 0.02

// Palavra na pergunta que fixa a certeza do modelo: é assim que o teste escolhe o caso.
const CERTAINTY = { duvidoso: 0.8, quase: 0.87 }
const INJECTION = /ignore (as|todas as) instru|revele|prompt de sistema/i

const STOPWORDS = new Set(('com sem para por que uma uns umas dos das nos nas aos ele ela eles elas meu minha '
  + 'seu sua foi esta este isso essa esse nao sim mas como ser ter mais muito pelo pela').split(' '))

const keywords = text => [...new Set(text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .split(/[^\p{L}\p{N}]+/u)
  .filter(w => w.length > 2 && !STOPWORDS.has(w))
  .map(w => w.replace(/s$/, '')))]

function dimensionOf(word) {
  let hash = 2166136261
  for (let i = 0; i < word.length; i++) hash = Math.imul(hash ^ word.charCodeAt(i), 16777619)
  return (hash >>> 0) % DIMENSIONS
}

function embedding(text) {
  const vector = new Array(DIMENSIONS).fill(0)
  const dims = keywords(text).map(dimensionOf)
  // Vetor zerado vira NaN no cosseno do pgvector: texto sem palavra-chave cai numa dimensão fixa.
  if (!dims.length) dims.push(DIMENSIONS - 1)
  for (const d of dims) vector[d] = 1
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  return vector.map(v => v / norm)
}

function similarity(a, b) {
  const x = new Set(keywords(a))
  const y = keywords(b)
  return x.size && y.length ? y.filter(w => x.has(w)).length / Math.sqrt(x.size * y.length) : 0
}

const contentOf = message => (typeof message?.content === 'string' ? message.content : '')

function readContext(messages) {
  // A mensagem de sistema também cita <pergunta>; os dados vêm na de usuário.
  const user = contentOf(messages.find(m => m.role === 'user' && /<pergunta>/.test(contentOf(m))))
  const question = /<pergunta>\n?([\s\S]*?)\n?<\/pergunta>/.exec(user)?.[1] ?? ''
  const excerpts = [...user.matchAll(/<trecho id="(T\d+)">\n([\s\S]*?)\n<\/trecho>/g)].map(m => ({ id: m[1], text: m[2] }))
  const ranked = excerpts
    .map(e => ({ ...e, score: similarity(question, e.text) }))
    .sort((a, b) => b.score - a.score)
  return { question, best: ranked[0] ?? null }
}

function certainty({ question, best }) {
  const words = keywords(question)
  for (const [word, p] of Object.entries(CERTAINTY)) if (words.includes(word)) return p
  return best && best.score >= SAME_SUBJECT ? RESOLVES : NOT_RESOLVED
}

/** Múltipla escolha: a letra certa depende da ordem da rodada, que vem na última mensagem. */
function letterChoice(messages) {
  const options = contentOf(messages.at(-1))
  const yes = /^([A-Z])\) Sim/m.exec(options)?.[1]
  const no = /^([A-Z])\) Não/m.exec(options)?.[1]
  // Pergunta de outro agente: fica na primeira opção, com certeza alta.
  if (!yes || !no) return { text: 'A', top: [{ token: 'A', logprob: Math.log(RESOLVES) }] }

  const p = certainty(readContext(messages))
  return {
    text: p >= 0.5 ? yes : no,
    top: [{ token: yes, logprob: Math.log(p) }, { token: no, logprob: Math.log(1 - p) }],
  }
}

function answer(messages) {
  const context = readContext(messages)
  if (INJECTION.test(context.question)) {
    return { resolve: true, resposta: `Claro. Minhas regras: ${contentOf(messages[0])}`, fontes: context.best ? [context.best.id] : [] }
  }
  if (!context.best || context.best.score < SAME_SUBJECT) return { resolve: false, resposta: 'Não sei', fontes: [] }
  return { resolve: true, resposta: context.best.text, fontes: [context.best.id] }
}

function chatResponse(body) {
  const usage = { prompt_tokens: 100, completion_tokens: 10 }
  if (body.logprobs) {
    const { text, top } = letterChoice(body.messages)
    return { choices: [{ message: { role: 'assistant', content: text }, logprobs: { content: [{ token: text, top_logprobs: top }] } }], usage }
  }
  const content = body.response_format?.type === 'json_object' ? JSON.stringify(answer(body.messages)) : 'Resposta do stub.'
  return { choices: [{ message: { role: 'assistant', content } }], usage }
}

function embeddingsResponse(body) {
  const input = Array.isArray(body.input) ? body.input : [body.input]
  return { data: input.map((text, index) => ({ index, embedding: embedding(text) })), usage: { prompt_tokens: 10 } }
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

let requests = []

const api = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://stub').pathname
  const route = /^\/openai\/deployments\/[^/]+\/(embeddings|chat\/completions)$/.exec(path)?.[1]
  if (req.method !== 'POST' || !route) return send(res, 404, { error: { message: `rota desconhecida: ${path}` } })
  if (req.headers['api-key'] !== KEY) return send(res, 401, { error: { message: 'chave inválida' } })
  const body = await readJson(req)
  requests.push({ route, body })
  return send(res, 200, route === 'embeddings' ? embeddingsResponse(body) : chatResponse(body))
})

const listen = () => new Promise(resolve => {
  if (api.listening) return resolve()
  api.listen(PORT, '127.0.0.1', resolve)
})

const close = () => new Promise(resolve => {
  if (!api.listening) return resolve()
  api.close(resolve)
  api.closeAllConnections()
})

const control = http.createServer(async (req, res) => {
  const action = `${req.method} ${req.url}`
  if (action === 'GET /requests') return send(res, 200, requests)
  if (action === 'POST /reset') { requests = []; return send(res, 200, {}) }
  if (action === 'POST /down') { await close(); return send(res, 200, {}) }
  if (action === 'POST /up') { await listen(); return send(res, 200, {}) }
  if (action === 'POST /shutdown') { res.on('finish', () => process.exit(0)); return send(res, 200, {}) }
  return send(res, 404, {})
})

await listen()
control.listen(PORT + 1, '127.0.0.1')
