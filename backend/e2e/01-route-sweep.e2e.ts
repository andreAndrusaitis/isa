// Varredura de TODAS as rotas declaradas em src/routes e src/ai, lidas do código-fonte
// (rota nova entra sozinha): anônimo, cada papel e payloads lixo. Nada pode 5xx.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { as, http } from './helpers'

const SRC = join(__dirname, '..', 'src')
const app = readFileSync(join(SRC, 'app.ts'), 'utf8')

// Nome no app.ts → arquivo e variável do router dentro dele.
const importOf = new Map<string, { file: string; router: string }>()
for (const m of app.matchAll(/import (\w+)(?:,\s*\{([^}]*)\})? from '\.\/((?:routes|ai)\/[\w/]+)'/g)) {
  importOf.set(m[1], { file: m[3], router: 'router' })
  for (const named of (m[2] ?? '').matchAll(/(\w+) as (\w+)/g)) importOf.set(named[2], { file: m[3], router: named[1] })
}

interface Route { method: string; path: string; file: string }
const routes: Route[] = []
for (const m of app.matchAll(/app\.use\('([^']+)',\s*(\w+)\)/g)) {
  const found = importOf.get(m[2])
  if (!found) continue
  const { file, router } = found
  const src = readFileSync(join(SRC, `${file}.ts`), 'utf8')
  for (const r of src.matchAll(new RegExp(`\\b${router}\\.(get|post|put|patch|delete)\\(\\s*'([^']*)'`, 'g'))) {
    const path = (m[1] + (r[2] === '/' ? '' : r[2]))
      .replace(/:event/g, 'ticket.created')
      .replace(/:type/g, 'incident')
      .replace(/:token/g, 'tok-inexistente')
      .replace(/:idOrEmail/g, 'nao-existe@e2e.local')
      .replace(/:\w+/g, '00000000-0000-0000-0000-000000000000')
    routes.push({ method: r[1].toUpperCase(), path, file })
  }
}

// Rotas que DEVEM funcionar sem JWT (públicas ou com credencial própria).
const PUBLIC = [
  /^\/api\/auth\//, /^\/auth\//, /^\/api\/survey\/public\//,
  /^\/api\/integrations\/v1\//, /^\/api\/teams\//,
  /^\/api\/system-config\/public$/, /^\/api\/link-preview$/, // prévia de link (Open Graph) para Teams/Slack: só código, título e status
]
const isPublic = (p: string) => PUBLIC.some(r => r.test(p))
// Bot do Teams sem credencial responde 503 de propósito.
const crashed = (r: Route, status: number) => status >= 500 && !(status === 503 && /\/teams\//.test(r.path))

describe('varredura de rotas', () => {
  it('encontrou as rotas no código', () => {
    expect(routes.length).toBeGreaterThan(150)
  })

  it('inclui as rotas montadas de ./ai', () => {
    const declared = routes.map(r => `${r.method} ${r.path}`)
    expect(declared).toEqual(expect.arrayContaining([
      'POST /api/knowledge', 'POST /api/ai/suggest', 'GET /api/ai/suggest/status', 'POST /api/ai/feedback',
      'GET /api/ai/feedback', 'GET /api/ai/insights/knowledge', 'GET /api/ai/status',
    ]))
  })

  it('toda rota não-pública exige autenticação (401 sem token)', async () => {
    const leaks: string[] = []
    for (const r of routes.filter(r => !isPublic(r.path))) {
      const res = await http(r.method, r.path, { body: r.method === 'GET' ? undefined : {} })
      if (res.status !== 401) leaks.push(`${r.method} ${r.path} → ${res.status}`)
    }
    expect(leaks).toEqual([])
  })

  it('token forjado/expirado é rejeitado em todas as rotas autenticadas', async () => {
    const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6ImFkbWluIn0.invalida'
    const none = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4Iiwicm9sZSI6ImFkbWluIn0.'
    const leaks: string[] = []
    for (const r of routes.filter(r => !isPublic(r.path))) {
      for (const token of [forged, none]) {
        const res = await http(r.method, r.path, { token, body: r.method === 'GET' ? undefined : {} })
        if (res.status !== 401) leaks.push(`${r.method} ${r.path} → ${res.status}`)
      }
    }
    expect(leaks).toEqual([])
  })

  for (const role of ['admin', 'gerente', 'tm', 'an1', 'acme1'] as const) {
    it(`${role}: nenhuma rota responde 5xx (ids inexistentes, corpo vazio)`, async () => {
      const token = await as(role)
      const crashes: string[] = []
      for (const r of routes) {
        // logout invalida a sessão de quem chama — testado em 02-auth
        if (/logout|regenerate|\/trigger$/.test(r.path)) continue
        const res = await http(r.method, r.path, { token, body: r.method === 'GET' ? undefined : {} })
        if (crashed(r, res.status)) crashes.push(`${r.method} ${r.path} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`)
      }
      expect(crashes).toEqual([])
    })
  }

  it('payload malformado (JSON quebrado, tipos errados) nunca vira 5xx', async () => {
    const token = await as('tm')
    const crashes: string[] = []
    const junk = ['{"a":', '[]', '"str"', 'null', '{"title":{"$ne":1},"id":[1,2],"page":-1}']
    for (const r of routes.filter(r => r.method !== 'GET' && !/logout|regenerate|\/trigger$/.test(r.path))) {
      for (const raw of junk) {
        const res = await http(r.method, r.path, { token, raw })
        if (crashed(r, res.status)) crashes.push(`${r.method} ${r.path} body=${raw} → ${res.status}`)
      }
    }
    expect(crashes).toEqual([])
  }, 300_000) // são milhares de requisições em sequência
})

describe('limites do body parser', () => {
  it('JSON malformado responde 400, não 500', async () => {
    const r = await http('POST', '/api/auth/login', { raw: '{"email":' })
    expect(r.status).toBe(400)
  })

  const b64 = (mb: number) => 'data:image/png;base64,' + Buffer.alloc(mb * 1024 * 1024, 7).toString('base64')
  const post = async (url: string) => http('POST', '/api/tickets', { token: await as('acme1'), body: { title: 'anexo', description: 'x', attachment_url: url } })

  it('anexo de 9 MB (dentro do limite da tela) é aceito', async () => {
    expect((await post(b64(9))).status).toBe(201)
  })

  it('anexo acima de 10 MB responde 413 com mensagem, não 500', async () => {
    const r = await post(b64(10.5))
    expect(r.status).toBe(413)
    expect(r.body.error).toMatch(/10 MB/)
  })

  it('corpo acima de 15 MB responde 413 com mensagem, não 500', async () => {
    const r = await post(b64(12))
    expect(r.status).toBe(413)
    expect(r.body.error).toMatch(/10 MB/)
  })
})
